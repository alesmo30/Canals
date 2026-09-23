import { PgBoss } from 'pg-boss';

/** pg-boss counts retries after the first attempt: retryLimit 4 = 5 attempts total. */
export const QUEUE_RETRY_LIMIT = 4;
export const QUEUE_RETRY_DELAY_SECONDS = 1;
export const QUEUE_RETRY_DELAY_MAX_SECONDS = 60;

/**
 * DLQ jobs have no consumer. A dead-lettered job takes its retention from
 * the DLQ it lands in, not from its source queue.
 */
export const DLQ_RETENTION_DAYS = 30;

export interface QueueTopologyEntry {
  readonly queue: string;
  readonly deadLetter: string;
}

/** Single source of truth, also read by JobRunner and the DLQ gauge. */
export const QUEUE_TOPOLOGY: readonly QueueTopologyEntry[] = [
  { queue: 'shipment.create', deadLetter: 'shipment.create.dlq' },
  { queue: 'customer.notify', deadLetter: 'customer.notify.dlq' },
  { queue: 'analytics.record', deadLetter: 'analytics.record.dlq' },
];

export interface ScheduledJobEntry {
  readonly queue: string;
  readonly cron: string;
}

/**
 * Reaper and reconciliation, every minute on the worker. No DLQ: a failed
 * tick is just the next minute's run.
 */
export const SCHEDULED_JOBS: readonly ScheduledJobEntry[] = [
  { queue: 'reservation.reap', cron: '* * * * *' },
  { queue: 'payment.reconcile', cron: '* * * * *' },
];

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Runs at boot in both processes; idempotent. Each DLQ is created before
 * the queue that references it (pg-boss requires it).
 */
export async function setupQueues(boss: PgBoss): Promise<void> {
  for (const { deadLetter } of QUEUE_TOPOLOGY) {
    await boss.createQueue(deadLetter, {
      retentionSeconds: DLQ_RETENTION_DAYS * SECONDS_PER_DAY,
    });
  }

  for (const { queue, deadLetter } of QUEUE_TOPOLOGY) {
    await boss.createQueue(queue, {
      notify: true,
      deadLetter,
      retryLimit: QUEUE_RETRY_LIMIT,
      retryBackoff: true,
      retryDelay: QUEUE_RETRY_DELAY_SECONDS,
      retryDelayMax: QUEUE_RETRY_DELAY_MAX_SECONDS,
    });
  }

  for (const { queue } of SCHEDULED_JOBS) {
    await boss.createQueue(queue, { retryLimit: 0 });
  }
}
