import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DataSource } from 'typeorm';

import { InsufficientStockError } from '../src/application/allocation/errors';
import { InventoryService } from '../src/application/allocation/inventory.service';
import { validateEnv } from '../src/infrastructure/config/env.schema';
import { PERSISTENCE_ENTITIES } from '../src/infrastructure/database/persistence-entities';

/**
 * Own `DataSource` with `poolSize: 30`: TypeORM's default pool of 10 would
 * queue attempts on the pool instead of the row lock, proving nothing
 * about `reserve`'s locking.
 *
 * Every successful reserve is committed so the run can end at available = 0
 * and reserved = 0. `N` is an argument (default 5); the fixture is reset
 * each run. See knowledge/scripts.md#concurrency-check
 */

const DEFAULT_N = 5;
const EXTRA_LOSING_ATTEMPTS = 20;
const POOL_SIZE = 30;

// Fixed ids: the harness always resets the same rows rather than
// accumulating a new product/warehouse per run.
const HARNESS_CUSTOMER_ID = 'd0000000-0000-0000-0000-000000000001';
const HARNESS_WAREHOUSE_ID = 'd0000000-0000-0000-0000-000000000002';
const HARNESS_PRODUCT_ID = 'd0000000-0000-0000-0000-000000000003';

interface AttemptResult {
  succeeded: boolean;
}

function parseN(): number {
  const arg = process.argv[2];
  if (arg === undefined) return DEFAULT_N;

  const n = Number(arg);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`N must be a positive integer, got "${arg}"`);
  }
  return n;
}

/** Idempotent: ensures the harness's customer/warehouse/product exist, then resets its inventory row to N available / 0 reserved and clears its prior movements. */
async function resetFixtures(dataSource: DataSource, n: number): Promise<void> {
  await dataSource.query(
    `INSERT INTO customers (id, email, full_name)
     VALUES ($1, 'concurrency-check@example.com', 'Concurrency Check Customer')
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_CUSTOMER_ID],
  );

  await dataSource.query(
    `INSERT INTO warehouses (id, name, address, location, is_active)
     VALUES ($1, 'Concurrency Check WH', '{}'::jsonb, ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography, true)
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_WAREHOUSE_ID],
  );

  await dataSource.query(
    `INSERT INTO products (id, sku, name, condition, unit_price_cents, is_active)
     VALUES ($1, 'CONCURRENCY-CHECK-SKU', 'Concurrency Check Product', 'NEW', 1000, true)
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_PRODUCT_ID],
  );

  // Resets this harness's own fixture. The append-only ledger rule applies
  // to src/ only, not to this dev script.
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

async function insertOrders(
  dataSource: DataSource,
  orderIds: string[],
): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];
  for (const orderId of orderIds) {
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, 'PENDING_PAYMENT', 'USD', 1000, '{"line1":"1 Test Way","city":"Test City","country":"US"}'::jsonb, ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography)`,
    );
    params.push(
      orderId,
      `CNL-CC-${Math.floor(Math.random() * 1_000_000_000)}`,
      HARNESS_CUSTOMER_ID,
    );
  }
  await dataSource.query(
    `INSERT INTO orders
       (id, order_number, customer_id, status, currency, total_cents, shipping_address, shipping_location)
     VALUES ${values.join(', ')}`,
    params,
  );
}

interface AttemptContext {
  dataSource: DataSource;
  inventoryService: InventoryService;
  start: Promise<void>;
}

/** One reservation attempt: waits for the shared start signal, tries to reserve, commits immediately on success. */
async function runAttempt(
  context: AttemptContext,
  orderId: string,
): Promise<AttemptResult> {
  const { dataSource, inventoryService, start } = context;
  await start;

  try {
    await dataSource.transaction(async (manager) => {
      await inventoryService.reserve(manager, {
        orderId,
        warehouseId: HARNESS_WAREHOUSE_ID,
        lines: [{ productId: HARNESS_PRODUCT_ID, quantity: 1 }],
      });
    });
  } catch (error: unknown) {
    if (error instanceof InsufficientStockError) {
      return { succeeded: false };
    }
    throw error;
  }

  // Reservation won — settle it immediately (simulates its payment
  // succeeding), in its own transaction.
  await dataSource.transaction(async (manager) => {
    await inventoryService.commit(manager, {
      orderId,
      warehouseId: HARNESS_WAREHOUSE_ID,
      productIds: [HARNESS_PRODUCT_ID],
    });
  });

  return { succeeded: true };
}

async function main(): Promise<void> {
  const n = parseN();
  const totalAttempts = n + EXTRA_LOSING_ATTEMPTS;

  const dataSource = new DataSource({
    type: 'postgres',
    url: validateEnv(process.env).DATABASE_URL,
    entities: PERSISTENCE_ENTITIES,
    synchronize: false,
    logging: false,
    poolSize: POOL_SIZE,
  });
  await dataSource.initialize();

  const inventoryService = new InventoryService();

  await resetFixtures(dataSource, n);

  const orderIds = Array.from({ length: totalAttempts }, () => randomUUID());
  await insertOrders(dataSource, orderIds);

  let releaseGate: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const attemptContext: AttemptContext = {
    dataSource,
    inventoryService,
    start: gate,
  };
  const attempts = orderIds.map((orderId) =>
    runAttempt(attemptContext, orderId),
  );
  releaseGate!();
  const results = await Promise.all(attempts);

  const successes = results.filter((r) => r.succeeded).length;
  const failures = results.length - successes;

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

  console.log('--- concurrency-check ---');
  console.log(`N = ${n}, attempts = ${totalAttempts}`);
  console.log(`successes = ${successes}, failures = ${failures}`);
  console.log(
    `final balances: quantity_available = ${inventoryRow.quantity_available}, quantity_reserved = ${inventoryRow.quantity_reserved}`,
  );
  console.log(
    `verify-ledger.sql discrepancies = ${ledgerDiscrepancies.length}`,
  );

  await dataSource.destroy();

  const problems: string[] = [];
  if (successes !== n)
    problems.push(`expected ${n} successes, got ${successes}`);
  if (failures !== EXTRA_LOSING_ATTEMPTS)
    problems.push(
      `expected ${EXTRA_LOSING_ATTEMPTS} failures, got ${failures}`,
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
