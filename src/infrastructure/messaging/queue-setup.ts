import { PgBoss } from 'pg-boss';

/**
 * R3.5 asks for a maximum of 5 attempts; pg-boss counts retries *after* the
 * first attempt, so `retryLimit: 4` is 5 attempts total (SPEC 04 Decisions,
 * "Retries and dead-letter queues").
 */
export const QUEUE_RETRY_LIMIT = 4;
export const QUEUE_RETRY_DELAY_SECONDS = 1;
export const QUEUE_RETRY_DELAY_MAX_SECONDS = 60;

/**
 * DLQ jobs have no consumer, so pg-boss's ordinary maintenance would
 * eventually remove them. This is the DLQ *queue's own* `retentionSeconds`
 * — a dead-lettered job copies its retention (and retry) configuration from
 * the DLQ it lands in, not from the queue it failed out of (SPEC 04 step 1
 * finding, confirmed against `pg-boss@12.33.2`'s `insertDeadLetterJob` SQL).
 */
export const DLQ_RETENTION_DAYS = 30;

export interface QueueTopologyEntry {
  readonly queue: string;
  readonly deadLetter: string;
}

/** SPEC 04 Data model, "Queue topology". Single source of truth: also read by the JobRunner (step 4) and the DLQ gauge (step 8). */
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
 * SPEC 07 — the reservation reaper (R6.1) and payment reconciliation
 * (R6.2), run every minute by the worker's own scheduler
 * (`JobRunner.start()`). No `deadLetter` here (below): a failed run is
 * simply the next minute's run — a dead-letter copy of an empty tick is
 * noise.
 */
export const SCHEDULED_JOBS: readonly ScheduledJobEntry[] = [
  { queue: 'reservation.reap', cron: '* * * * *' },
  { queue: 'payment.reconcile', cron: '* * * * *' },
];

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Runs at boot in both processes (api and worker). Idempotent:
 * `createQueue` is a no-op when the queue already exists (verified SPEC 04
 * step 1), so a restart of either process creates nothing new. Each DLQ is
 * created before the queue that references it — pg-boss rejects a
 * `deadLetter` pointing at a queue that does not exist yet.
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
