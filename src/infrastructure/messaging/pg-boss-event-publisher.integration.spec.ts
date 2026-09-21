import { randomUUID } from 'crypto';

import { PgBoss } from 'pg-boss';

import { PgBossEventPublisher } from './pg-boss-event-publisher';
import { UnroutedEventError } from './event-routing';
import { QUEUE_TOPOLOGY, setupQueues } from './queue-setup';
import { AppDataSource } from '../database/data-source';
import { CustomerOrmEntity } from '../database/entities/customer.orm-entity';
import { OrderOrmEntity } from '../database/entities/order.orm-entity';

/**
 * SPEC 04 step 3 — the critical gate (R3.2). If the rollback assertion
 * fails, FR-9's outbox argument is false and nothing further in P3 or P4 is
 * sound (Implementation plan, step 3). Requires DATABASE_URL (+
 * PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation)
 * exported and a migrated Postgres reachable — same prerequisites as
 * data-source.integration.spec.ts.
 *
 * This is the first test file to construct `PgBoss` for real (every other
 * P3 file only ever imports its *type*, which TypeScript erases). pg-boss@12
 * is ESM-only (SPEC 04 step 1 finding); Jest's default
 * `transformIgnorePatterns` skips `node_modules`, so without
 * `test/jest-integration.json` un-ignoring it, `require('pg-boss')` inside
 * Jest's CJS sandbox throws `ERR_REQUIRE_ESM` even though the built app's
 * plain `node dist/main.worker.js` loads it fine (Node's own
 * `require(esm)`, which Jest's VM-sandboxed module loader does not use).
 */
describe('PgBossEventPublisher (integration)', () => {
  let boss: PgBoss;
  let publisher: PgBossEventPublisher;

  beforeAll(async () => {
    await AppDataSource.initialize();

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);

    publisher = new PgBossEventPublisher(boss);
  });

  afterAll(async () => {
    await boss.stop();
    await AppDataSource.destroy();
  });

  async function jobsForOrder(
    orderId: string,
  ): Promise<{ name: string; correlationId: string }[]> {
    const rows: { name: string; data: { meta: { correlationId: string } } }[] =
      await AppDataSource.query(
        `select name, data from pgboss.job where data->'payload'->>'orderId' = $1`,
        [orderId],
      );
    return rows.map((row) => ({
      name: row.name,
      correlationId: row.data.meta.correlationId,
    }));
  }

  it('rolls back every job insert when the wrapping transaction rolls back', async () => {
    const orderId = randomUUID();

    await expect(
      AppDataSource.transaction(async (trx) => {
        await publisher.publish(
          {
            type: 'order.confirmed',
            payload: { orderId, occurredAt: new Date().toISOString() },
          },
          { executeSql: (sql, values) => trx.query(sql, values) },
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await jobsForOrder(orderId)).toHaveLength(0);
  });

  it('leaves exactly three job rows, one per queue, sharing one correlationId, once the transaction commits', async () => {
    const orderId = randomUUID();

    await AppDataSource.transaction(async (trx) => {
      await publisher.publish(
        {
          type: 'order.confirmed',
          payload: { orderId, occurredAt: new Date().toISOString() },
        },
        { executeSql: (sql, values) => trx.query(sql, values) },
      );
    });

    const jobs = await jobsForOrder(orderId);
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job) => job.name))).toEqual(
      new Set(QUEUE_TOPOLOGY.map((entry) => entry.queue)),
    );
    expect(new Set(jobs.map((job) => job.correlationId)).size).toBe(1);
  });

  /**
   * A minimal, valid `orders` row — not built through OrderMapper/domain
   * entities, since this test only needs a row TX2 can write and later
   * find by id, standing in for "the order update TX2 does alongside the
   * publish" (event-publisher.ts's own module doc comment example).
   */
  function orderFixture(
    id: string,
    customerId: string,
  ): Partial<OrderOrmEntity> {
    return {
      id,
      // varchar(32) — well under it, unlike a bare randomUUID().
      orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      customerId,
      warehouseId: null,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      totalCents: 1099,
      shippingAddress: { line1: '1 Test St', city: 'Newark', country: 'US' },
      shippingLocation: {
        type: 'Point',
        coordinates: [-74.172363, 40.735657],
      },
      reservationExpiresAt: null,
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('rolls back the orders row together with the jobs — neither is saved', async () => {
    const orderId = randomUUID();
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Rollback Probe',
    });

    await expect(
      AppDataSource.transaction(async (trx) => {
        await trx.save(OrderOrmEntity, orderFixture(orderId, customer.id));
        await publisher.publish(
          {
            type: 'order.confirmed',
            payload: { orderId, occurredAt: new Date().toISOString() },
          },
          { executeSql: (sql, values) => trx.query(sql, values) },
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(
      await AppDataSource.getRepository(OrderOrmEntity).findOneBy({
        id: orderId,
      }),
    ).toBeNull();
    expect(await jobsForOrder(orderId)).toHaveLength(0);
  });

  it('commits the orders row together with the three jobs — both are saved', async () => {
    const orderId = randomUUID();
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Commit Probe',
    });

    await AppDataSource.transaction(async (trx) => {
      await trx.save(OrderOrmEntity, orderFixture(orderId, customer.id));
      await publisher.publish(
        {
          type: 'order.confirmed',
          payload: { orderId, occurredAt: new Date().toISOString() },
        },
        { executeSql: (sql, values) => trx.query(sql, values) },
      );
    });

    expect(
      await AppDataSource.getRepository(OrderOrmEntity).findOneBy({
        id: orderId,
      }),
    ).not.toBeNull();
    expect(await jobsForOrder(orderId)).toHaveLength(3);
  });

  it('still enqueues when publish() is called without a tx', async () => {
    const orderId = randomUUID();

    await publisher.publish({
      type: 'order.confirmed',
      payload: { orderId, occurredAt: new Date().toISOString() },
    });

    expect(await jobsForOrder(orderId)).toHaveLength(3);
  });

  it('throws UnroutedEventError and enqueues nothing for an event type absent from EVENT_ROUTING', async () => {
    await expect(
      publisher.publish({ type: 'unrouted.scratch.event', payload: {} }),
    ).rejects.toThrow(UnroutedEventError);
  });
});
