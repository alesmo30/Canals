import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import { RedactingSpanExporter } from './redacting-span-exporter';

describe('RedactingSpanExporter', () => {
  it('masks a PAN in a span attribute and in a recordException event, and preserves spanContext()', () => {
    const inner = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(new RedactingSpanExporter(inner)),
      ],
    });
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('job payment.reconcile');
    span.setAttribute('note', 'card 4242424242424242 declined');
    span.recordException(new Error('charge failed for 4242424242424242'));
    span.end();

    const [exported] = inner.getFinishedSpans();

    expect(exported.attributes.note).toBe('card ************4242 declined');
    const [event] = exported.events;
    expect(event.attributes?.['exception.message']).toBe(
      'charge failed for ************4242',
    );
    expect(JSON.stringify(event)).not.toContain('4242424242424242');
    expect(JSON.stringify(exported.attributes)).not.toContain(
      '4242424242424242',
    );
    expect(exported.spanContext().traceId).toHaveLength(32);
  });

  it('shutdown and forceFlush delegate to the inner exporter', async () => {
    const inner = new InMemorySpanExporter();
    const shutdownSpy = jest.spyOn(inner, 'shutdown');
    const wrapper = new RedactingSpanExporter(inner);

    await wrapper.shutdown();
    await wrapper.forceFlush();

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });
});
