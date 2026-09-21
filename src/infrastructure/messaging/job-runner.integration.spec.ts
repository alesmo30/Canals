import { randomUUID } from 'crypto';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

import { JobRunner } from './job-runner';
import { PgBossEventPublisher } from './pg-boss-event-publisher';
import {
  DLQ_RETENTION_DAYS,
  QUEUE_RETRY_DELAY_MAX_SECONDS,
  QUEUE_RETRY_DELAY_SECONDS,
  QUEUE_RETRY_LIMIT,
  QUEUE_TOPOLOGY,
  setupQueues,
} from './queue-setup';
import { AppConfig } from '../config/env.schema';
import { JobHandler } from '../../application/jobs/job-handler';
import { ShipmentCreateHandler } from '../../application/jobs/shipment-create.handler';
import { ShipmentService } from '../../application/jobs/shipment.service';
import { CustomerNotifyHandler } from '../../application/jobs/customer-notify.handler';
import { AnalyticsRecordHandler } from '../../application/jobs/analytics-record.handler';
import { AppDataSource } from '../database/data-source';

/**
 * SPEC 04 step 6 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable. Both tests run with a fast poll interval
 * (`FAST_CONFIG_SERVICE`) so five attempts take seconds, not minutes
 * (Risks: "the shipped values are asserted once by a test that reads back
 * the queue configuration created at boot" — see the last `it()` below;
 * QUEUE_RETRY_LIMIT/_DELAY_SECONDS/_DELAY_MAX_SECONDS themselves are never
 * redefined for the test).
 *
 * The realistic test temporarily speeds up the *real* `shipment.create`
 * queue's retry timing via `updateQueue`, then restores it — safe here
 * because the integration CI job runs only `postgres`, no live worker
 * consuming the same queues (`.github/workflows/tests.yml`). Running this
 * file locally against a `docker compose up`'d worker will race it —
 * `docker compose stop worker` first.
 */
const FAST_POLLING_INTERVAL_SECONDS = 1;
const FAST_CONFIG_SERVICE = {
  get: () => FAST_POLLING_INTERVAL_SECONDS,
} as unknown as ConfigService<AppConfig, true>;

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

/**
 * Reads `pgboss.job` directly rather than `boss.getQueueStats(name, {
 * force: true })`: that call throttles to one real recomputation per
 * *queue* per 60 s (`QUEUE_STATS_FORCE_TTL_SECONDS` in
 * `node_modules/pg-boss/dist/manager.js`) and serves the cached result to
 * every call inside that window — fine for step 8's gauge, which only ever
 * samples once every `DLQ_GAUGE_INTERVAL_MS` (60 s), but it silently
 * starves a tight poll loop like this one (found by this test timing out
 * at exactly its 20 s deadline despite the row landing 9 s in). None of
 * this repo's queues set `partition: true`, so every job — including a
 * dead-lettered one — lives in the one shared `pgboss.job` table.
 */
async function dlqRowCount(dlqName: string): Promise<number> {
  const rows: { count: string }[] = await AppDataSource.query(
    'select count(*) from pgboss.job where name = $1',
    [dlqName],
  );
  return Number(rows[0].count);
}

async function dlqRow(
  dlqName: string,
): Promise<{ source_retry_count: number; output: unknown } | undefined> {
  const rows: { source_retry_count: number; output: unknown }[] =
    await AppDataSource.query(
      'select source_retry_count, output from pgboss.job where name = $1 order by created_on desc limit 1',
      [dlqName],
    );
  return rows[0];
}

describe('JobRunner — retries and dead-letter queues (integration)', () => {
  let boss: PgBoss;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    await AppDataSource.initialize();
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);
  });

  afterAll(async () => {
    await boss.stop();
    await AppDataSource.destroy();
  });

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('synthetic: a handler that always throws is attempted exactly 5 times, lands in its DLQ, and logs 5 ascending warn lines', async () => {
    const suffix = Date.now();
    const queueName = `debug.always-fail.${suffix}`;
    const dlqName = `debug.always-fail.dlq.${suffix}`;

    await boss.createQueue(dlqName, {
      retentionSeconds: DLQ_RETENTION_DAYS * 24 * 60 * 60,
    });
    await boss.createQueue(queueName, {
      notify: true,
      deadLetter: dlqName,
      retryLimit: QUEUE_RETRY_LIMIT,
      retryBackoff: true,
      // retryDelay/retryDelayMax must be integer seconds (pg-boss
      // validation) — 1 is the fastest this can go.
      retryDelay: 1,
      retryDelayMax: 1,
    });

    const handler: JobHandler<unknown> = {
      queue: queueName,
      handle: () => Promise.reject(new Error('synthetic failure')),
    };
    const runner = new JobRunner(boss, [handler], FAST_CONFIG_SERVICE);
    await runner.start();

    const correlationId = `synthetic-${suffix}`;
    await boss.send(queueName, {
      payload: {},
      meta: {
        correlationId,
        traceparent: null,
        publishedAt: new Date().toISOString(),
      },
    });

    await waitUntil(async () => (await dlqRowCount(dlqName)) >= 1, 20_000);
    await boss.offWork(queueName);

    const row = await dlqRow(dlqName);
    // source_retry_count is the retryCount at the terminal (5th) attempt,
    // 0-indexed (SPEC 04 step 6 — traced against plans.js's failJobsBody/
    // fetch SQL): +1 gives the attempt count R3.5 asks for.
    expect((row?.source_retry_count ?? -1) + 1).toBe(5);
    expect(JSON.stringify(row?.output)).toContain('synthetic failure');

    const attempts = warnSpy.mock.calls
      .map(([arg]) => arg as Record<string, unknown>)
      .filter((call) => call.queue === queueName);
    expect(attempts).toHaveLength(5);
    expect(attempts.map((call) => call.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(attempts.every((call) => call.correlationId === correlationId)).toBe(
      true,
    );
    expect(
      attempts.every((call) => call.retryLimit === QUEUE_RETRY_LIMIT),
    ).toBe(true);

    await boss.deleteQueue(queueName);
    await boss.deleteQueue(dlqName);
  }, 30_000);

  it('realistic: order.confirmed for a non-existent orderId dead-letters shipment.create with a real Postgres constraint violation, while customer.notify and analytics.record complete', async () => {
    // Speed up only the retry timing of the real queue for this test —
    // QUEUE_RETRY_LIMIT (attempt count) is untouched. Integer seconds only
    // (pg-boss validation) — 1 is the fastest this can go.
    await boss.updateQueue('shipment.create', {
      retryBackoff: true,
      retryDelay: 1,
      retryDelayMax: 1,
    });

    try {
      const shipments = new ShipmentService(AppDataSource);
      const handlers: JobHandler<unknown>[] = [
        new ShipmentCreateHandler(shipments),
        new CustomerNotifyHandler(),
        new AnalyticsRecordHandler(),
      ];
      const runner = new JobRunner(boss, handlers, FAST_CONFIG_SERVICE);
      await runner.start();

      const orderId = randomUUID();
      const publisher = new PgBossEventPublisher(boss);
      await publisher.publish({
        type: 'order.confirmed',
        payload: { orderId, occurredAt: new Date().toISOString() },
      });

      // Wait for the full expected end-state, not just the DLQ landing:
      // shipment.create's 5 attempts (with backoff) take noticeably longer
      // than customer.notify/analytics.record's single successful
      // attempt, but each queue polls independently — asserting the
      // instant the DLQ row appears raced the other two on their own next
      // poll tick. Scoped to this run's own orderId (not a bare
      // dlqRowCount) so a DLQ row left over from an earlier local run
      // can't satisfy it early — the dead-lettered copy carries the same
      // `data` as the original job, orderId included.
      let orderJobsRes: { name: string; state: string }[] = [];
      await waitUntil(async () => {
        orderJobsRes = await AppDataSource.query(
          `select name, state from pgboss.job where data->'payload'->>'orderId' = $1`,
          [orderId],
        );
        const byName = new Map(
          orderJobsRes.map((row) => [row.name, row.state]),
        );
        return (
          byName.get('customer.notify') === 'completed' &&
          byName.get('analytics.record') === 'completed' &&
          byName.has('shipment.create.dlq')
        );
      }, 20_000);

      for (const queue of QUEUE_TOPOLOGY.map((entry) => entry.queue)) {
        await boss.offWork(queue);
      }

      const byQueue = new Map(orderJobsRes.map((row) => [row.name, row.state]));
      expect(byQueue.get('customer.notify')).toBe('completed');
      expect(byQueue.get('analytics.record')).toBe('completed');
      // The original shipment.create row is re-inserted terminally
      // 'failed' (not deleted) by pg-boss's failJobsBody — a *separate*
      // copy is what lands in shipment.create.dlq (insertDeadLetterJob,
      // SPEC 04 step 1 finding).
      expect(byQueue.get('shipment.create')).toBe('failed');

      // Scoped by orderId (not the generic dlqRow()) so a DLQ row left
      // over from an earlier local run of this same test can't be picked
      // up instead of this run's own.
      const [dlqEntry]: { output: unknown }[] = await AppDataSource.query(
        `select output from pgboss.job where name = 'shipment.create.dlq' and data->'payload'->>'orderId' = $1`,
        [orderId],
      );
      // Not literally "foreign key": Postgres checks NOT NULL constraints
      // (ExecConstraints, before the row is even inserted) ahead of FK
      // triggers (which only fire on an already-inserted row) — verified
      // directly in psql. shipment.service.ts's warehouse_id subquery
      // resolves NULL for a missing order exactly like it does for an
      // existing order with no warehouse_id, so this scenario surfaces as
      // the same not-null violation, never the order_id FK (SPEC 04
      // Decisions, "The event contract" — deviation recorded there).
      expect(JSON.stringify(dlqEntry?.output).toLowerCase()).toContain(
        'not-null constraint',
      );
    } finally {
      // Restore the real queue's shipped retry timing regardless of
      // outcome — the next it() asserts against it.
      await boss.updateQueue('shipment.create', {
        retryBackoff: true,
        retryDelay: QUEUE_RETRY_DELAY_SECONDS,
        retryDelayMax: QUEUE_RETRY_DELAY_MAX_SECONDS,
      });
    }
  }, 30_000);

  it('the shipped shipment.create queue keeps the constants queue-setup.ts created it with', async () => {
    const queue = await boss.getQueue('shipment.create');
    expect(queue).toMatchObject({
      notify: true,
      deadLetter: 'shipment.create.dlq',
      retryLimit: QUEUE_RETRY_LIMIT,
      retryBackoff: true,
      retryDelay: QUEUE_RETRY_DELAY_SECONDS,
      retryDelayMax: QUEUE_RETRY_DELAY_MAX_SECONDS,
    });

    const dlq = await boss.getQueue('shipment.create.dlq');
    expect(dlq?.retentionSeconds).toBe(DLQ_RETENTION_DAYS * 24 * 60 * 60);
  });
});
