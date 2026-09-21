import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { PgBoss } from 'pg-boss';

import { registerDlqGauge } from './dlq-gauge';
import { setupQueues } from '../messaging/queue-setup';
import { AppDataSource } from '../database/data-source';

const DLQ_NAMES = [
  'shipment.create.dlq',
  'customer.notify.dlq',
  'analytics.record.dlq',
];

/**
 * SPEC 04 step 8 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable. Registers its own `MeterProvider` with an
 * `InMemoryMetricExporter` (nothing in a test process ever imports
 * `tracing.ts`) and drives collection on demand via `forceFlush()` instead
 * of waiting out `DLQ_GAUGE_INTERVAL_MS`.
 *
 * `readGaugeByQueue()` is called at most **once** in this whole file:
 * `getQueueStats(name, { force: true })` (`dlq-gauge.ts`) throttles to one
 * real recomputation per queue per 60 s (step 1 finding, hit again here —
 * a second call moments later silently returned the pre-probe snapshot).
 * The baseline instead comes from a plain `count(*)` against `pgboss.job`,
 * which is never throttled.
 */
describe('DLQ gauge (integration)', () => {
  let boss: PgBoss;
  let exporter: InMemoryMetricExporter;
  let provider: MeterProvider;

  beforeAll(async () => {
    await AppDataSource.initialize();

    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          // Never actually waited out — the one read below goes through
          // forceFlush() instead. Any finite value satisfies the reader.
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);

    registerDlqGauge(boss);
  });

  afterAll(async () => {
    await boss.stop();
    await provider.shutdown();
    await AppDataSource.destroy();
  });

  async function countsByQueueViaSql(): Promise<Map<string, number>> {
    const rows: { name: string; count: string }[] = await AppDataSource.query(
      'select name, count(*) from pgboss.job where name = ANY($1) group by name',
      [DLQ_NAMES],
    );
    return new Map(rows.map((row) => [row.name, Number(row.count)]));
  }

  async function readGaugeByQueue(): Promise<Map<string, number>> {
    exporter.reset();
    await provider.forceFlush();

    const [resourceMetrics]: ResourceMetrics[] = exporter.getMetrics();
    const metric = resourceMetrics?.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((candidate) => candidate.descriptor.name === 'queue.dlq.size');

    const byQueue = new Map<string, number>();
    for (const dataPoint of metric?.dataPoints ?? []) {
      const queue = (dataPoint.attributes as { queue: string }).queue;
      byQueue.set(queue, dataPoint.value as number);
    }
    return byQueue;
  }

  it('reports one queue.dlq.size data point per DLQ, and the one that just received a job includes it while the other two stay unchanged', async () => {
    const baseline = await countsByQueueViaSql();

    const jobId = await boss.send('shipment.create.dlq', { probe: true });
    expect(jobId).not.toBeNull();

    try {
      // Deterministically defeat getQueueStats({force:true})'s 60s cache
      // (step 1 finding) instead of racing it or sleeping for real: back-date
      // pgboss.queue's own monitor_on so the read below is guaranteed to
      // see a stale cache and genuinely recompute.
      await AppDataSource.query(
        `update pgboss.queue set monitor_on = now() - interval '2 minutes' where name = ANY($1)`,
        [DLQ_NAMES],
      );

      const byQueue = await readGaugeByQueue();

      expect(new Set(byQueue.keys())).toEqual(new Set(DLQ_NAMES));
      expect(byQueue.get('shipment.create.dlq')).toBe(
        (baseline.get('shipment.create.dlq') ?? 0) + 1,
      );
      expect(byQueue.get('customer.notify.dlq')).toBe(
        baseline.get('customer.notify.dlq') ?? 0,
      );
      expect(byQueue.get('analytics.record.dlq')).toBe(
        baseline.get('analytics.record.dlq') ?? 0,
      );
    } finally {
      if (jobId) {
        await boss.deleteJob('shipment.create.dlq', jobId);
      }
    }
  });
});
