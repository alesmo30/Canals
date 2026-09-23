# Observability: logging, redaction, tracing, health

Structured pino logs with a correlation id, OpenTelemetry traces (and one
metric), health endpoints, and the redaction guarantee that no card number
or secret reaches a log line or a span.

Main sources: [spec 03, Redaction rules and Decisions › “Redaction and logging”](../specs/03-external-adapters.md#redaction-rules),
[spec 04, Correlation context and Decisions](../specs/04-queue-worker-observability.md#decisions),
[spec 07, “Fix A — redaction”](../specs/07-hardening-demo.md#fix-a--redaction).
The Grafana trace walkthrough and `X-Correlation-Id` usage are in the
README's queue, worker and observability section.

## Redaction

Code:
- `src/infrastructure/http/redaction.ts` → `redact`, `CARD_NUMBER_VALUE_PATTERN`, `redactError`
- `src/infrastructure/logging/pino.config.ts` → `pinoOptions`, `pinoOptions.hooks`
- `src/infrastructure/observability/redacting-span-exporter.ts` → `RedactingSpanExporter`, `redactSpan`
- `src/infrastructure/messaging/job-runner.ts` → `JobRunner.start` (span status message)
- `src/modules/shared.module.ts` → `SharedModule.register` (logger import)
- `src/main.ts`, `src/main.worker.ts` → `bootstrap`

**Guarantee: no card number (PAN) or secret may reach a log line or an
exported span.** `redact()` is the single function everything goes through.

**`redact()` itself** (`redaction.ts`):
- Pure: returns a redacted deep copy, never mutates its input, and survives
  circular references (a `WeakMap` remembers what was already cloned).
- By key: `cardNumber` / `card_number` / `pan` values are masked to the last
  four digits; `apiKey` / `api_key` values are replaced with `[REDACTED]`.
- By value, in any string: `CARD_NUMBER_VALUE_PATTERN` finds 13 to 19 digits,
  optionally separated by single spaces or dashes (PANs pasted into free
  text). A Luhn check then filters out order numbers, timestamps and other
  digit runs that are not cards. `?api_key=` query values are redacted too.
- Errors: `name`, `message` and `stack` are non-enumerable on a plain
  `Error`, so a generic `Object.entries` walk would silently drop them.
  `redactError` pulls them out explicitly and applies the same rules; an
  error message can carry a PAN copied from a request body.
- Every adapter also passes its `rawResponse` through `redact()` before it
  crosses a port ([http-payments.md#port](http-payments.md#port)).

**Logs** (`pino.config.ts`, installed by `SharedModule`'s
`LoggerModule.forRoot({ pinoHttp: pinoOptions })`): every log line, whether
from Nest's logger, `pino-http`'s request/response logging on the api, or
the bootstrap `catch`, runs through `redact()` before it is serialised.

- `formatters.log` is pino's hook for the object passed to a call such as
  `logger.info(object)`. It runs before pino adds `level` / `time` / `pid`
  and serialises to JSON. It is the main choke point.
- `mixin` runs first, and pino merges its result into the log object before
  `formatters.log` sees it, so `redact()` still has the last word on the
  whole line. The mixin only adds `correlationId`, which is always a
  sanitised inbound header or a generated UUID, never arbitrary data.
  `trace_id` / `span_id` are added by `PinoInstrumentation`, not here.
- `hooks.logMethod` covers what `formatters.log` cannot see: the message
  string (`logger.info('… 4242… failed')`), printf-style interpolation
  values, and an `Error` passed positionally. It redacts the raw positional
  arguments before pino builds the line.
- A plain merge object at position 0 (`logger.info({ cardNumber }, 'msg')`)
  is **skipped** by `logMethod`: `formatters.log` already redacts it, and
  key-based masking is not idempotent (`maskCardValue` strips the mask's own
  `*` characters as non-digits and re-masks the last four), so redacting
  twice would corrupt it.
- Both `main.ts` and `main.worker.ts` install this same redacting logger
  (`app.useLogger(app.get(Logger))`). Their last-resort `console.error`
  (used when boot fails before the logger exists) still wraps its output in
  `redact()`.
- The problem-details filter logs 500s with the full stack; that goes
  through the same logger ([orders-saga.md#error-contract](orders-saga.md#error-contract)).

**Spans** (`RedactingSpanExporter`): the log hooks cover every log line, but
spans had no redaction. `span.recordException(error)` stores the raw
exception message and stack as event attributes, and auto-instrumented spans
(`HttpInstrumentation`, `PgInstrumentation`) can carry a PAN or secret in an
attribute. Wrapping the exporter is one choke point for every span and
event attribute, including ones this code never sets itself. (A
`SpanProcessor.onEnd` approach was considered and rejected; see spec 07
Decisions.)

- `redactSpan` must keep the span's prototype. `ReadableSpan.spanContext()`
  (and other methods of the concrete span class) live on the prototype, so a
  plain object spread would drop them, and the OTLP serializer calls
  `spanContext()` on every exported span. It uses `Object.create(prototype)`,
  then `Object.assign` for own properties, then overwrites `attributes` and
  `events` with redacted copies.
- A span's **status message is not an attribute**, so the exporter does not
  cover it. `JobRunner` redacts the message itself before
  `span.setStatus()`.

Verification: the demo script greps `docker compose logs` for every test
card number and expects zero matches
([scripts.md#demo](scripts.md#demo)).

Source: [spec 03, Redaction rules](../specs/03-external-adapters.md#redaction-rules);
[spec 07, “Fix A — redaction” and Decisions](../specs/07-hardening-demo.md#fix-a--redaction);
[spec 04, Risks (“The pino mixin adds fields that bypass redact()”)](../specs/04-queue-worker-observability.md#risks).

## Logging

Code:
- `src/infrastructure/logging/pino.config.ts` → `pinoOptions`, `PinoHttpOptions`
- `src/infrastructure/config/env.schema.ts` → `envSchema` (`LOG_PRETTY`)

- **`LOG_PRETTY`** is a dev-only readability toggle. It is off by default, so
  docker-compose containers (which never set it) keep emitting raw,
  parseable JSON lines; a local shell that sets `LOG_PRETTY=true` gets
  `pino-pretty`'s coloured `HH:MM:ss` output. The schema uses
  `z.enum(['true', 'false'])`, not `z.coerce.boolean()`: the latter uses
  `Boolean(str)`, which treats any non-empty string, including `"false"`,
  as true.
- **Request/response serializers** are replaced with just what a human
  scans for; `pino-http`'s defaults dump every header and Express routing
  internals, and `correlationId` / `trace_id` / `span_id` already identify
  the request. This needs `wrapSerializers: false`, a `pino-http`-only
  option that is not part of pino's own `LoggerOptions` (hence the
  `PinoHttpOptions` type); why it is required:
  [investigations.md#pino-wrapserializers](investigations.md#pino-wrapserializers).
- Logs go to stdout only; they are not exported through OpenTelemetry
  ([Tracing bootstrap](#tracing-bootstrap)).

Source: [spec 03, Decisions](../specs/03-external-adapters.md#decisions).

## Correlation

Code:
- `src/infrastructure/observability/correlation.middleware.ts` → `CorrelationMiddleware`, `CORRELATION_ID_MAX_LENGTH`
- `src/infrastructure/observability/correlation.ts` → `CorrelationStore`, `correlationStorage`
- `src/infrastructure/messaging/pg-boss-event-publisher.ts` → `PgBossEventPublisher.publish`

A correlation id follows a request from the HTTP call into every job it
triggers.

- `CorrelationMiddleware` honours an inbound `X-Correlation-Id` when it is
  valid (at most `CORRELATION_ID_MAX_LENGTH = 128` characters, letters,
  digits and dashes only), otherwise generates a UUID. It stores the id in
  `correlationStorage` (an `AsyncLocalStorage`) for the rest of the request
  and echoes it in the response header. A client or gateway that already
  has its own id can search its logs and ours with the same string.
- `CorrelationStore` is written by the middleware (api) and by `JobRunner`
  (restoring a job's publishing-time id), and read by the pino `mixin` and
  `PgBossEventPublisher`.
- `PgBossEventPublisher.publish` reads the id via `getCorrelationId()`. A
  publish from outside any tracked context (a script) still gets a fresh id
  rather than `undefined`.
- The problem-details filter always takes `correlationId` from the store,
  never generates one.

Source: [spec 04, Correlation context and Decisions › “Correlation and tracing”](../specs/04-queue-worker-observability.md#correlation-context).

## Tracing bootstrap

Code:
- `src/infrastructure/observability/tracing.ts` → `isWorker`, `sdk`, `sdk.instrumentations`, the `SIGTERM` handler
- `src/main.ts`, `src/main.worker.ts` → first import

`tracing.ts` starts the OpenTelemetry Node SDK with auto-instrumentation for
HTTP, `pg` and pino, exporting OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT`.

- **It must be the first import** of `main.ts` and `main.worker.ts`.
  Auto-instrumentation patches the `http` / `pg` modules when they are
  first `require()`d; anything imported earlier that pulls them in (Nest,
  TypeORM, pg-boss) leaves them silently un-instrumented. No
  `no-restricted-imports` rule can catch an import-order mistake; only a
  reviewer can.
- It runs before `ConfigModule` exists, so it reads `process.env` directly
  (the OTLP exporter and `NodeSDK` defaults read `OTEL_*` variables
  themselves). `env.schema.ts` validates the same variables a moment later
  when Nest boots.
- `isWorker` is derived from `process.argv[1]` (`main.worker`), which sets
  the service name (`canals-api` / `canals-worker`).
- The trace exporter is wrapped in `RedactingSpanExporter`
  ([Redaction](#redaction)).
- **Metrics only on the worker**: it is the only process that registers an
  observable instrument (the DLQ gauge). A metric reader on the api would
  export empty collections on a timer for nothing.
- `PinoInstrumentation({ disableLogSending: true })`: logs stay on stdout
  (exporting logs to Loki was rejected). This instrumentation only injects
  `trace_id` / `span_id` into every pino line; its default key names already
  match.
- On `SIGTERM` it calls `sdk.shutdown()` so buffered telemetry is exported
  before exit. The worker already waits for an in-flight job on SIGTERM
  ([messaging-jobs.md#graceful-shutdown](messaging-jobs.md#graceful-shutdown));
  this makes sure that job's spans still reach the collector instead of
  being dropped mid-batch.
- Tests never load `tracing.ts`; they register their own in-memory providers
  ([testing.md#observability-tests](testing.md#observability-tests)).

Source: [spec 04, Scope, Risks and Decisions › “Correlation and tracing”](../specs/04-queue-worker-observability.md#risks).

## Trace propagation

Code: `src/infrastructure/messaging/pg-boss-event-publisher.ts` → `captureTraceparent`

`captureTraceparent` injects the active span (if any) into a plain carrier
object using the globally registered W3C propagator (registered by
`tracing.ts`'s `NodeSDK`), then reads back the `traceparent` field. It
returns `null` when no span is active, matching `JobMeta.traceparent`
([messaging-jobs.md#job-envelope](messaging-jobs.md#job-envelope)).

## Job spans

Code:
- `src/infrastructure/messaging/job-runner.ts` → `tracer`, `JobRunner.start`
- `src/application/jobs/helpers/tracing.helper.ts` → `tracer`, `withJobSpan`

- Each job gets **its own trace**, linked to the publishing span, rather
  than being a child span of the HTTP request. This follows the
  OpenTelemetry messaging convention. The root span is `job <queue>`
  (kind `CONSUMER`, attributes `messaging.destination.name`,
  `messaging.message.id`, `app.correlation_id`); see
  [messaging-jobs.md#job-runner](messaging-jobs.md#job-runner).
- `withJobSpan(name, fn)` wraps one named business step of a handler
  ("select unsettled payments", "resolve payment", …) in a child span, so a
  trace backend shows what happened, not only the raw `pg` / `pg-pool`
  driver spans. It always rethrows after marking the span as an error (same
  shape as `JobRunner`'s catch); batch handlers that must not abort on one
  row catch around it themselves.
- Both files use the same tracer name. The name is only the
  instrumentation-library label a backend shows; nesting comes from the
  active OpenTelemetry context that `JobRunner` opens around
  `handler.handle()`.

Source: [spec 04, Decisions › “Correlation and tracing”](../specs/04-queue-worker-observability.md#decisions).

## DLQ gauge

Code:
- `src/infrastructure/observability/dlq-gauge.ts` → `registerDlqGauge`
- `src/infrastructure/observability/tracing.ts` → `DLQ_GAUGE_INTERVAL_MS`

One OpenTelemetry observable gauge, `queue.dlq.size{queue}`, read from
pg-boss queue statistics. It is the single deliberate exception to "no
business metrics".

- It is sampled by the worker's `PeriodicExportingMetricReader` every
  `DLQ_GAUGE_INTERVAL_MS = 60_000`. The reader decides when the callback
  runs (an observable instrument is only read when its reader collects);
  the gauge schedules no timer of its own.
- It uses `getQueueStats(name, { force: true })`, not `getQueue(name)`.
  `getQueue()` reads a column on `pgboss.queue` that pg-boss's monitor
  refreshes on its own schedule, stale by tens of seconds;
  `getQueueStats({ force: true })` recomputes from the job table.
- `force: true` is itself throttled to one real recomputation per queue per
  60 s, which equals this gauge's sampling interval, so each scheduled
  collection still gets a fresh value. The throttle only hurts a tighter
  poll loop; see
  [investigations.md#pgboss-queue-stats-throttle](investigations.md#pgboss-queue-stats-throttle).

Source: [spec 04, Scope, Named constants and Decisions › “pg-boss@12 API” findings](../specs/04-queue-worker-observability.md#named-constants).

## Health endpoints

Code:
- `src/infrastructure/health/health.controller.ts` → `HealthController`
- `src/infrastructure/health/pg-boss.health-indicator.ts` → `PgBossHealthIndicator`
- `src/infrastructure/health/worker-healthcheck.ts` → `main`
- `src/infrastructure/health/worker-readiness.ts` → `WORKER_READINESS_FILE_PATH`
- `src/infrastructure/messaging/job-runner.ts` → `JobRunner.start`

**Api:**
- `GET /health` is **liveness only**, with no database call: the process
  answering is the signal. A liveness probe that pinged the database would
  restart every healthy api instance during a 30 s database blip and turn a
  recoverable outage into a restart storm. It also holds with several api
  instances, since each answers for itself with no shared state.
- `GET /health/ready` checks the database (`database`, TypeORM ping) and the
  queue (`queue`, `PgBossHealthIndicator`).
- `PgBossHealthIndicator` is reported separately from the database even
  though both usually fail together (both go through Postgres). It does a
  real round-trip through the api's own pg-boss pool (separate from
  TypeORM's), instead of assuming that a provider resolved at boot is still
  reachable.

**Worker** (no HTTP port):
- `docker-compose.yml`'s worker `healthcheck:` runs
  `node dist/infrastructure/health/worker-healthcheck.js`. It checks that
  the readiness file exists and connects with a bare `pg.Client`, which is
  lighter than a full TypeORM `DataSource` for something Docker runs on an
  interval. It prints with `console` because this bare script has no pino
  logger.
- `WORKER_READINESS_FILE_PATH = '/tmp/worker-ready'` (a constant, not an
  env var). `JobRunner.start()` writes it only after every queue has a
  registered worker and the DLQ gauge is live, because the healthcheck
  treats the file's existence as "ready". `onApplicationShutdown()` removes
  it.

Source: [spec 04, Scope and Decisions › “Health endpoints”](../specs/04-queue-worker-observability.md#decisions);
[spec 01, Decisions › “Runtime and operations”](../specs/01-foundation.md#decisions).
