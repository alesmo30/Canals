import Fastify, {
  FastifyError,
  FastifyInstance,
  FastifySchema,
} from 'fastify';

import {
  ChargeService,
  ChargeServiceOptions,
  IDEMPOTENCY_KEY_REUSED,
} from './charge.service';
import {
  ChargeRequestBody,
  toChargeResponse,
  toChargeStatusResponse,
} from './types';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

const chargeSchema: FastifySchema = {
  headers: {
    type: 'object',
    required: [IDEMPOTENCY_KEY_HEADER],
    properties: {
      [IDEMPOTENCY_KEY_HEADER]: { type: 'string', minLength: 1 },
    },
  },
  body: {
    type: 'object',
    required: ['cardNumber', 'amountCents', 'currency', 'description'],
    properties: {
      cardNumber: { type: 'string', minLength: 1 },
      amountCents: { type: 'number' },
      currency: { type: 'string', minLength: 1 },
      description: { type: 'string' },
    },
  },
};

/**
 * App builder: tests build a fresh instance per test with injectable delays
 * (`fastify.inject()`, no socket); `main.ts` builds the one that listens.
 */
export function buildServer(options?: ChargeServiceOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const chargeService = new ChargeService(options);

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      reply.code(400).send({ error: 'invalid_request' });
      return;
    }
    reply.send(error);
  });

  app.get('/health', () => ({ status: 'ok' }));

  app.post<{ Body: ChargeRequestBody }>(
    '/charge',
    { schema: chargeSchema },
    async (request, reply) => {
      const idempotencyKey = request.headers[
        IDEMPOTENCY_KEY_HEADER
      ] as string;

      const result = await chargeService.charge(idempotencyKey, request.body);

      if (result === IDEMPOTENCY_KEY_REUSED) {
        await reply.code(422).send({ error: 'idempotency_key_reused' });
        return;
      }
      if (result.kind === 'provider_error') {
        await reply.code(500).send({ error: 'provider_error' });
        return;
      }

      const statusCode = result.record.status === 'approved' ? 200 : 402;
      await reply.code(statusCode).send(toChargeResponse(result.record));
    },
  );

  app.get<{ Params: { idempotencyKey: string } }>(
    '/charge/:idempotencyKey',
    async (request, reply) => {
      const record = chargeService.getByIdempotencyKey(
        request.params.idempotencyKey,
      );
      if (!record) {
        await reply.code(404).send({ error: 'not_found' });
        return;
      }
      await reply.code(200).send(toChargeStatusResponse(record));
    },
  );

  return app;
}
