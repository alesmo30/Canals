import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { parseTraceParent } from '@opentelemetry/core';
import type { JobWithMetadata, PgBoss } from 'pg-boss';

import { PG_BOSS } from './pg-boss.provider';
import { JobBody, JobMeta } from './job-envelope';
import { SCHEDULED_JOBS } from './queue-setup';
import { AppConfig } from '../config/env.schema';
import { redact } from '../http/redaction';
import { correlationStorage } from '../observability/correlation';
import { registerDlqGauge } from '../observability/dlq-gauge';
import { WORKER_READINESS_FILE_PATH } from '../health/worker-readiness';
import { JOB_HANDLERS, JobHandler } from '../../application/jobs/job-handler';

/**
 * Each job gets its own trace, linked to the publishing span (OTel
 * messaging convention). The tracer name is cosmetic.
 */
const tracer = trace.getTracer('canals-worker');

/** Must stay under compose's 30 s stop_grace_period so Docker never SIGKILLs mid-job. */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * One boss.work() per handler. Each job runs with its correlationId
 * restored and inside its own root span; errors are logged per attempt and
 * re-thrown so pg-boss's retry/DLQ still runs.
 * See knowledge/messaging-jobs.md#job-runner
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
    registerDlqGauge(this.boss);

    // Both poll intervals set to the same value, so the worst-case pickup
    // holds with or without LISTEN/NOTIFY.
    // See knowledge/investigations.md#pgboss-notify-polling
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
          // Scheduled jobs are born without meta — there's no request to
          // restore context from.
          const meta: JobMeta = job.data.meta ?? {
            correlationId: randomUUID(),
            traceparent: null,
            publishedAt: new Date().toISOString(),
          };
          const { correlationId, traceparent } = meta;
          const parentSpanContext = traceparent
            ? parseTraceParent(traceparent)
            : null;

          const span = tracer.startSpan(`job ${handler.queue}`, {
            root: true,
            kind: SpanKind.CONSUMER,
            links: parentSpanContext
              ? [{ context: parentSpanContext }]
              : undefined,
            attributes: {
              'messaging.destination.name': handler.queue,
              'messaging.message.id': job.id,
              'app.correlation_id': correlationId,
            },
          });

          await correlationStorage.run({ correlationId }, () =>
            context.with(trace.setSpan(context.active(), span), async () => {
              try {
                await handler.handle(job.data.payload);
              } catch (error: unknown) {
                const message =
                  error instanceof Error ? error.message : String(error);
                span.recordException(error as Error);
                // The status message isn't an attribute, so the span
                // exporter doesn't redact it — redact it here.
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: redact(message),
                });
                this.logger.warn({
                  queue: handler.queue,
                  jobId: job.id,
                  attempt: job.retryCount + 1,
                  retryLimit: job.retryLimit,
                  error: message,
                  correlationId,
                });
                throw error;
              } finally {
                span.end();
              }
            }),
          );
        },
      );
      this.logger.log({ queue: handler.queue, pollingIntervalSeconds });
    }

    // Scheduled jobs, worker only. pg-boss dedupes cron ticks across
    // instances.
    for (const { queue, cron } of SCHEDULED_JOBS) {
      await this.boss.schedule(queue, cron, { payload: {} });
    }

    // Write the readiness file only once every queue has a worker and the
    // gauge is live — the healthcheck treats its existence as ready.
    writeFileSync(WORKER_READINESS_FILE_PATH, '');
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      unlinkSync(WORKER_READINESS_FILE_PATH);
    } catch {
      // Already gone, or never written — nothing to clean up.
    }
    await this.boss.stop({
      graceful: true,
      timeout: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    });
  }
}
