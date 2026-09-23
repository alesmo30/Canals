import { metrics } from '@opentelemetry/api';
import type { PgBoss } from 'pg-boss';

import { QUEUE_TOPOLOGY } from '../messaging/queue-setup';

/**
 * queue.dlq.size{queue}, sampled by tracing.ts's metric reader. Uses
 * getQueueStats({ force: true }) because getQueue() is stale by tens of
 * seconds. See knowledge/observability.md#dlq-gauge
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
