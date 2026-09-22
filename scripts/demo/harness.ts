import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DataSource } from 'typeorm';

import { OrderResponse } from '../../src/infrastructure/http/dto/order-response.dto';
import { ProblemDetails } from '../../src/infrastructure/http/filters/problem-details.filter';
import { validateEnv } from '../../src/infrastructure/config/env.schema';
import { PERSISTENCE_ENTITIES } from '../../src/infrastructure/database/persistence-entities';

/**
 * specs/07-hardening-demo.md, R6.4 — every mechanical piece the ten
 * scenarios (`scenarios.ts`) share: the api's HTTP surface, direct DB
 * access for setup/verification, `docker compose` control, and polling.
 * Nothing here decides a scenario's own expected/actual — that stays in
 * `scenarios.ts` (references/coding-conventions.md).
 */

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const PAYMENTS_MOCK_HEALTH_URL =
  process.env.PAYMENTS_MOCK_HEALTH_URL ?? 'http://localhost:4000/health';

/** The mock's own fixed delay before a `...0004` charge finally answers (payments-mock/src/constants.ts). */
export const CARD_0004_MOCK_DELAY_MS = 30_000;

export const APPROVED_CARD = '4242424242424242';
export const DECLINED_CARD = '4000000000000002';
export const TIMEOUT_CARD = '4000000000000004';
/** Every test PAN this demo ever sends — scenario 10 greps compose logs for each, raw, and expects zero matches. */
export const TEST_CARD_NUMBERS = [APPROVED_CARD, DECLINED_CARD, TIMEOUT_CARD];

export interface HttpResult<TBody> {
  status: number;
  body: TBody;
  elapsedMs: number;
}

export interface OrderRequestBody {
  customerId: string;
  shippingAddress: {
    recipient: string;
    line1: string;
    city: string;
    state: string;
    country: string;
  };
  items: { productId: string; quantity: number }[];
  payment: { cardNumber: string };
}

/**
 * A `docker compose stop`/`start` a moment earlier can cause the host's
 * own port-forwarding to blip for an instant (observed against this
 * repo's Docker Desktop setup) — a `fetch failed` TypeError with no HTTP
 * response at all, nothing to do with the api or payments-mock
 * themselves. One retry, after a short pause, is enough to ride it out;
 * a real HTTP response (even a 500) is never retried here.
 */
async function fetchWithNetworkBlipRetry(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    await sleep(1_000);
    return fetch(input, init);
  }
}

export async function postOrder(
  body: OrderRequestBody,
  idempotencyKey: string,
): Promise<HttpResult<OrderResponse | ProblemDetails>> {
  const startedAt = Date.now();
  const response = await fetchWithNetworkBlipRetry(`${API_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const responseBody = (await response.json()) as
    OrderResponse | ProblemDetails;
  return {
    status: response.status,
    body: responseBody,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function getOrder(
  orderId: string,
): Promise<HttpResult<OrderResponse | ProblemDetails>> {
  const startedAt = Date.now();
  const response = await fetchWithNetworkBlipRetry(
    `${API_URL}/orders/${orderId}`,
  );
  const responseBody = (await response.json()) as
    OrderResponse | ProblemDetails;
  return {
    status: response.status,
    body: responseBody,
    elapsedMs: Date.now() - startedAt,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `getOrder` every `intervalMs` until `predicate` matches its `status`, or throws after `timeoutMs`. */
export async function pollOrderStatus(
  orderId: string,
  predicate: (status: string) => boolean,
  timeoutMs: number,
  intervalMs = 2_000,
): Promise<OrderResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: OrderResponse | ProblemDetails | undefined;

  while (Date.now() < deadline) {
    const result = await getOrder(orderId);
    last = result.body;
    if (
      result.status === 200 &&
      predicate((result.body as OrderResponse).status)
    ) {
      return result.body as OrderResponse;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `pollOrderStatus: order ${orderId} did not reach the expected status within ${timeoutMs}ms ` +
      `(last seen: ${JSON.stringify(last)})`,
  );
}

export interface DemoFixture {
  customerId: string;
  warehouseId: string;
  productId: string;
}

/** A fresh, randomUUID-scoped customer/warehouse/product — never reused across runs, so a demo run never depends on a prior one's leftovers. */
export async function createFixture(
  dataSource: DataSource,
  quantityAvailable: number,
): Promise<DemoFixture> {
  const customerId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();

  await dataSource.query(
    `INSERT INTO customers (id, email, full_name)
     VALUES ($1, $2, 'Demo Customer')`,
    [customerId, `demo-${customerId}@example.com`],
  );
  await dataSource.query(
    `INSERT INTO warehouses (id, name, address, location, is_active)
     VALUES ($1, 'Demo Warehouse', '{}'::jsonb, ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography, true)`,
    [warehouseId],
  );
  await dataSource.query(
    `INSERT INTO products (id, sku, name, condition, unit_price_cents, is_active)
     VALUES ($1, $2, 'Demo Product', 'NEW', 1000, true)`,
    [productId, `DEMO-SKU-${productId.slice(0, 8)}`],
  );
  await dataSource.query(
    `INSERT INTO inventory (warehouse_id, product_id, quantity_available, quantity_reserved)
     VALUES ($1, $2, $3, 0)`,
    [warehouseId, productId, quantityAvailable],
  );

  return { customerId, warehouseId, productId };
}

export function buildOrderBody(
  fixture: DemoFixture,
  cardNumber: string,
  quantity = 1,
): OrderRequestBody {
  return {
    customerId: fixture.customerId,
    shippingAddress: {
      recipient: 'Demo Recipient',
      line1: '1 Broadway',
      city: 'New York',
      state: 'NY',
      country: 'US',
    },
    items: [{ productId: fixture.productId, quantity }],
    payment: { cardNumber },
  };
}

export interface InventoryBalances {
  quantityAvailable: number;
  quantityReserved: number;
}

export async function getInventory(
  dataSource: DataSource,
  fixture: DemoFixture,
): Promise<InventoryBalances> {
  const [row]: { quantity_available: number; quantity_reserved: number }[] =
    await dataSource.query(
      `SELECT quantity_available, quantity_reserved FROM inventory
       WHERE warehouse_id = $1 AND product_id = $2`,
      [fixture.warehouseId, fixture.productId],
    );
  return {
    quantityAvailable: Number(row.quantity_available),
    quantityReserved: Number(row.quantity_reserved),
  };
}

export async function countPayments(
  dataSource: DataSource,
  orderId: string,
): Promise<number> {
  const [row]: { count: string }[] = await dataSource.query(
    `SELECT count(*) FROM payments WHERE order_id = $1`,
    [orderId],
  );
  return Number(row.count);
}

/** The demo shortcut: expires an order's reservation immediately so the next reaper tick (≤60s) picks it up, instead of waiting out the real 15-minute TTL. */
export async function expireReservation(
  dataSource: DataSource,
  orderId: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = $1`,
    [orderId],
  );
}

export async function verifyLedgerDiscrepancies(
  dataSource: DataSource,
): Promise<number> {
  const sql = readFileSync(
    join(__dirname, '../../src/infrastructure/database/sql/verify-ledger.sql'),
    'utf-8',
  );
  const rows: unknown[] = await dataSource.query(sql);
  return rows.length;
}

export function buildDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    url: validateEnv(process.env).DATABASE_URL,
    entities: PERSISTENCE_ENTITIES,
    synchronize: false,
    logging: false,
  });
}

function runComposeCommand(args: string[]): string {
  return execFileSync('docker', ['compose', ...args], {
    encoding: 'utf-8',
    cwd: join(__dirname, '../..'),
  });
}

export function stopPaymentsMock(): void {
  runComposeCommand(['stop', 'payments-mock']);
}

/** Restarts payments-mock and waits for its own /health to answer — a fresh container has an empty in-memory charge store (Risks). */
export async function startPaymentsMockAndWait(
  timeoutMs = 30_000,
): Promise<void> {
  runComposeCommand(['start', 'payments-mock']);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(PAYMENTS_MOCK_HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Not listening yet — keep polling.
    }
    await sleep(1_000);
  }
  throw new Error(
    `startPaymentsMockAndWait: payments-mock did not become healthy within ${timeoutMs}ms`,
  );
}

/** `docker compose logs`, scoped to everything logged since `sinceIso` — never the full history of an old stack. */
export function getComposeLogsSince(sinceIso: string): string {
  return runComposeCommand(['logs', '--no-color', '--since', sinceIso]);
}
