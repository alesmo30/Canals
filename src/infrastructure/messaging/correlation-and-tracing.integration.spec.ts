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
import { OrderConfirmedPayload } from './event-routing';
import { QUEUE_TOPOLOGY, setupQueues } from './queue-setup';
import {
  correlationStorage,
  getCorrelationId,
} from '../observability/correlation';
import { AppConfig } from '../config/env.schema';
import { JobHandler } from '../../application/jobs/job-handler';
import { AppDataSource } from '../database/data-source';

/**
 * Registers its own `NodeTracerProvider` + `InMemorySpanExporter`;
 * `tracing.ts` never loads in a test process.
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

    // Filter by this run's orderId: queues are shared with other
    // integration specs that leave jobs behind.
    const handlers: JobHandler<OrderConfirmedPayload>[] = QUEUE_TOPOLOGY.map(
      ({ queue }) => ({
        queue,
        handle: (payload) => {
          if (payload.orderId === orderId) {
            observedCorrelationIds.push(getCorrelationId());
          }
          return Promise.resolve();
        },
      }),
    );
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

    let ownJobIds: string[] = [];
    await waitUntil(async () => {
      const rows: { id: string; state: string }[] = await AppDataSource.query(
        `select id, state from pgboss.job where data->'payload'->>'orderId' = $1`,
        [orderId],
      );
      ownJobIds = rows.map((row) => row.id);
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

    // Filter by this run's job ids: queues are shared with other
    // integration specs that leave jobs behind.
    const jobSpans = exporter
      .getFinishedSpans()
      .filter(
        (span) =>
          span.name.startsWith('job ') &&
          ownJobIds.includes(span.attributes['messaging.message.id'] as string),
      );
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
