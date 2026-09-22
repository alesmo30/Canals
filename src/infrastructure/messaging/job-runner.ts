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
import { JobBody } from './job-envelope';
import { AppConfig } from '../config/env.schema';
import { redact } from '../http/redaction';
import { correlationStorage } from '../observability/correlation';
import { registerDlqGauge } from '../observability/dlq-gauge';
import { WORKER_READINESS_FILE_PATH } from '../health/worker-readiness';
import { JOB_HANDLERS, JobHandler } from '../../application/jobs/job-handler';

/**
 * SPEC 04 Decisions, "Correlation and tracing": each job gets its own
 * trace, linked to the publishing span, rather than being a child span of
 * the request — OpenTelemetry's messaging convention. The tracer name is
 * cosmetic (shows up as the instrumentation library in a trace backend).
 */
const tracer = trace.getTracer('canals-worker');

/**
 * Stays under compose's 30 s `stop_grace_period` (step 10) so Docker never
 * SIGKILLs mid-job (SPEC 04 Decisions, "The worker, its connections and
 * shutdown").
 */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * Started from `main.worker.ts` (`await app.get(JobRunner).start()`,
 * `infrastructure.md` §3). Registers one `boss.work()` per handler in
 * `JOB_HANDLERS`. For each job: restores `correlationId` into
 * `correlationStorage` (read by the pino `mixin` and by
 * `PgBossEventPublisher` if the handler itself publishes), opens one
 * hand-written `job <queue>` span in its own trace — `root: true`, so it
 * is never accidentally nested under whatever context pg-boss's own fetch
 * loop happens to be running in — linked to the publishing span via the
 * envelope's `traceparent`, and runs the handler with that span active so
 * any `pg` spans the handler produces nest under it instead of appearing
 * as orphans. The handler receives `payload` only — it never sees `meta`.
 * A thrown error is recorded on the span, logged — `queue`, `jobId`,
 * `attempt`, `retryLimit`, `error`, `correlationId` — and re-thrown so
 * pg-boss's own retry/dead-letter transition still runs; this warn line is
 * the per-attempt failure history pg-boss itself does not keep (R3.5).
 * `start()` also registers the DLQ gauge (`dlq-gauge.ts`) — the worker is
 * the only process with a `PgBoss` instance worth sampling.
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
          const { correlationId, traceparent } = job.data.meta;
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
                // SPEC 07 Fix A: the status message is not a span
                // attribute, so RedactingSpanExporter does not cover it —
                // redact it here instead.
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

    // Boot is only "done" once every queue has a registered worker and the
    // gauge is live — worker-healthcheck.js (R3.8) treats this file's mere
    // existence as "ready".
    writeFileSync(WORKER_READINESS_FILE_PATH, '');
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      unlinkSync(WORKER_READINESS_FILE_PATH);
    } catch {
      // Already gone, or never written (shutdown before start() finished)
      // — either way there is nothing left to clean up.
    }
    await this.boss.stop({
      graceful: true,
      timeout: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    });
  }
}
