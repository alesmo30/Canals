import { randomUUID } from 'crypto';

import { PgBoss } from 'pg-boss';
import { DataSource } from 'typeorm';

import { validateEnv } from '../src/infrastructure/config/env.schema';
import { PERSISTENCE_ENTITIES } from '../src/infrastructure/database/persistence-entities';
import { EVENT_ROUTING } from '../src/infrastructure/messaging/event-routing';
import { PgBossEventPublisher } from '../src/infrastructure/messaging/pg-boss-event-publisher';
import { setupQueues } from '../src/infrastructure/messaging/queue-setup';

/**
 * specs/04-queue-worker-observability.md step 11 — the phase's own
 * "small driver script" (SPEC 03's `payments-check.ts` precedent):
 * publishes `order.confirmed` for a fixture order against the real queues
 * and proves the whole HTTP-shaped path end to end without a browser —
 * `npm run verify`'s replacement for eyeballing Grafana. Deliberately does
 * *not* start a `JobRunner`: a real worker (compose, or whatever process
 * is running `test:integration`'s migrations against) must already be
 * consuming, so a stopped worker is exactly what turns this red.
 */
const TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 1_000;

// Fixed ids: idempotent upsert of the same customer/warehouse fixture
// every run, distinct from concurrency-check.ts's own harness (d0...) so
// the two scripts never contend on the same rows.
const HARNESS_CUSTOMER_ID = 'e0000000-0000-0000-0000-000000000001';
const HARNESS_WAREHOUSE_ID = 'e0000000-0000-0000-0000-000000000002';

async function seedFixtureOrder(dataSource: DataSource): Promise<string> {
  await dataSource.query(
    `INSERT INTO customers (id, email, full_name)
     VALUES ($1, 'events-check@example.com', 'Events Check Customer')
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_CUSTOMER_ID],
  );

  await dataSource.query(
    `INSERT INTO warehouses (id, name, address, location, is_active)
     VALUES ($1, 'Events Check WH', '{}'::jsonb, ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography, true)
     ON CONFLICT (id) DO NOTHING`,
    [HARNESS_WAREHOUSE_ID],
  );

  // A fresh order every run (order_number is UNIQUE) — ShipmentService
  // reads `warehouse_id` straight off this row (shipment.service.ts), so
  // it must be set here for shipment.create to succeed rather than
  // dead-letter.
  const orderId = randomUUID();
  await dataSource.query(
    `INSERT INTO orders
       (id, order_number, customer_id, warehouse_id, status, currency, total_cents, shipping_address, shipping_location)
     VALUES ($1, $2, $3, $4, 'CONFIRMED', 'USD', 1000, '{"line1":"1 Test Way","city":"Test City","country":"US"}'::jsonb, ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography)`,
    [
      orderId,
      `CNL-EC-${Math.floor(Math.random() * 1_000_000_000)}`,
      HARNESS_CUSTOMER_ID,
      HARNESS_WAREHOUSE_ID,
    ],
  );

  return orderId;
}

interface JobRow {
  name: string;
  state: string;
}

async function pollJobs(
  dataSource: DataSource,
  orderId: string,
  queues: readonly string[],
): Promise<JobRow[]> {
  const deadline = Date.now() + TIMEOUT_MS;

  for (;;) {
    const rows = await dataSource.query<JobRow[]>(
      `SELECT name, state FROM pgboss.job
       WHERE name = ANY($1) AND data->'payload'->>'orderId' = $2`,
      [queues, orderId],
    );

    const byQueue = new Map(rows.map((row) => [row.name, row.state]));
    const allSettled = queues.every((queue) => {
      const state = byQueue.get(queue);
      return (
        state === 'completed' || state === 'failed' || state === 'cancelled'
      );
    });
    if (allSettled) return rows;

    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${TIMEOUT_MS}ms waiting for jobs to settle. Last seen: ` +
          queues
            .map((queue) => `${queue}=${byQueue.get(queue) ?? 'missing'}`)
            .join(', '),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  const config = validateEnv(process.env);

  const dataSource = new DataSource({
    type: 'postgres',
    url: config.DATABASE_URL,
    entities: PERSISTENCE_ENTITIES,
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();

  // supervise/schedule: false — this script only publishes and reads, the
  // real worker (whoever is running) owns maintenance and consumption
  // (pg-boss.provider.ts's own role split).
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    max: 2,
    supervise: false,
    schedule: false,
  });
  boss.on('error', (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
  });

  const queues = EVENT_ROUTING['order.confirmed'];

  try {
    await boss.start();
    await setupQueues(boss);

    const orderId = await seedFixtureOrder(dataSource);
    console.log(`--- events-check --- orderId=${orderId}`);

    const publisher = new PgBossEventPublisher(boss);
    await publisher.publish({
      type: 'order.confirmed',
      payload: { orderId, occurredAt: new Date().toISOString() },
    });

    const jobs = await pollJobs(dataSource, orderId, queues);

    const [shipment] = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM shipments WHERE order_id = $1`,
      [orderId],
    );

    const problems: string[] = [];
    for (const queue of queues) {
      const job = jobs.find((row) => row.name === queue);
      if (job?.state !== 'completed') {
        problems.push(
          `${queue}: expected state "completed", got "${job?.state ?? 'missing'}"`,
        );
      }
    }
    if (!shipment) {
      problems.push('expected exactly one shipment row, got none');
    }

    console.log(
      `jobs: ${jobs.map((row) => `${row.name}=${row.state}`).join(', ')}`,
    );
    console.log(`shipment: ${shipment ? shipment.id : 'MISSING'}`);

    if (problems.length > 0) {
      console.error('FAILED:');
      problems.forEach((problem) => console.error(`  - ${problem}`));
      process.exit(1);
    }

    console.log('PASSED');
  } finally {
    await boss.stop({ graceful: false, close: true });
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
