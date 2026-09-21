import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobWithMetadata, PgBoss } from 'pg-boss';

import { PG_BOSS } from './pg-boss.provider';
import { JobBody } from './job-envelope';
import { AppConfig } from '../config/env.schema';
import { JOB_HANDLERS, JobHandler } from '../../application/jobs/job-handler';

/**
 * Stays under compose's 30 s `stop_grace_period` (step 10) so Docker never
 * SIGKILLs mid-job (SPEC 04 Decisions, "The worker, its connections and
 * shutdown").
 */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * Started from `main.worker.ts` (`await app.get(JobRunner).start()`,
 * `infrastructure.md` §3). Registers one `boss.work()` per handler in
 * `JOB_HANDLERS`, dispatching each job to that handler's `payload` only —
 * restoring `correlationId`/`traceparent` into the logging/trace context
 * (AsyncLocalStorage, the `job <queue>` span) is step 7's addition. A
 * thrown error is logged here — `queue`, `jobId`, `attempt`, `retryLimit`,
 * `error`, `correlationId` — and re-thrown so pg-boss's own retry/dead-letter
 * transition still runs; this warn line is the per-attempt failure history
 * pg-boss itself does not keep (R3.5).
 */
@Injectable()
export class JobRunner implements OnApplicationShutdown {
  private readonly logger = new Logger(JobRunner.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    @Inject(JOB_HANDLERS)
    private readonly handlers: JobHandler<unknown>[],
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async start(): Promise<void> {
    // SPEC 04 step 1 finding: `notify: true` on a queue only changes which
    // *backstop* poll applies once the LISTEN/NOTIFY listener is up
    // (`notifyPollingIntervalSeconds`) — the base `pollingIntervalSeconds`
    // is what's used otherwise. infrastructure.md §7 commits to a 15 s
    // worst case for a retried or scheduled job regardless of listener
    // state, so both fields are set here, to the same value.
    const pollingIntervalSeconds = this.configService.get(
      'PGBOSS_POLL_INTERVAL_SECONDS',
      { infer: true },
    );

    for (const handler of this.handlers) {
      await this.boss.work(
        handler.queue,
        {
          pollingIntervalSeconds,
          notifyPollingIntervalSeconds: pollingIntervalSeconds,
          includeMetadata: true,
        },
        async (jobs: JobWithMetadata<JobBody>[]) => {
          const [job] = jobs;
          try {
            await handler.handle(job.data.payload);
          } catch (error: unknown) {
            this.logger.warn({
              queue: handler.queue,
              jobId: job.id,
              attempt: job.retryCount + 1,
              retryLimit: job.retryLimit,
              error: error instanceof Error ? error.message : String(error),
              correlationId: job.data.meta.correlationId,
            });
            throw error;
          }
        },
      );
      this.logger.log({ queue: handler.queue, pollingIntervalSeconds });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({
      graceful: true,
      timeout: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    });
  }
}
