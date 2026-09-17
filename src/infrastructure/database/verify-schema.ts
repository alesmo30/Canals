import { AppDataSource } from './data-source';

/**
 * Automates the psql-based acceptance criteria from specs/01-foundation.md
 * — the checks this project's earlier steps ran by hand against a live
 * database, now repeatable. Assumes a fully migrated AND seeded stack
 * (`docker compose up`, or migration:run + seed run manually); it does not
 * bring anything up itself.
 *
 * Every check that proves a rejection (a CHECK constraint, the partial
 * unique index) runs inside one transaction that is always rolled back,
 * success or failure, so this script never leaves a trace in real data —
 * it does not even need the seed's own rows for its throwaway
 * customer/order, only a real seeded warehouse and product to satisfy
 * foreign keys.
 */

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
}

async function checkPostgisExtension(): Promise<void> {
  const rows = await AppDataSource.query<{ extversion: string }[]>(
    `SELECT extversion FROM pg_extension WHERE extname = 'postgis'`,
  );
  record('postgis extension installed', rows.length === 1, rows[0]?.extversion);
}

async function checkGistIndex(): Promise<void> {
  const rows = await AppDataSource.query<{ indexdef: string }[]>(
    `SELECT indexdef FROM pg_indexes
     WHERE indexname = 'idx_warehouses_location_gist' AND tablename = 'warehouses'`,
  );
  const ok = rows.length === 1 && /USING gist/i.test(rows[0]?.indexdef ?? '');
  record('idx_warehouses_location_gist exists and is a GiST index', ok);
}

async function checkConstraintsExist(): Promise<void> {
  const rows = await AppDataSource.query<
    { conrelid: string; conname: string }[]
  >(
    `SELECT conrelid::regclass::text AS conrelid, conname
     FROM pg_constraint
     WHERE contype = 'c'
       AND conrelid::regclass::text IN ('inventory', 'order_items')`,
  );
  const names = rows.map((r) => r.conname);
  record(
    'CHECK constraints present (inventory x2, order_items x1)',
    names.some((n) => n.includes('quantity_available')) &&
      names.some((n) => n.includes('quantity_reserved')) &&
      names.some((n) => n.includes('quantity')),
    names.join(', '),
  );
}

async function checkPartialUniqueIndexExists(): Promise<void> {
  const rows = await AppDataSource.query<{ indexdef: string }[]>(
    `SELECT indexdef FROM pg_indexes
     WHERE tablename = 'payments' AND indexdef ILIKE '%WHERE%CAPTURED%'`,
  );
  record(
    'partial unique index on payments (one CAPTURED per order) exists',
    rows.length === 1,
  );
}

async function checkGeneratedColumnsReadable(): Promise<void> {
  const rows = await AppDataSource.query<
    { name: string; latitude: string | null; longitude: string | null }[]
  >(`SELECT name, latitude, longitude FROM warehouses ORDER BY name LIMIT 1`);
  const row = rows[0];
  const ok =
    rows.length === 1 && row.latitude !== null && row.longitude !== null;
  record(
    'SELECT name, latitude, longitude FROM warehouses returns numeric coordinates',
    ok,
    ok ? `${row.name}: ${row.latitude}, ${row.longitude}` : undefined,
  );
}

async function checkGeneratedColumnsRejectWrites(): Promise<void> {
  try {
    await AppDataSource.query(`UPDATE warehouses SET latitude = 0`);
    record(
      'UPDATE warehouses SET latitude = 0 is rejected by PostgreSQL',
      false,
      'UPDATE succeeded — it should not have',
    );
  } catch {
    record(
      'UPDATE warehouses SET latitude = 0 is rejected by PostgreSQL',
      true,
    );
  }
}

interface SeedScenario {
  name: string;
  sku: string;
  expectWarehouses: number;
}

const SEED_SCENARIOS: SeedScenario[] = [
  {
    name: 'exactly one warehouse viable (AirPods Pro 3)',
    sku: 'APL-AIRPODSPRO3',
    expectWarehouses: 1,
  },
  {
    name: 'several viable, spread nationally (iPhone 17)',
    sku: 'APL-IP17-256-BLK',
    expectWarehouses: 3,
  },
  {
    name: 'short everywhere, max 2 (MacBook Pro 16")',
    sku: 'APL-MBP16-M4P-1TB',
    expectWarehouses: 5,
  },
  {
    name: 'exact-quantity boundary, 5 units (iPad Pro 11")',
    sku: 'APL-IPADPRO11-M4-256',
    expectWarehouses: 1,
  },
];

async function checkFourSeedScenarios(): Promise<void> {
  for (const scenario of SEED_SCENARIOS) {
    const rows = await AppDataSource.query<{ quantity_available: number }[]>(
      `SELECT i.quantity_available FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE p.sku = $1`,
      [scenario.sku],
    );
    record(
      `seed scenario: ${scenario.name}`,
      rows.length === scenario.expectWarehouses,
      `${rows.length} warehouse(s), quantities: ${rows.map((r) => r.quantity_available).join(',')}`,
    );
  }

  // The exact-quantity boundary case must be exactly 5, not just present.
  const boundary = await AppDataSource.query<{ quantity_available: number }[]>(
    `SELECT i.quantity_available FROM inventory i
     JOIN products p ON p.id = i.product_id
     WHERE p.sku = 'APL-IPADPRO11-M4-256'`,
  );
  record(
    'exact-quantity boundary case is exactly 5 units',
    boundary.length === 1 && Number(boundary[0].quantity_available) === 5,
  );
}

/**
 * Everything that proves a rejection — negative inventory, a zero
 * order_items.quantity, a second CAPTURED payment — needs a real
 * warehouse/product (from the seed) and a throwaway customer/order to
 * satisfy foreign keys. All of it happens in one transaction, rolled back
 * at the end regardless of outcome.
 */
async function checkRejectionsInARolledBackTransaction(): Promise<void> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const [warehouse] = (await queryRunner.query(
      `SELECT id FROM warehouses LIMIT 1`,
    )) as {
      id: string;
    }[];
    const [product] = (await queryRunner.query(
      `SELECT id FROM products LIMIT 1`,
    )) as {
      id: string;
    }[];

    if (!warehouse || !product) {
      record(
        'rejection checks (inventory/order_items/payments)',
        false,
        'no seeded warehouse or product found — run the seed first',
      );
      return;
    }

    // A failed statement poisons the whole transaction in Postgres — every
    // later query errors with "current transaction is aborted" even if it
    // is perfectly valid, until a ROLLBACK. A SAVEPOINT scopes that damage
    // to just the one statement expected to fail, so the transaction can
    // keep going for the checks after it. (Found this the hard way: the
    // first version of this function had no savepoints and every check
    // after the first expected failure reported a false negative.)
    async function expectRejection(
      name: string,
      sql: string,
      params: unknown[],
    ): Promise<void> {
      await queryRunner.query('SAVEPOINT before_check');
      try {
        await queryRunner.query(sql, params);
        record(
          name,
          false,
          'the statement succeeded — it should have been rejected',
        );
        await queryRunner.query('ROLLBACK TO SAVEPOINT before_check');
      } catch {
        record(name, true);
        await queryRunner.query('ROLLBACK TO SAVEPOINT before_check');
      }
    }

    // --- inventory.quantity_available >= 0 -------------------------------
    await expectRejection(
      'inventory.quantity_available = -1 is rejected',
      `INSERT INTO inventory (warehouse_id, product_id, quantity_available)
       VALUES ($1, $2, -1)
       ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
      [warehouse.id, product.id],
    );

    // --- throwaway customer + order, for the order_items / payments checks
    const [customer] = (await queryRunner.query(
      `INSERT INTO customers (email, full_name) VALUES ('verify-schema@example.com', 'Verify Schema')
       RETURNING id`,
    )) as { id: string }[];
    const [order] = (await queryRunner.query(
      `INSERT INTO orders (order_number, customer_id, warehouse_id, total_cents, shipping_address, shipping_location)
       VALUES (
         'VERIFY-SCHEMA-TEMP',
         $1, $2, 100,
         '{"recipient":"Verify","line1":"1 Test Way","city":"Test","country":"US"}'::jsonb,
         ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography
       )
       RETURNING id`,
      [customer.id, warehouse.id],
    )) as { id: string }[];

    // --- order_items.quantity > 0 ----------------------------------------
    await expectRejection(
      'order_items.quantity = 0 is rejected',
      `INSERT INTO order_items (order_id, product_id, quantity, product_sku_snapshot, product_name_snapshot, unit_price_cents)
       VALUES ($1, $2, 0, 'TEMP', 'Temp', 100)`,
      [order.id, product.id],
    );

    // --- at most one CAPTURED payment per order ---------------------------
    await queryRunner.query(
      `INSERT INTO payments (order_id, attempt, idempotency_key, status, amount_cents)
       VALUES ($1, 1, 'verify-schema-1', 'CAPTURED', 100)`,
      [order.id],
    );
    await expectRejection(
      'a second CAPTURED payment for the same order is rejected',
      `INSERT INTO payments (order_id, attempt, idempotency_key, status, amount_cents)
       VALUES ($1, 2, 'verify-schema-2', 'CAPTURED', 100)`,
      [order.id],
    );
  } finally {
    // Always roll back — pass or fail, none of this belongs in real data.
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  }
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  await checkPostgisExtension();
  await checkGistIndex();
  await checkConstraintsExist();
  await checkPartialUniqueIndexExists();
  await checkGeneratedColumnsReadable();
  await checkGeneratedColumnsRejectWrites();
  await checkFourSeedScenarios();
  await checkRejectionsInARolledBackTransaction();

  await AppDataSource.destroy();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(
      `${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`,
    );
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`,
  );

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
