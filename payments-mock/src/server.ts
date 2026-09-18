import Fastify, { FastifyInstance } from 'fastify';

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

function isValidChargeBody(value: unknown): value is ChargeRequestBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.cardNumber === 'string' &&
    body.cardNumber.length > 0 &&
    typeof body.amountCents === 'number' &&
    Number.isFinite(body.amountCents) &&
    typeof body.currency === 'string' &&
    body.currency.length > 0 &&
    typeof body.description === 'string'
  );
}

/**
 * SPEC 03: the app builder, so tests build a fresh instance per test with
 * injectable delays (via `fastify.inject()`, no listening socket needed)
 * and `main.ts` builds one production instance that actually listens.
 */
export function buildServer(options?: ChargeServiceOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const chargeService = new ChargeService(options);

  app.get('/health', () => ({ status: 'ok' }));

  app.post('/charge', async (request, reply) => {
    const idempotencyKey = request.headers[IDEMPOTENCY_KEY_HEADER];
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length === 0 ||
      !isValidChargeBody(request.body)
    ) {
      await reply.code(400).send({ error: 'invalid_request' });
      return;
    }

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
  });

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
