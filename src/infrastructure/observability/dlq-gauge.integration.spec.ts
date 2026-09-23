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
 * Own `MeterProvider` + in-memory exporter. `getQueueStats({ force: true })`
 * is throttled, so it's called once here; the baseline uses `count(*)`.
 * See knowledge/investigations.md#pgboss-queue-stats-throttle
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
      // Back-date pgboss.queue.monitor_on to defeat the 60 s stats cache
      // deterministically.
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
