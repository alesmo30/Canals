import { trace, SpanStatusCode } from '@opentelemetry/api';

import { redact } from '../../../infrastructure/http/redaction';

/**
 * Same tracer name as job-runner.ts's root `job <queue>` span — this is
 * purely the instrumentation-library label a trace backend shows, not a
 * parent/child link by itself (nesting comes from the active OTel context
 * job-runner.ts already opens around `handler.handle()`).
 */
const tracer = trace.getTracer('canals-worker');

/**
 * Wraps one named business step of a job handler in its own child span, so
 * a trace backend shows what happened ("select unsettled payments",
 * "resolve payment") nested under the job's root span, instead of only the
 * raw `pg`/`pg-pool` driver spans `@opentelemetry/instrumentation-pg`
 * produces on their own.
 *
 * Always rethrows on failure (after marking the span as an error, same
 * shape as job-runner.ts's own catch) — a handler that must not abort a
 * batch over one row's failure (payment-reconciliation, reservation-reap)
 * catches around this call itself, same as it already does today.
 */
export async function withJobSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      return await fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: redact(message) });
      throw error;
    } finally {
      span.end();
    }
  });
}
