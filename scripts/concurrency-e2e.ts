import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DataSource } from 'typeorm';

import { RATE_LIMIT_PER_MINUTE } from '../src/modules/api.module';
import { OrderResponse } from '../src/infrastructure/http/dto/order-response.dto';
import { ProblemDetails } from '../src/infrastructure/http/filters/problem-details.filter';
import { validateEnv } from '../src/infrastructure/config/env.schema';
import { PERSISTENCE_ENTITIES } from '../src/infrastructure/database/persistence-entities';

/**
 * End-to-end concurrency proof: fires real `POST /orders` at a running api.
 * Own `DataSource` for setup/verification only; `N` is an argument
 * (default 5) and the fixture is reset each run.
 * See knowledge/scripts.md#concurrency-e2e
 */

const DEFAULT_N = 5;
const EXTRA_LOSING_ATTEMPTS = 20;
const DEFAULT_API_URL = 'http://localhost:3000';
const APPROVED_CARD_NUMBER = '4242424242424242';

// Fixed ids distinct from the other harness scripts, so they never contend
// on the same rows.
const HARNESS_CUSTOMER_ID = 'f0000000-0000-0000-0000-000000000001';
const HARNESS_WAREHOUSE_ID = 'f0000000-0000-0000-0000-000000000002';
const HARNESS_PRODUCT_ID = 'f0000000-0000-0000-0000-000000000003';

const HARNESS_SHIPPING_ADDRESS = {
  recipient: 'Concurrency E2E',
  line1: '1 Broadway',
  city: 'New York',
  state: 'NY',
  country: 'US',
};
// Near New York — matches HARNESS_SHIPPING_ADDRESS, so the harness
// warehouse is always the nearest (only) qualifying candidate.
const HARNESS_WAREHOUSE_COORDINATES = { longitude: -74.006, latitude: 40.7128 };

function parseN(): number {
  const arg = process.argv[2];
  if (arg === undefined) return DEFAULT_N;

  const n = Number(arg);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`N must be a positive integer, got "${arg}"`);
  }
  return n;
}

/** Refuses an N whose burst would trip the api's own rate limiter (api.module.ts) — a throttled attempt would read as a false losing outcome. */
function assertBurstFitsRateLimit(totalAttempts: number): void {
  if (totalAttempts > RATE_LIMIT_PER_MINUTE) {
    throw new Error(
      `N + ${EXTRA_LOSING_ATTEMPTS} = ${totalAttempts} attempts would exceed ` +
        `RATE_LIMIT_PER_MINUTE (${RATE_LIMIT_PER_MINUTE}, api.module.ts) within the ` +
        `throttler's one-minute window — choose a smaller N.`,
    );
  }
}

/** Idempotent: ensures the harness's customer/warehouse/product exist, then resets its inventory row to N available / 0 reserved and clears its prior movements. */
async function resetFixtures(dataSource: DataSource, n: number): Promise<void> {
  await dataSource.query(
    `INSERT INTO customers (id, email, full_name)
     VALUES ($1, 'concurrency-e2e@example.com', 'Concurrency E2E Customer')
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_CUSTOMER_ID],
  );

  await dataSource.query(
    `INSERT INTO warehouses (id, name, address, location, is_active)
     VALUES ($1, 'Concurrency E2E WH', '{}'::jsonb, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, true)
     ON CONFLICT (id) DO NOTHING`,
    [
      HARNESS_WAREHOUSE_ID,
      HARNESS_WAREHOUSE_COORDINATES.longitude,
      HARNESS_WAREHOUSE_COORDINATES.latitude,
    ],
  );

  await dataSource.query(
    `INSERT INTO products (id, sku, name, condition, unit_price_cents, is_active)
     VALUES ($1, 'CONCURRENCY-E2E-SKU', 'Concurrency E2E Product', 'NEW', 1000, true)
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_PRODUCT_ID],
  );

  // Dev harness resetting its own test data between local runs — outside
  // src/, the append-only-ledger rule does not apply here.
  await dataSource.query(
    `DELETE FROM inventory_movements WHERE warehouse_id = $1 AND product_id = $2`,
    [HARNESS_WAREHOUSE_ID, HARNESS_PRODUCT_ID],
  );

  await dataSource.query(
    `INSERT INTO inventory (warehouse_id, product_id, quantity_available, quantity_reserved)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (warehouse_id, product_id)
     DO UPDATE SET quantity_available = EXCLUDED.quantity_available, quantity_reserved = 0`,
    [HARNESS_WAREHOUSE_ID, HARNESS_PRODUCT_ID, n],
  );
}

interface AttemptResult {
  httpStatus: number;
  orderStatus: string | null;
}

interface AttemptContext {
  apiUrl: string;
  start: Promise<void>;
}

/** One POST /orders attempt: waits for the shared start signal, fires the request with a fresh Idempotency-Key. */
async function runAttempt(context: AttemptContext): Promise<AttemptResult> {
  const { apiUrl, start } = context;
  await start;

  const response = await fetch(`${apiUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      customerId: HARNESS_CUSTOMER_ID,
      shippingAddress: HARNESS_SHIPPING_ADDRESS,
      items: [{ productId: HARNESS_PRODUCT_ID, quantity: 1 }],
      payment: { cardNumber: APPROVED_CARD_NUMBER },
    }),
  });

  const body = (await response.json()) as OrderResponse | ProblemDetails;
  return {
    httpStatus: response.status,
    orderStatus:
      response.status === 201 ? (body as OrderResponse).status : null,
  };
}

async function main(): Promise<void> {
  const n = parseN();
  const totalAttempts = n + EXTRA_LOSING_ATTEMPTS;
  assertBurstFitsRateLimit(totalAttempts);

  const apiUrl = process.env.API_URL ?? DEFAULT_API_URL;

  const dataSource = new DataSource({
    type: 'postgres',
    url: validateEnv(process.env).DATABASE_URL,
    entities: PERSISTENCE_ENTITIES,
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();

  await resetFixtures(dataSource, n);

  let releaseGate: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const attemptContext: AttemptContext = { apiUrl, start: gate };
  const attempts = Array.from({ length: totalAttempts }, () =>
    runAttempt(attemptContext),
  );
  releaseGate!();
  const results = await Promise.all(attempts);

  const successes = results.filter(
    (r) => r.httpStatus === 201 && r.orderStatus === 'CONFIRMED',
  ).length;
  const losers = results.filter(
    (r) => r.httpStatus === 422 || r.httpStatus === 409,
  );
  const unexpected = results.filter(
    (r) =>
      !(r.httpStatus === 201 && r.orderStatus === 'CONFIRMED') &&
      r.httpStatus !== 422 &&
      r.httpStatus !== 409,
  );

  const [inventoryRow] = await dataSource.query<
    { quantity_available: number; quantity_reserved: number }[]
  >(
    `SELECT quantity_available, quantity_reserved FROM inventory
     WHERE warehouse_id = $1 AND product_id = $2`,
    [HARNESS_WAREHOUSE_ID, HARNESS_PRODUCT_ID],
  );

  const ledgerSql = readFileSync(
    join(__dirname, '../src/infrastructure/database/sql/verify-ledger.sql'),
    'utf-8',
  );
  const ledgerDiscrepancies = await dataSource.query<unknown[]>(ledgerSql);

  console.log('--- concurrency-e2e ---');
  console.log(`N = ${n}, attempts = ${totalAttempts}, apiUrl = ${apiUrl}`);
  console.log(
    `201 CONFIRMED = ${successes}, 422/409 = ${losers.length}, unexpected = ${unexpected.length}`,
  );
  console.log(
    `final balances: quantity_available = ${inventoryRow.quantity_available}, quantity_reserved = ${inventoryRow.quantity_reserved}`,
  );
  console.log(
    `verify-ledger.sql discrepancies = ${ledgerDiscrepancies.length}`,
  );

  await dataSource.destroy();

  const problems: string[] = [];
  if (successes !== n)
    problems.push(`expected ${n} 201 CONFIRMED, got ${successes}`);
  if (losers.length !== EXTRA_LOSING_ATTEMPTS)
    problems.push(
      `expected ${EXTRA_LOSING_ATTEMPTS} 422/409 responses, got ${losers.length}`,
    );
  if (unexpected.length > 0)
    problems.push(
      `${unexpected.length} attempt(s) returned an unexpected outcome: ` +
        unexpected.map((r) => r.httpStatus).join(', '),
    );
  if (Number(inventoryRow.quantity_available) !== 0)
    problems.push(
      `expected quantity_available = 0, got ${inventoryRow.quantity_available}`,
    );
  if (Number(inventoryRow.quantity_reserved) !== 0)
    problems.push(
      `expected quantity_reserved = 0, got ${inventoryRow.quantity_reserved}`,
    );
  if (ledgerDiscrepancies.length !== 0)
    problems.push(
      `expected verify-ledger.sql to return zero rows, got ${ledgerDiscrepancies.length}`,
    );

  if (problems.length > 0) {
    console.error('FAILED:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  console.log('PASSED');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
