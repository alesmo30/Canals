import type { ExportResult } from '@opentelemetry/core';
import type {
  ReadableSpan,
  SpanExporter,
  TimedEvent,
} from '@opentelemetry/sdk-trace-node';

import { redact } from '../http/redaction';

/**
 * Redacts every span and event attribute at export, including
 * auto-instrumented ones and recordException's message/stack. Span status
 * messages aren't attributes — job-runner redacts those itself.
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
 * Object.create keeps the prototype: spanContext() lives there, a plain
 * spread would drop it, and the OTLP serializer calls it on every span.
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
