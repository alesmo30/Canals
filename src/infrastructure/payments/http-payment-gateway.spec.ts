import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ChargeCommand } from '../../domain/ports/payment-gateway';
import { CircuitBreaker } from '../http/circuit-breaker';
import { HttpPaymentGateway } from './http-payment-gateway';

// 50ms was too tight on loaded CI runners and caused spurious retries on
// tests that expect exactly one request; the hanging-handler test below
// deliberately keeps its own short timeout since it must trip TIMEOUT.
const TEST_TIMEOUT_MS = 1_000;

interface FakeServer {
  url: string;
  requestCount: () => number;
  idempotencyKeys: () => (string | undefined)[];
  close: () => Promise<void>;
}

function startFakeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  port = 0,
): Promise<FakeServer> {
  return new Promise((resolve) => {
    const keys: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      keys.push(req.headers['idempotency-key'] as string | undefined);
      handler(req, res);
    });
    server.listen(port, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requestCount: () => keys.length,
        idempotencyKeys: () => keys,
        close: () =>
          new Promise((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

function jsonHandler(
  status: number,
  body: unknown,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

function buildCommand(overrides: Partial<ChargeCommand> = {}): ChargeCommand {
  return {
    cardNumber: '4242424242424242',
    amountMinor: 9_900,
    currency: 'USD',
    description: 'Order test',
    idempotencyKey: 'order:test:attempt:1',
    ...overrides,
  };
}

describe('HttpPaymentGateway.charge()', () => {
  let server: FakeServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('maps a 200 response to CAPTURED', async () => {
    server = await startFakeServer(
      jsonHandler(200, {
        id: 'ch_abc',
        status: 'approved',
        amountCents: 9_900,
        currency: 'USD',
        cardLast4: '4242',
        createdAt: new Date().toISOString(),
      }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.charge(buildCommand());

    expect(result).toMatchObject({
      status: 'CAPTURED',
      providerPaymentId: 'ch_abc',
      cardLast4: '4242',
      cardBrand: 'visa',
      failureCode: null,
    });
    expect(server.requestCount()).toBe(1);
  });

  it('maps a 402 response to DECLINED after exactly one request', async () => {
    server = await startFakeServer(
      jsonHandler(402, {
        id: 'ch_declined',
        status: 'declined',
        declineCode: 'card_declined',
      }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.charge(buildCommand());

    expect(result).toMatchObject({
      status: 'DECLINED',
      failureCode: 'CARD_DECLINED',
      cardBrand: 'visa',
    });
    expect(server.requestCount()).toBe(1);
  });

  it('maps three consecutive 500s to UNKNOWN/PROVIDER_ERROR, all with the same Idempotency-Key', async () => {
    server = await startFakeServer(
      jsonHandler(500, { error: 'provider_error' }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });
    const command = buildCommand({
      idempotencyKey: 'order:same-key:attempt:1',
    });

    const result = await gateway.charge(command);

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'PROVIDER_ERROR',
      providerPaymentId: null,
    });
    expect(server.requestCount()).toBe(3);
    expect(server.idempotencyKeys()).toEqual([
      'order:same-key:attempt:1',
      'order:same-key:attempt:1',
      'order:same-key:attempt:1',
    ]);
  });

  it('maps a hanging handler to UNKNOWN/TIMEOUT', async () => {
    server = await startFakeServer(() => {
      // Never calls res.end() — every attempt hangs until the client times out.
    });
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.charge(buildCommand());

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'TIMEOUT',
      providerPaymentId: null,
    });
  }, 10_000);

  it('maps a closed port to UNKNOWN/CONNECTION_REFUSED', async () => {
    const closedServer = await startFakeServer(jsonHandler(200, {}));
    const { url } = closedServer;
    await closedServer.close();

    const gateway = new HttpPaymentGateway({
      baseUrl: url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.charge(buildCommand());

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'CONNECTION_REFUSED',
      providerPaymentId: null,
    });
  });

  it('maps a 400 response to UNKNOWN/INVALID_REQUEST after exactly one request', async () => {
    server = await startFakeServer(
      jsonHandler(400, { error: 'invalid_request' }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.charge(buildCommand());

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'INVALID_REQUEST',
    });
    expect(server.requestCount()).toBe(1);
  });

  it('never rejects, for any of the outcomes above', async () => {
    server = await startFakeServer(
      jsonHandler(500, { error: 'provider_error' }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    await expect(gateway.charge(buildCommand())).resolves.toBeDefined();
  });

  it('redacts the card number out of rawResponse', async () => {
    server = await startFakeServer(
      jsonHandler(200, {
        id: 'ch_abc',
        status: 'approved',
        cardNumber: '4242424242424242',
        cardLast4: '4242',
      }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.charge(buildCommand());

    expect(JSON.stringify(result.rawResponse)).not.toContain(
      '4242424242424242',
    );
  });

  it('forwards the idempotency key unchanged on every retried attempt', async () => {
    server = await startFakeServer(
      jsonHandler(500, { error: 'provider_error' }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    await gateway.charge(
      buildCommand({ idempotencyKey: 'order:abc:attempt:1' }),
    );

    expect(new Set(server.idempotencyKeys())).toEqual(
      new Set(['order:abc:attempt:1']),
    );
  });
});

describe('HttpPaymentGateway.getStatus()', () => {
  let server: FakeServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('maps an approved charge to CAPTURED', async () => {
    server = await startFakeServer(
      jsonHandler(200, {
        id: 'ch_abc',
        idempotencyKey: 'order:status:1',
        status: 'approved',
        amountCents: 9_900,
        currency: 'USD',
        cardLast4: '4242',
        createdAt: new Date().toISOString(),
      }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.getStatus('order:status:1');

    expect(result).toMatchObject({
      status: 'CAPTURED',
      providerPaymentId: 'ch_abc',
      cardLast4: '4242',
      cardBrand: null,
      failureCode: null,
    });
  });

  it('maps a declined charge to DECLINED', async () => {
    server = await startFakeServer(
      jsonHandler(200, {
        id: 'ch_declined',
        idempotencyKey: 'order:status:2',
        status: 'declined',
        cardLast4: '0002',
      }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.getStatus('order:status:2');

    expect(result).toMatchObject({
      status: 'DECLINED',
      providerPaymentId: 'ch_declined',
      cardLast4: '0002',
    });
  });

  it('maps a 404 to FAILED/NOT_FOUND', async () => {
    server = await startFakeServer(jsonHandler(404, { error: 'not_found' }));
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    const result = await gateway.getStatus('order:status:missing');

    expect(result).toMatchObject({
      status: 'FAILED',
      failureCode: 'NOT_FOUND',
      providerPaymentId: null,
    });
  });

  it('never rejects on a provider failure', async () => {
    server = await startFakeServer(
      jsonHandler(500, { error: 'provider_error' }),
    );
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
    });

    await expect(gateway.getStatus('order:status:err')).resolves.toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'PROVIDER_ERROR',
    });
  });
});

describe('HttpPaymentGateway — shared breaker', () => {
  it(
    'opens across charge() calls against a closed port, then rejects the next call outright, ' +
      'never reaching a server listening again on the same port',
    async () => {
      const initialServer = await startFakeServer(jsonHandler(200, {}));
      const port = Number(new URL(initialServer.url).port);
      await initialServer.close();

      const gateway = new HttpPaymentGateway({
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: TEST_TIMEOUT_MS,
        retryPolicy: { baseDelayMs: 0 },
      });

      // Call 1: 3 attempts, all ECONNREFUSED -> 3 consecutive failures.
      // Breaker stays CLOSED (default threshold 5).
      const first = await gateway.charge(
        buildCommand({ idempotencyKey: 'order:breaker:1' }),
      );
      expect(first.failureCode).toBe('CONNECTION_REFUSED');

      // Call 2: attempt 1 -> failure #4 (still CLOSED). Attempt 2 -> failure
      // #5, the breaker opens right here. Attempt 3 (still this same call)
      // hits the now-open breaker and is rejected before any network call.
      const second = await gateway.charge(
        buildCommand({ idempotencyKey: 'order:breaker:2' }),
      );
      expect(second).toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'CIRCUIT_OPEN',
      });

      // A server is listening on the same port again, but the breaker is
      // already OPEN: call 3 must be rejected before it ever reaches it.
      const revivedServer = await startFakeServer(
        jsonHandler(200, {
          id: 'ch_x',
          status: 'approved',
          cardLast4: '4242',
          createdAt: new Date().toISOString(),
        }),
        port,
      );
      try {
        const third = await gateway.charge(
          buildCommand({ idempotencyKey: 'order:breaker:3' }),
        );

        expect(third).toMatchObject({
          status: 'UNKNOWN',
          failureCode: 'CIRCUIT_OPEN',
        });
        expect(revivedServer.requestCount()).toBe(0);
      } finally {
        await revivedServer.close();
      }
    },
  );

  it('never opens the breaker on declines: ten consecutive 402s leave it CLOSED', async () => {
    const server = await startFakeServer(
      jsonHandler(402, {
        id: 'ch_declined',
        status: 'declined',
        declineCode: 'card_declined',
      }),
    );
    const breaker = new CircuitBreaker({ name: 'payments' });
    const gateway = new HttpPaymentGateway({
      baseUrl: server.url,
      timeoutMs: TEST_TIMEOUT_MS,
      retryPolicy: { baseDelayMs: 0 },
      breaker,
    });

    try {
      for (let i = 0; i < 10; i++) {
        const result = await gateway.charge(
          buildCommand({ idempotencyKey: `order:declined:${i}` }),
        );
        expect(result).toMatchObject({
          status: 'DECLINED',
          failureCode: 'CARD_DECLINED',
        });
      }

      expect(breaker.state).toBe('CLOSED');
      expect(server.requestCount()).toBe(10);
    } finally {
      await server.close();
    }
  });
});
