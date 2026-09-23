import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';

import { RedactingSpanExporter } from './redacting-span-exporter';

/**
 * How often the DLQ gauge is sampled (drives the metric reader's export
 * interval).
 */
export const DLQ_GAUGE_INTERVAL_MS = 60_000;

/**
 * Must be the first import of main.ts/main.worker.ts: auto-instrumentation
 * patches http/pg on require(), so anything imported earlier (Nest,
 * TypeORM, pg-boss...) stays silently un-instrumented, and no lint rule can
 * catch an import-order mistake. Reads process.env directly: this runs
 * before ConfigModule exists.
 */
const isWorker = process.argv[1]?.includes('main.worker') ?? false;

const sdk = new NodeSDK({
  serviceName: isWorker ? 'canals-worker' : 'canals-api',
  traceExporter: new RedactingSpanExporter(new OTLPTraceExporter()),
  // Metrics only on the worker, the only process that registers the DLQ
  // gauge; on the api a reader would export empty collections.
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
    // disableLogSending: logs stay on stdout; this only injects
    // trace_id/span_id into pino lines.
    new PinoInstrumentation({ disableLogSending: true }),
  ],
});

sdk.start();

// Flush telemetry on SIGTERM so an in-flight job's spans still reach the
// collector instead of being dropped mid-batch.
process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => undefined);
});
