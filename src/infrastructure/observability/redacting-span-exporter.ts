import type { ExportResult } from '@opentelemetry/core';
import type {
  ReadableSpan,
  SpanExporter,
  TimedEvent,
} from '@opentelemetry/sdk-trace-node';

import { redact } from '../http/redaction';

/**
 * SPEC 07 Fix A: `formatters.log`/`hooks.logMethod` (`pino.config.ts`) cover
 * every log line, but spans have no redaction at all — `job-runner.ts`'s
 * `span.recordException(error)` stores the raw exception message and stack
 * as event attributes, and an auto-instrumented span (`HttpInstrumentation`,
 * `PgInstrumentation`) can carry a PAN or a secret in an attribute too.
 * Wrapping the exporter is one choke point for every span and event
 * attribute, including ones this codebase never explicitly sets.
 *
 * A span's status `message` is not an attribute — it is not covered here;
 * `job-runner.ts` redacts it itself before calling `span.setStatus()`.
 */
export class RedactingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.inner.export(spans.map(redactSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/**
 * `ReadableSpan.spanContext` (and any other method the concrete span class
 * defines) lives on the prototype, not as an own property — a plain object
 * spread would drop it, and the OTLP serializer calls `spanContext()` on
 * every span it exports. `Object.create` preserves the prototype chain;
 * `Object.assign` then copies the own properties over it, and `attributes`/
 * `events` are overwritten with their redacted versions.
 */
function redactSpan(span: ReadableSpan): ReadableSpan {
  const clone: ReadableSpan = Object.assign(
    Object.create(Object.getPrototypeOf(span) as object) as ReadableSpan,
    span,
  );
  Object.assign(clone, {
    attributes: redact(span.attributes),
    events: span.events.map(redactEvent),
  });
  return clone;
}

function redactEvent(event: TimedEvent): TimedEvent {
  return event.attributes === undefined
    ? event
    : { ...event, attributes: redact(event.attributes) };
}
