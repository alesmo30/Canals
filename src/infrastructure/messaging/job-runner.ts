import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, PgBoss } from 'pg-boss';

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
 * `meta` (correlationId/traceparent restoration, the `job <queue>` span)
 * is step 7's addition.
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
      await this.boss.work<JobBody>(
        handler.queue,
        {
          pollingIntervalSeconds,
          notifyPollingIntervalSeconds: pollingIntervalSeconds,
        },
        async (jobs: Job<JobBody>[]) => {
          const [job] = jobs;
          await handler.handle(job.data.payload);
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
