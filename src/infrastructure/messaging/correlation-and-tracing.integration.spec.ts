import { randomUUID } from 'crypto';

import { context, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

import { JobRunner } from './job-runner';
import { PgBossEventPublisher } from './pg-boss-event-publisher';
import { QUEUE_TOPOLOGY, setupQueues } from './queue-setup';
import {
  correlationStorage,
  getCorrelationId,
} from '../observability/correlation';
import { AppConfig } from '../config/env.schema';
import { JobHandler } from '../../application/jobs/job-handler';
import { AppDataSource } from '../database/data-source';

/**
 * SPEC 04 step 7 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable. Registers its own `NodeTracerProvider`
 * with an `InMemorySpanExporter` — the real `tracing.ts` never runs in a
 * test process (nothing here imports `main.ts`/`main.worker.ts`), so
 * nothing else registers a tracer provider or propagator first.
 */
const FAST_POLLING_INTERVAL_SECONDS = 1;
const FAST_CONFIG_SERVICE = {
  get: () => FAST_POLLING_INTERVAL_SECONDS,
} as unknown as ConfigService<AppConfig, true>;

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

describe('correlation and tracing (integration)', () => {
  let boss: PgBoss;
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeAll(async () => {
    await AppDataSource.initialize();

    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register({
      propagator: new W3CTraceContextPropagator(),
      contextManager: new AsyncLocalStorageContextManager().enable(),
    });

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);
  });

  afterAll(async () => {
    await boss.stop();
    await provider.shutdown();
    await AppDataSource.destroy();
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('restores the publishing correlationId in every handler, and links each job span to the publishing span — while the handler itself never sees meta', async () => {
    const orderId = randomUUID();
    const observedCorrelationIds: (string | undefined)[] = [];

    const handlers: JobHandler<unknown>[] = QUEUE_TOPOLOGY.map(({ queue }) => ({
      queue,
      handle: () => {
        observedCorrelationIds.push(getCorrelationId());
        return Promise.resolve();
      },
    }));
    const runner = new JobRunner(boss, handlers, FAST_CONFIG_SERVICE);
    await runner.start();

    const publisher = new PgBossEventPublisher(boss);
    const requestCorrelationId = `demo-${randomUUID()}`;
    const requestSpan = trace.getTracer('test').startSpan('test-request');
    const requestTraceId = requestSpan.spanContext().traceId;

    // Mirrors what CorrelationMiddleware + HttpInstrumentation set up
    // together for a real request: a correlationId in AsyncLocalStorage
    // and an active span, both live while publish() runs.
    await correlationStorage.run({ correlationId: requestCorrelationId }, () =>
      context.with(trace.setSpan(context.active(), requestSpan), () =>
        publisher.publish({
          type: 'order.confirmed',
          payload: { orderId, occurredAt: new Date().toISOString() },
        }),
      ),
    );
    requestSpan.end();

    await waitUntil(async () => {
      const rows: { state: string }[] = await AppDataSource.query(
        `select state from pgboss.job where data->'payload'->>'orderId' = $1`,
        [orderId],
      );
      return (
        rows.length === 3 && rows.every((row) => row.state === 'completed')
      );
    }, 20_000);

    for (const { queue } of QUEUE_TOPOLOGY) {
      await boss.offWork(queue);
    }

    expect(observedCorrelationIds).toHaveLength(3);
    expect(
      observedCorrelationIds.every((id) => id === requestCorrelationId),
    ).toBe(true);

    const jobSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name.startsWith('job '));
    expect(jobSpans).toHaveLength(3);
    expect(new Set(jobSpans.map((span) => span.name))).toEqual(
      new Set(QUEUE_TOPOLOGY.map((entry) => `job ${entry.queue}`)),
    );
    for (const span of jobSpans) {
      // root: true — its own trace, not a child of the request's.
      expect(span.spanContext().traceId).not.toBe(requestTraceId);
      expect(span.links).toHaveLength(1);
      expect(span.links[0].context.traceId).toBe(requestTraceId);
      expect(span.links[0].context.spanId).toBe(
        requestSpan.spanContext().spanId,
      );
    }
  }, 30_000);
});
