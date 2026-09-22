import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';

import { RedactingSpanExporter } from './redacting-span-exporter';

/**
 * SPEC 04 Named constants — observability: how often the DLQ gauge
 * (`dlq-gauge.ts`) is sampled. Drives the metrics pipeline's own export
 * interval, since an OTel observable instrument is only ever read when
 * its reader asks for a collection.
 */
export const DLQ_GAUGE_INTERVAL_MS = 60_000;

/**
 * SPEC 04 Scope: "OpenTelemetry Node SDK with auto-instrumentation for
 * HTTP, pg and pino, exporting OTLP to OTEL_EXPORTER_OTLP_ENDPOINT.
 * Imported as the first line of main.ts and main.worker.ts, before any
 * other import." It must stay first: auto-instrumentation works by
 * patching the `http`/`pg` modules the moment they are `require()`d, so
 * anything imported earlier that pulls those modules in first (Nest,
 * TypeORM, pg-boss...) leaves them silently un-instrumented (SPEC 04
 * Risks) — no `no-restricted-imports` rule can catch an import *order*
 * mistake, only a reviewer reading this comment can.
 *
 * `OTLPTraceExporter` and `NodeSDK`'s defaults already read
 * `OTEL_EXPORTER_OTLP_ENDPOINT`/other `OTEL_*` env vars directly — this
 * file runs before `ConfigModule` exists, so it reads `process.env` the
 * same way env.schema.ts's own validation will, a few lines later once
 * `main.ts`/`main.worker.ts` actually boot Nest.
 */
const isWorker = process.argv[1]?.includes('main.worker') ?? false;

const sdk = new NodeSDK({
  serviceName: isWorker ? 'canals-worker' : 'canals-api',
  traceExporter: new RedactingSpanExporter(new OTLPTraceExporter()),
  // Metrics only on the worker: it's the only process that registers the
  // DLQ gauge (dlq-gauge.ts, called from JobRunner.start()). The api
  // never creates an observable instrument, so a reader here would just
  // export empty collections on a timer for nothing.
  ...(isWorker
    ? {
        metricReaders: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: DLQ_GAUGE_INTERVAL_MS,
          }),
        ],
      }
    : {}),
  instrumentations: [
    new HttpInstrumentation(),
    new PgInstrumentation(),
    // disableLogSending: true — logs stay on stdout only (Decisions, "No:
    // exporting logs to Loki"); this instrumentation's job here is only
    // to inject trace_id/span_id into every pino line (its default
    // logKeys already match those field names).
    new PinoInstrumentation({ disableLogSending: true }),
  ],
});

sdk.start();

// NodeSDK's own doc comment: "Use the shutdown handler to ensure your
// telemetry is exported before the process exits." The worker already
// waits out an in-flight job on SIGTERM (JobRunner.onApplicationShutdown,
// GRACEFUL_SHUTDOWN_TIMEOUT_MS) — this makes sure that job's own spans
// still reach the collector instead of being dropped mid-batch.
process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => undefined);
});
