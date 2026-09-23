import { randomUUID } from 'node:crypto';

import { DelayFn } from './charge.service';
import { buildServer } from './server';

const APPROVED_CARD = '4242424242424242';
const DECLINED_CARD = '4000000000000002';
const PROVIDER_ERROR_CARD = '4000000000090003';
const TIMEOUT_CARD = '4000000000080004';

function createDelaySpy(realWaitMs = 5): { delay: DelayFn; calls: number[] } {
  const calls: number[] = [];
  const delay: DelayFn = async (ms) => {
    calls.push(ms);
    await new Promise<void>((resolve) => setTimeout(resolve, realWaitMs));
  };
  return { delay, calls };
}

function buildTestServer(delay: DelayFn) {
  // card0004DelayMs / approvedDelay* are recorded verbatim by the delay
  // spy but never actually waited for real — the spy substitutes its own
  // short real wait, so these values stay distinguishable in assertions
  // without slowing the suite down.
  return buildServer({
    delay,
    card0004DelayMs: 30_000,
    approvedDelayMinMs: 200,
    approvedDelayMaxMs: 600,
  });
}

function chargeRequest(
  overrides: Partial<{
    cardNumber: string;
    amountCents: number;
    currency: string;
    description: string;
  }> = {},
) {
  return {
    cardNumber: APPROVED_CARD,
    amountCents: 9_900,
    currency: 'USD',
    description: 'Order test',
    ...overrides,
  };
}

describe('GET /health', () => {
  it('answers 200 with status ok', async () => {
    const app = buildTestServer(createDelaySpy().delay);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /charge — validation', () => {
  it('answers 400 invalid_request when the Idempotency-Key header is missing', async () => {
    const app = buildTestServer(createDelaySpy().delay);

    const response = await app.inject({
      method: 'POST',
      url: '/charge',
      payload: chargeRequest(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });

  it('answers 400 invalid_request for a malformed body', async () => {
    const app = buildTestServer(createDelaySpy().delay);

    const response = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        cardNumber: APPROVED_CARD,
        currency: 'USD',
        description: 'no amount',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('POST /charge — the four card outcomes', () => {
  it('approves an ordinary card after the simulated latency', async () => {
    const { delay, calls } = createDelaySpy();
    const app = buildTestServer(delay);

    const response = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': randomUUID() },
      payload: chargeRequest(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      status: 'approved',
      amountCents: 9_900,
      currency: 'USD',
      cardLast4: '4242',
    });
    expect(body.id).toMatch(/^ch_/);
    expect(body.createdAt).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('declineCode');
    expect(calls).toEqual([expect.any(Number)]);
    expect(calls[0]).toBeGreaterThanOrEqual(200);
    expect(calls[0]).toBeLessThanOrEqual(600);
  });

  it('declines card 0002 with 402 and no simulated delay', async () => {
    const { delay, calls } = createDelaySpy();
    const app = buildTestServer(delay);

    const response = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': randomUUID() },
      payload: chargeRequest({ cardNumber: DECLINED_CARD }),
    });

    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      status: 'declined',
      declineCode: 'card_declined',
      cardLast4: '0002',
    });
    expect(calls).toEqual([]);
  });

  it('answers 500 provider_error for card 0003, and never stores it', async () => {
    const { delay } = createDelaySpy();
    const app = buildTestServer(delay);
    const idempotencyKey = randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload: chargeRequest({ cardNumber: PROVIDER_ERROR_CARD }),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'provider_error' });

    const statusResponse = await app.inject({
      method: 'GET',
      url: `/charge/${idempotencyKey}`,
    });
    expect(statusResponse.statusCode).toBe(404);
  });

  it('answers 200 approved for card 0004, after the delay', async () => {
    const { delay, calls } = createDelaySpy();
    const app = buildTestServer(delay);

    const response = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': randomUUID() },
      payload: chargeRequest({ cardNumber: TIMEOUT_CARD }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'approved',
      cardLast4: '0004',
    });
    expect(calls).toEqual([30_000]);
  });
});

describe('POST /charge — idempotency', () => {
  it('replays a byte-identical response for a repeated key and body', async () => {
    const { delay } = createDelaySpy();
    const app = buildTestServer(delay);
    const idempotencyKey = randomUUID();
    const payload = chargeRequest();

    const first = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });

    expect(second.statusCode).toBe(first.statusCode);
    expect(second.body).toBe(first.body);

    const statusResponse = await app.inject({
      method: 'GET',
      url: `/charge/${idempotencyKey}`,
    });
    expect(statusResponse.json().id).toBe(first.json().id);
  });

  it('answers 422 idempotency_key_reused for the same key with a different body', async () => {
    const { delay } = createDelaySpy();
    const app = buildTestServer(delay);
    const idempotencyKey = randomUUID();

    await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload: chargeRequest({ amountCents: 1_000 }),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload: chargeRequest({ amountCents: 2_000 }),
    });

    expect(second.statusCode).toBe(422);
    expect(second.json()).toEqual({ error: 'idempotency_key_reused' });
  });

  it('delays a repeated 0004 request again, instead of replaying instantly', async () => {
    const { delay, calls } = createDelaySpy();
    const app = buildTestServer(delay);
    const idempotencyKey = randomUUID();
    const payload = chargeRequest({ cardNumber: TIMEOUT_CARD });

    const first = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });

    expect(calls).toEqual([30_000, 30_000]);
    expect(second.json().id).toBe(first.json().id);
  });

  it('shares one result between two concurrent requests for the same key and body', async () => {
    const { delay, calls } = createDelaySpy();
    const app = buildTestServer(delay);
    const idempotencyKey = randomUUID();
    const payload = chargeRequest();

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/charge',
        headers: { 'idempotency-key': idempotencyKey },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/charge',
        headers: { 'idempotency-key': idempotencyKey },
        payload,
      }),
    ]);

    expect(calls.length).toBe(1);
    expect(first.json().id).toBe(second.json().id);
  });

  it('lets GET see the approved 0004 charge while its POST is still pending', async () => {
    const { delay } = createDelaySpy(50);
    const app = buildTestServer(delay);
    const idempotencyKey = randomUUID();

    const postPromise = app.inject({
      method: 'POST',
      url: '/charge',
      headers: { 'idempotency-key': idempotencyKey },
      payload: chargeRequest({ cardNumber: TIMEOUT_CARD }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const duringDelay = await app.inject({
      method: 'GET',
      url: `/charge/${idempotencyKey}`,
    });
    expect(duringDelay.statusCode).toBe(200);
    expect(duringDelay.json()).toMatchObject({
      status: 'approved',
      idempotencyKey,
    });

    const postResponse = await postPromise;
    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json().id).toBe(duringDelay.json().id);
  });
});

describe('GET /charge/:idempotencyKey', () => {
  it('answers 404 for a key it never stored', async () => {
    const app = buildTestServer(createDelaySpy().delay);

    const response = await app.inject({
      method: 'GET',
      url: `/charge/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });
});

describe('card data', () => {
  it('never returns a full card number in any response body', async () => {
    const { delay } = createDelaySpy();
    const app = buildTestServer(delay);
    const cards = [APPROVED_CARD, DECLINED_CARD, PROVIDER_ERROR_CARD];

    const responses = await Promise.all(
      cards.map((cardNumber) =>
        app.inject({
          method: 'POST',
          url: '/charge',
          headers: { 'idempotency-key': randomUUID() },
          payload: chargeRequest({ cardNumber }),
        }),
      ),
    );

    for (const [index, response] of responses.entries()) {
      expect(response.body).not.toContain(cards[index]);
    }
  });
});
