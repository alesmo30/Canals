import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';

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
  traceExporter: new OTLPTraceExporter(),
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
