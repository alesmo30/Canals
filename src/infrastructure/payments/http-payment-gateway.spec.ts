import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ChargeCommand } from '../../domain/ports/payment-gateway';
import { HttpPaymentGateway } from './http-payment-gateway';

interface FakeServer {
  url: string;
  requestCount: () => number;
  idempotencyKeys: () => (string | undefined)[];
  close: () => Promise<void>;
}

function startFakeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<FakeServer> {
  return new Promise((resolve) => {
    const keys: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      keys.push(req.headers['idempotency-key'] as string | undefined);
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => {
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
      timeoutMs: 50,
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
