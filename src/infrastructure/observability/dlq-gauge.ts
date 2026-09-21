import { metrics } from '@opentelemetry/api';
import type { PgBoss } from 'pg-boss';

import { QUEUE_TOPOLOGY } from '../messaging/queue-setup';

/**
 * SPEC 04 Scope: "One OTel observable gauge, `queue.dlq.size{queue}`, read
 * from pg-boss's queue statistics — the single deliberate exception to
 * 'no business metrics'." Sampled by `tracing.ts`'s `PeriodicExportingMetricReader`
 * (`DLQ_GAUGE_INTERVAL_MS`), which is what actually decides when this
 * callback runs — nothing here schedules its own timer.
 *
 * `getQueueStats(name, { force: true })`, not `getQueue(name)`: SPEC 04
 * step 1 finding — `getQueue()` reads a column on `pgboss.queue` that
 * pg-boss's own monitor refreshes on its own cadence, stale by tens of
 * seconds; `getQueueStats({ force: true })` recomputes from the job table
 * on demand. It does throttle repeated calls to once per 60 s per queue
 * (`QUEUE_STATS_FORCE_TTL_SECONDS`), which is exactly this gauge's own
 * sampling cadence, so every scheduled collection here gets a genuinely
 * fresh read — the throttle only bites a *tighter* poll loop than this
 * one (confirmed the hard way in `job-runner.integration.spec.ts`, step 6).
 */
export function registerDlqGauge(boss: PgBoss): void {
  const meter = metrics.getMeter('canals-worker');
  const gauge = meter.createObservableGauge('queue.dlq.size', {
    description: 'Jobs currently sitting in a dead-letter queue.',
  });

  gauge.addCallback(async (result) => {
    for (const { deadLetter } of QUEUE_TOPOLOGY) {
      const stats = await boss.getQueueStats(deadLetter, { force: true });
      result.observe(stats[0]?.totalCount ?? 0, { queue: deadLetter });
    }
  });
}
