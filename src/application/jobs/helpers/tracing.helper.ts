import { trace, SpanStatusCode } from '@opentelemetry/api';

import { redact } from '../../../infrastructure/http/redaction';

/**
 * Same tracer name as JobRunner's root span. Only a library label — nesting
 * comes from the active OTel context.
 */
const tracer = trace.getTracer('canals-worker');

/**
 * Wraps one business step of a job handler in a child span. Always rethrows
 * after marking the span errored; batch handlers catch around it themselves.
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
