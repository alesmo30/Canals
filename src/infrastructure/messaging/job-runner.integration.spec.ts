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
  SCHEDULED_JOBS,
  setupQueues,
} from './queue-setup';
import { AppConfig } from '../config/env.schema';
import { JobHandler } from '../../application/jobs/job-handler';
import { ShipmentCreateHandler } from '../../application/jobs/shipment-create.handler';
import { ShipmentService } from '../../application/jobs/shipment.service';
import { CustomerNotifyHandler } from '../../application/jobs/customer-notify.handler';
import { AnalyticsRecordHandler } from '../../application/jobs/analytics-record.handler';
import { AppDataSource } from '../database/data-source';
import { getCorrelationId } from '../observability/correlation';

/**
 * Fast poll interval so five attempts take seconds. Temporarily speeds up
 * the real `shipment.create` queue — stop any local worker first or it will
 * race. See knowledge/testing.md#job-runner-tests
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
 * Reads `pgboss.job` directly: `getQueueStats({ force: true })` recomputes at
 * most once per queue per 60 s and would starve this poll loop.
 * See knowledge/investigations.md#pgboss-queue-stats-throttle
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
    // Dead-lettering happens on pg-boss's supervise pass (default 60 s);
    // sped up so the DLQ row lands within the test budget.
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      superviseIntervalSeconds: 1,
      monitorIntervalSeconds: 1,
    });
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
    // source_retry_count is 0-indexed at the final attempt; +1 gives the
    // attempt count.
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

      // Wait for the full end state, scoped to this run's orderId: queues
      // poll independently, and older DLQ rows carry the same data.
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
      }, 30_000);

      for (const queue of QUEUE_TOPOLOGY.map((entry) => entry.queue)) {
        await boss.offWork(queue);
      }

      const byQueue = new Map(orderJobsRes.map((row) => [row.name, row.state]));
      expect(byQueue.get('customer.notify')).toBe('completed');
      expect(byQueue.get('analytics.record')).toBe('completed');
      // The original job stays as 'failed'; a separate copy lands in the
      // DLQ.
      expect(byQueue.get('shipment.create')).toBe('failed');

      // Scoped by orderId (not the generic dlqRow()) so a DLQ row left
      // over from an earlier local run of this same test can't be picked
      // up instead of this run's own.
      const [dlqEntry]: { output: unknown }[] = await AppDataSource.query(
        `select output from pgboss.job where name = 'shipment.create.dlq' and data->'payload'->>'orderId' = $1`,
        [orderId],
      );
      // Surfaces as a NOT NULL violation, not the order_id FK.
      // See knowledge/investigations.md#not-null-before-fk
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

describe('JobRunner — scheduled jobs (SPEC 07 step 7)', () => {
  let boss: PgBoss;

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

  it('start() schedules both SCHEDULED_JOBS queues, listed by boss.getSchedules()', async () => {
    const runner = new JobRunner(boss, [], FAST_CONFIG_SERVICE);
    await runner.start();

    const schedules = await boss.getSchedules();
    const scheduledNames = schedules.map((schedule) => schedule.name);
    for (const { queue } of SCHEDULED_JOBS) {
      expect(scheduledNames).toContain(queue);
    }
  });

  it('a job with { payload: {} } and no meta runs its handler with a generated correlationId', async () => {
    const suffix = Date.now();
    const queueName = `debug.no-meta.${suffix}`;
    await boss.createQueue(queueName, { retryLimit: 0 });

    let observedCorrelationId: string | undefined;
    let observedPayload: unknown;
    const handler: JobHandler<unknown> = {
      queue: queueName,
      handle: (payload) => {
        observedCorrelationId = getCorrelationId();
        observedPayload = payload;
        return Promise.resolve();
      },
    };
    const runner = new JobRunner(boss, [handler], FAST_CONFIG_SERVICE);
    await runner.start();

    // Mirrors exactly what boss.schedule(queue, cron, { payload: {} })
    // inserts — no meta field at all, the same shape a scheduled job's
    // own tick produces.
    await boss.send(queueName, { payload: {} });

    await waitUntil(
      () => Promise.resolve(observedCorrelationId !== undefined),
      10_000,
    );
    await boss.offWork(queueName);

    expect(observedCorrelationId).toBeDefined();
    expect(observedPayload).toEqual({});

    await boss.deleteQueue(queueName);
  }, 15_000);
});
