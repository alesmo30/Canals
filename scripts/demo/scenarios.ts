import { randomUUID } from 'crypto';

import { DataSource } from 'typeorm';

import { OrderResponse } from '../../src/infrastructure/http/dto/order-response.dto';
import { ProblemDetails } from '../../src/infrastructure/http/filters/problem-details.filter';
import {
  APPROVED_CARD,
  DECLINED_CARD,
  DemoFixture,
  OrderRequestBody,
  TIMEOUT_CARD,
  buildOrderBody,
  countPayments,
  expireReservation,
  getInventory,
  getOrder,
  pollOrderStatus,
  postOrder,
  startPaymentsMockAndWait,
  stopPaymentsMock,
} from './harness';

/** Reaper cron tick (≤ 60 s) plus margin for the mock's 30 s delay to have elapsed. */
const REAPER_WAIT_TIMEOUT_MS = 75_000;
/**
 * Scenario 5 tripped the shared payments breaker; the reaper reads
 * CIRCUIT_OPEN until it cools down (30 s), so allow two ticks plus the
 * cooldown.
 */
const REAPER_WAIT_AFTER_BREAKER_TRIP_MS = 150_000;
/** An absurd quantity no warehouse can ever supply (scenario 7). */
const UNSATISFIABLE_QUANTITY = 999_999;

export interface ScenarioResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
}

/**
 * Carries what a later scenario needs from an earlier one — the demo's
 * own narrative state, not a general-purpose bag (each field is read by
 * exactly the scenario named in its comment).
 */
export interface DemoContext {
  dataSource: DataSource;
  fixture: DemoFixture;
  /** Written by scenario 1, read by scenario 8 (the duplicate-key replay). */
  scenario1?: {
    idempotencyKey: string;
    requestBody: OrderRequestBody;
    responseBody: OrderResponse;
  };
  /** Written by scenario 3, read by scenario 4. */
  scenario3OrderId?: string;
  /** Written by scenario 5, read by scenario 6. */
  scenario5?: {
    orderIds: [string, string];
    inventoryBeforeAvailable: number;
  };
}

async function run(
  name: string,
  expected: string,
  body: () => Promise<void>,
): Promise<ScenarioResult> {
  try {
    await body();
    return { name, expected, actual: expected, passed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, expected, actual: `FAILED: ${message}`, passed: false };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Sorts object keys recursively (array order untouched) — same normalisation idempotency.repository.ts's own fingerprint uses, for the same reason: jsonb does not preserve key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}

export async function scenario1HappyPath(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '1. Happy path',
    '201, status CONFIRMED, warehouse name + distance present',
    async () => {
      const idempotencyKey = randomUUID();
      const requestBody = buildOrderBody(ctx.fixture, APPROVED_CARD);
      const result = await postOrder(requestBody, idempotencyKey);

      assert(result.status === 201, `expected 201, got ${result.status}`);
      const body = result.body as OrderResponse;
      assert(
        body.status === 'CONFIRMED',
        `expected status CONFIRMED, got ${body.status}`,
      );
      assert(
        typeof body.warehouse?.name === 'string' &&
          typeof body.warehouse?.distanceMeters === 'number',
        'expected warehouse.name and warehouse.distanceMeters in the response',
      );

      ctx.scenario1 = { idempotencyKey, requestBody, responseBody: body };
    },
  );
}

export async function scenario2Declined(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '2. Declined card (...0002)',
    '402, stock released back',
    async () => {
      const before = await getInventory(ctx.dataSource, ctx.fixture);

      const result = await postOrder(
        buildOrderBody(ctx.fixture, DECLINED_CARD),
        randomUUID(),
      );
      assert(result.status === 402, `expected 402, got ${result.status}`);

      const after = await getInventory(ctx.dataSource, ctx.fixture);
      assert(
        after.quantityAvailable === before.quantityAvailable &&
          after.quantityReserved === before.quantityReserved,
        `expected inventory unchanged (${JSON.stringify(before)}), got ${JSON.stringify(after)}`,
      );
    },
  );
}

export async function scenario3ProviderTimeout(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '3. Provider timeout (...0004)',
    '502 with orderId, order PENDING_PAYMENT, reservation held',
    async () => {
      const before = await getInventory(ctx.dataSource, ctx.fixture);

      const result = await postOrder(
        buildOrderBody(ctx.fixture, TIMEOUT_CARD),
        randomUUID(),
      );
      assert(result.status === 502, `expected 502, got ${result.status}`);
      const problem = result.body as ProblemDetails;
      assert(typeof problem.orderId === 'string', 'expected body.orderId');

      const order = await getOrder(problem.orderId!);
      assert(
        (order.body as OrderResponse).status === 'PENDING_PAYMENT',
        `expected PENDING_PAYMENT, got ${(order.body as OrderResponse).status}`,
      );

      const after = await getInventory(ctx.dataSource, ctx.fixture);
      assert(
        after.quantityReserved === before.quantityReserved + 1,
        `expected quantity_reserved to hold +1, got ${after.quantityReserved} (was ${before.quantityReserved})`,
      );

      ctx.scenario3OrderId = problem.orderId!;
    },
  );
}

export async function scenario4ReaperResolvesTimeout(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '4. Reaper resolves scenario 3',
    `CONFIRMED within ${REAPER_WAIT_TIMEOUT_MS / 1000}s (the mock recorded the charge)`,
    async () => {
      const orderId = ctx.scenario3OrderId;
      assert(!!orderId, 'scenario 3 must run first');

      // Demo shortcut, documented: real TTL is 15 minutes.
      await expireReservation(ctx.dataSource, orderId!);
      const order = await pollOrderStatus(
        orderId!,
        (status) => status === 'CONFIRMED',
        REAPER_WAIT_TIMEOUT_MS,
      );
      assert(
        order.status === 'CONFIRMED',
        `expected CONFIRMED, got ${order.status}`,
      );
    },
  );
}

export async function scenario5ProviderDown(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '5. Provider down (docker compose stop payments-mock)',
    '502 on both orders, breaker opens (second order fails faster)',
    async () => {
      const inventoryBeforeAvailable = (
        await getInventory(ctx.dataSource, ctx.fixture)
      ).quantityAvailable;

      stopPaymentsMock();

      const orderA = await postOrder(
        buildOrderBody(ctx.fixture, APPROVED_CARD),
        randomUUID(),
      );
      assert(
        orderA.status === 502,
        `order A: expected 502, got ${orderA.status}`,
      );

      const orderB = await postOrder(
        buildOrderBody(ctx.fixture, APPROVED_CARD),
        randomUUID(),
      );
      assert(
        orderB.status === 502,
        `order B: expected 502, got ${orderB.status}`,
      );
      assert(
        orderB.elapsedMs < orderA.elapsedMs,
        `expected order B (breaker already open) to fail faster than order A ` +
          `(${orderB.elapsedMs}ms vs ${orderA.elapsedMs}ms)`,
      );

      ctx.scenario5 = {
        orderIds: [
          (orderA.body as ProblemDetails).orderId!,
          (orderB.body as ProblemDetails).orderId!,
        ],
        inventoryBeforeAvailable,
      };
    },
  );
}

export async function scenario6ReaperCancelsAfterRestart(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '6. Mock restarted, scenario 5 orders expire',
    'CANCELLED, stock back to its pre-scenario-5 balance',
    async () => {
      assert(!!ctx.scenario5, 'scenario 5 must run first');
      const { orderIds, inventoryBeforeAvailable } = ctx.scenario5!;

      await startPaymentsMockAndWait();
      await Promise.all(
        orderIds.map((orderId) => expireReservation(ctx.dataSource, orderId)),
      );
      const orders = await Promise.all(
        orderIds.map((orderId) =>
          pollOrderStatus(
            orderId,
            (status) => status === 'CANCELLED',
            REAPER_WAIT_AFTER_BREAKER_TRIP_MS,
          ),
        ),
      );
      orders.forEach((order, index) => {
        assert(
          order.status === 'CANCELLED',
          `order ${orderIds[index]}: expected CANCELLED, got ${order.status}`,
        );
      });

      const after = await getInventory(ctx.dataSource, ctx.fixture);
      assert(
        after.quantityAvailable === inventoryBeforeAvailable &&
          after.quantityReserved === 0,
        `expected quantity_available back to ${inventoryBeforeAvailable} and ` +
          `quantity_reserved 0, got ${JSON.stringify(after)}`,
      );
    },
  );
}

export async function scenario7Unsatisfiable(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run('7. Unsatisfiable order', '422', async () => {
    const result = await postOrder(
      buildOrderBody(ctx.fixture, APPROVED_CARD, UNSATISFIABLE_QUANTITY),
      randomUUID(),
    );
    assert(result.status === 422, `expected 422, got ${result.status}`);
  });
}

export async function scenario8DuplicateKey(
  ctx: DemoContext,
): Promise<ScenarioResult> {
  return run(
    '8. Duplicate Idempotency-Key',
    'identical body, exactly one payments row',
    async () => {
      assert(!!ctx.scenario1, 'scenario 1 must run first');
      const { idempotencyKey, requestBody, responseBody } = ctx.scenario1!;

      const replay = await postOrder(requestBody, idempotencyKey);
      assert(replay.status === 201, `expected 201, got ${replay.status}`);
      // Field-for-field, not literal JSON bytes: the replay comes back out
      // of idempotency_keys.response_body (jsonb), which normalises key
      // order rather than preserving it — the API contract is the same
      // fields and values, not the same serialised byte string.
      assert(
        JSON.stringify(canonicalize(replay.body)) ===
          JSON.stringify(canonicalize(responseBody)),
        'expected the replayed body to equal the original field-for-field',
      );

      const paymentCount = await countPayments(ctx.dataSource, responseBody.id);
      assert(
        paymentCount === 1,
        `expected exactly one payments row, got ${paymentCount}`,
      );
    },
  );
}
