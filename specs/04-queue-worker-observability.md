# SPEC 04 — P3 Queue, Worker and Observability: pg-boss, job handlers and traces

> **Status:** Approved
> **Depends on:** SPEC 01 (consumes SPEC 03's redacting logger)
> **Date:** 2026-09-20
> **Objective:** Make the worker real — a pg-boss adapter whose job insert joins the caller's transaction, one `order.confirmed` event fanning out into three independently retried jobs each with its own dead-letter queue, and enough OpenTelemetry, structured logging and health signalling that one `correlationId` links an HTTP request to every job it caused.

## Scope

**In:**

- **pg-boss v12 wiring** in `SharedModule`, one instance per process, built from
  `DATABASE_URL`:
  - The api runs it with `supervise: false` and `schedule: false` and registers
    no `work()` — it only publishes jobs and reads queue state for readiness.
    The worker is the single process that supervises, maintains and consumes.
  - pg-boss opens its own pool (api 2, worker 5), separate from TypeORM's
    (api 10, worker 5), plus one dedicated session connection for `LISTEN` on
    the worker. Totals: api 12, worker 11.
  - `PGBOSS_POLL_INTERVAL_SECONDS` (15, already in `env.schema.ts`) with
    `notify: true` per queue, so a freshly inserted job is picked up in
    milliseconds and polling covers missed notifications, retries and delayed
    jobs.
  - Queue setup runs at boot, idempotently, in both processes: the three DLQs
    first, then the three work queues referencing them.
- **`PgBossEventPublisher`**, replacing P0's no-op stub as the `EVENT_PUBLISHER`
  binding. It implements SPEC 01's frozen `EventPublisher` unchanged.
  - **Transactional insert:** when `tx` is supplied, every job insert runs
    through `{ db: { executeSql: (text, values) => tx.executeSql(text, values) } }`,
    so it commits or rolls back with the caller's transaction (FR-9's outbox).
  - **Fan-out by routing map**, held in code:
    `{ 'order.confirmed': ['shipment.create', 'customer.notify', 'analytics.record'] }`.
    One `publish()` inserts one job per target queue, all in the same
    transaction. An event type with no entry in the map is a programming error
    and throws.
  - **Context envelope:** the job body is `{ payload, meta }`, where `meta`
    carries `correlationId`, the W3C `traceparent` and `publishedAt`. Callers
    (P4) keep passing `{ type, payload }` and never see `meta`.
- **Worker entrypoint.** `src/main.worker.ts` gains a `JobRunner` started
  through `NestFactory.createApplicationContext(WorkerModule)` — still no
  `app.listen()`, still no `ApiModule` import. The `JobRunner`:
  - registers one `boss.work()` per queue and dispatches to its handler;
  - restores `correlationId` (AsyncLocalStorage) and the OTel context from
    `meta` before invoking the handler, and passes it only `payload`;
  - opens exactly one hand-written span per job execution, named
    `job <queue>`, in its own trace, with a span link back to the publishing
    request's span;
  - logs a structured `warn` on every failed attempt
    (`queue`, `jobId`, `attempt`, `retryLimit`, `error`, `correlationId`), which
    is the per-attempt failure history pg-boss itself does not keep;
  - shuts down gracefully: stop fetching, let in-flight jobs finish (up to 25 s),
    then exit.
- **Three queues with three handlers**, in `src/application/jobs/`:

  | Queue | Handler | Does |
  |---|---|---|
  | `shipment.create` | `ShipmentCreateHandler` → `ShipmentService` | `INSERT INTO shipments … ON CONFLICT (order_id) DO NOTHING`, status `PENDING_DISPATCH`, `warehouse_id` read from the order |
  | `customer.notify` | `CustomerNotifyHandler` | logs a structured "notification sent" event |
  | `analytics.record` | `AnalyticsRecordHandler` | logs a structured domain event |

  Each queue is configured with `retryLimit: 4` (5 attempts total),
  `retryBackoff: true`, `retryDelay: 1`, `retryDelayMax: 60` and its own dead
  letter queue (`<queue>.dlq`), with an explicit long retention so DLQ jobs are
  never quietly maintained away.
- **Observability** in `src/infrastructure/observability/`:
  - `tracing.ts` — OpenTelemetry Node SDK with auto-instrumentation for HTTP,
    `pg` and pino, exporting OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT`. Imported as
    the first line of `main.ts` and `main.worker.ts`, before any other import.
  - A correlation middleware on the api: it takes `X-Correlation-Id` when the
    inbound value is valid (≤128 chars, `[A-Za-z0-9-]`), generates a UUID
    otherwise, stores it in an `AsyncLocalStorage` and echoes it back in the
    response header.
  - A pino `mixin` adding `correlationId` to every log line; `trace_id` and
    `span_id` come from the pino instrumentation. `redact()` still applies.
  - One OTel observable gauge, `queue.dlq.size{queue}`, read from pg-boss's
    queue statistics — the single deliberate exception to "no business metrics".
- **Health.** `GET /health` becomes a pure liveness check (the process answers,
  no database call). `GET /health/ready` checks the database and the queue.
  The worker, having no HTTP port, is checked by
  `node dist/infrastructure/health/worker-healthcheck.js`, which verifies the
  readiness file the worker writes at boot and removes on shutdown, plus
  database connectivity.
- **A development-only publisher.** `POST /internal/events/order-confirmed`
  `{ orderId }`, registered only when `ENABLE_DEV_ENDPOINTS=true` (new boolean
  env var, default `false`, set to `true` for compose's `api`). It publishes
  `order.confirmed` inside a transaction, exactly as P4 will. It exists so P3
  can demonstrate the full HTTP → queue → worker → Grafana path before
  `POST /orders` exists, and P4 removes it.
- **`scripts/events-check.ts`**, wired into `npm run verify`: publishes
  `order.confirmed` for a fixture order and asserts that three jobs were created
  and consumed.
- **Compose:** the `lgtm` service (`grafana/otel-lgtm`, `3001:3000`, `4318:4318`),
  `ENABLE_DEV_ENDPOINTS` on `api`, and `stop_grace_period: 30s` on `worker`.
- **Tests:** unit tests for the routing map and the `meta` envelope; integration
  tests for the rollback check, the fan-out, handler idempotency, the synthetic
  DLQ case and the realistic foreign-key DLQ case.
- **README.** A P3 section: the queue topology, how to read a trace in Grafana,
  the `correlationId` walkthrough, and how to inspect and reprocess a DLQ job.

**Out of scope (for future specs):**

- `POST /orders`, the saga, DTOs and the RFC 9457 error contract carrying
  `correlationId`. — P4. P3's dev endpoint is its stand-in and P4 deletes it.
- The reservation reaper and payment reconciliation, both scheduled jobs that
  need P4's saga to exist. — P6.
- Custom spans inside handlers and business metrics (orders by status, payment
  outcomes, RED per endpoint). The DLQ gauge is the one exception, required by
  R3.5.
- Exporting logs to Loki over OTLP. Logs stay on stdout with `correlationId`
  and `trace_id`; NFR-4's requirement is structured, correlated logs, which
  stdout satisfies.
- A pre-provisioned Grafana dashboard. The demo uses Grafana's Explore view.
- Running more than one worker instance, and any queue-count consolidation.
- Real email or analytics sinks. Both handlers log; nothing leaves the process.
- Shipment lifecycle transitions beyond `PENDING_DISPATCH` (dispatch, delivery).
- A dedicated `outbox_events` table and a relay. The pg-boss job table is the
  outbox (FR-9), and that stays true as long as the queue lives in PostgreSQL.

## Data model

**This spec adds no table, column, enum type or index to the application
schema**, which SPEC 01 froze. It does introduce database objects and one
environment variable, both listed below.

### Database objects

pg-boss creates and owns its own `pgboss` schema on first `boss.start()` —
tables, indexes and its own migrations. The connecting role therefore needs
`CREATE`; the compose role (`canals`) owns the database and already has it.

- **No TypeORM entity mirrors any `pgboss` table.** They are pg-boss's private
  storage, read through its API (or by hand in psql when debugging), never
  through the application's persistence layer.
- **The `pgboss` schema is not covered by our migrations.** `npm run
  verify:db` keeps checking only the application schema. Upgrading pg-boss
  migrates its own tables at boot.
- Queues and dead-letter queues are rows in `pgboss.queue`, created
  idempotently at boot (step 2) rather than by a migration, because a queue's
  retry and dead-letter configuration belongs to the code that consumes it.

### New environment variable

| Variable | Type | Default | Why |
|---|---|---|---|
| `ENABLE_DEV_ENDPOINTS` | boolean | `false` | Registers `POST /internal/events/order-confirmed`. An operator must be able to turn the dev publisher on locally without a rebuild, which is what makes it an env var rather than a constant. Compose sets it to `true` for `api`; nothing sets it in production. |

Added to `env.schema.ts` (Zod, `z.coerce.boolean().default(false)`) and to
`.env.example`.

### Named constants

Nobody tunes these per deployment, so they are constants in the module that
uses them (`references/coding-conventions.md`).

| Constant | Value | Where |
|---|---|---|
| `QUEUE_RETRY_LIMIT` | `4` | queue setup — 4 retries after the first attempt = **5 attempts total** |
| `QUEUE_RETRY_DELAY_SECONDS` | `1` | queue setup — base delay, doubled per retry by `retryBackoff` |
| `QUEUE_RETRY_DELAY_MAX_SECONDS` | `60` | queue setup — ceiling for the backoff |
| `DLQ_RETENTION_DAYS` | `30` | queue setup — DLQ jobs must outlive a long weekend, and pg-boss maintenance would otherwise remove them |
| `PGBOSS_POOL_SIZE_API` / `_WORKER` | `2` / `5` | pg-boss's own pool, separate from TypeORM's |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | `25_000` | worker — stays under compose's 30 s `stop_grace_period` |
| `DLQ_GAUGE_INTERVAL_MS` | `60_000` | observability — how often the DLQ gauge is sampled |
| `CORRELATION_ID_MAX_LENGTH` | `128` | correlation middleware |

### Queue topology

| Queue | Dead letter | Handler |
|---|---|---|
| `shipment.create` | `shipment.create.dlq` | `ShipmentCreateHandler` |
| `customer.notify` | `customer.notify.dlq` | `CustomerNotifyHandler` |
| `analytics.record` | `analytics.record.dlq` | `AnalyticsRecordHandler` |

Every work queue is created with `notify: true`, `retryLimit:
QUEUE_RETRY_LIMIT`, `retryBackoff: true`, `retryDelay:
QUEUE_RETRY_DELAY_SECONDS` and `retryDelayMax:
QUEUE_RETRY_DELAY_MAX_SECONDS`. Each DLQ is created **before** the queue that
references it — pg-boss rejects a `deadLetter` pointing at a queue that does
not exist — and has no consumer: a job that lands there stays until a human
or a future tool reprocesses it.

Because retries carry no `NOTIFY`, the polling interval is the real
granularity of retry scheduling: with 15 s polling, the five attempts of a
doomed job land roughly at t+0 s, ~15 s, ~30 s, ~45 s and ~60 s, and it reaches
its DLQ about a minute after the first failure (`infrastructure.md` §7).

### Event contract

```ts
// The only event P3 defines. P4 publishes it; P3 routes and consumes it.
// type: 'order.confirmed'
export interface OrderConfirmedPayload {
  orderId: string;
  occurredAt: string;   // ISO 8601
}
```

Deliberately minimal: handlers read whatever else they need from the database,
so a job running a minute late sees current state rather than a stale copy.

### Job body and routing

```ts
// src/infrastructure/messaging/job-envelope.ts
export interface JobMeta {
  correlationId: string;
  traceparent: string | null;   // W3C trace context, null when no span is active
  publishedAt: string;          // ISO 8601
}
export interface JobBody<TPayload = Record<string, unknown>> {
  payload: TPayload;
  meta: JobMeta;
}

// src/infrastructure/messaging/event-routing.ts
export const EVENT_ROUTING: Readonly<Record<string, readonly string[]>> = {
  'order.confirmed': ['shipment.create', 'customer.notify', 'analytics.record'],
};
```

`publish()` looks the event type up in `EVENT_ROUTING` and sends one job per
target queue, all through the same `db.executeSql`. An unknown event type
throws `UnroutedEventError` — silently dropping an event is exactly the failure
FR-9 exists to prevent.

### Handler contract

```ts
// src/application/jobs/job-handler.ts
export interface JobHandler<TPayload> {
  readonly queue: string;
  handle(payload: TPayload): Promise<void>;
}
```

Handlers receive `payload` only. `meta` is consumed by the `JobRunner` before
they run: the `correlationId` is already in the logging context and the span is
already open, so a handler never reads, forwards or knows about it.

### Correlation context

```ts
// src/infrastructure/observability/correlation.ts
export interface CorrelationStore { correlationId: string; }
// AsyncLocalStorage<CorrelationStore>, written by the api middleware and by the
// JobRunner, read by the pino mixin and by PgBossEventPublisher.
```

## Implementation plan

Every step ends with `npm run lint`, `npm run build` and `npm run test:unit`
green, and leaves `docker compose up` working. Each step states how it is
verified before the next one starts.

1. **Pin the pg-boss API.** Install `pg-boss@12`, the OpenTelemetry Node SDK
   and its HTTP/`pg`/pino instrumentations. Before writing any adapter,
   confirm against the installed version — not against documentation or
   memory — the exact names and semantics of: the per-queue `notify` option,
   `deadLetter`, the retention option for DLQ jobs, the queue-statistics call
   behind the gauge, and whether the transactional `db: { executeSql }` option
   is accepted by `send`. Record the findings in this spec's Decisions.
   *Verify:* a scratch integration test starts pg-boss against the compose
   database, creates a queue with each option and reads it back; anything the
   version does not support is written down with the fallback chosen. Delete
   the scratch file afterwards.

2. **pg-boss in `SharedModule` and queue setup.** Provide one pg-boss instance
   per process from `DATABASE_URL`, with its own pool
   (`PGBOSS_POOL_SIZE_API` / `_WORKER`) and `PGBOSS_POLL_INTERVAL_SECONDS`.
   The api starts it with `supervise: false`, `schedule: false` and no
   `work()`. Queue setup runs at boot in both processes, idempotently: the
   three DLQs first, then the three work queues with their retry and
   `deadLetter` configuration.
   *Verify:* `docker compose up` from a clean volume brings api and worker up.
   `psql` shows the `pgboss` schema and six queues with the expected retry
   settings. Restarting both containers creates nothing new and logs no error.

3. **`PgBossEventPublisher` and the rollback check (R3.2 — the critical one).**
   Implement the port: route the event type through `EVENT_ROUTING`, build the
   `{ payload, meta }` body, and send one job per target queue, passing
   `{ db: { executeSql } }` whenever `tx` is supplied. Bind it to
   `EVENT_PUBLISHER` in `SharedModule`, replacing P0's no-op stub. An unrouted
   event type throws `UnroutedEventError`.
   *Verify:* an integration test opens a transaction, publishes
   `order.confirmed`, **rolls back**, and asserts zero rows in pg-boss's job
   table for all three queues. The same test then publishes and commits, and
   asserts exactly three rows, one per queue, each carrying the same
   `correlationId` in `meta`. **If the rollback assertion fails, stop: FR-9's
   outbox argument is false and nothing further in P3 or P4 is sound.**

4. **Worker entrypoint and `JobRunner`.** Add the `JobRunner` to
   `WorkerModule`: one `boss.work()` per queue, dispatching to its handler,
   and started from `main.worker.ts` (still no `app.listen()`, still no
   `ApiModule` import). Wire Nest's shutdown hooks to
   `boss.stop({ graceful: true })` bounded by `GRACEFUL_SHUTDOWN_TIMEOUT_MS`.
   Handlers at this point log and return.
   *Verify:* publishing `order.confirmed` through the script from step 11's
   precursor (a temporary inline call is fine here) produces three log lines in
   the worker within a second. `docker compose stop worker` during a
   deliberately slow handler lets it finish and exits with code 0; the job is
   not re-delivered afterwards.

5. **`ShipmentService` and `ShipmentCreateHandler`.** Create the shipment with
   `INSERT … ON CONFLICT (order_id) DO NOTHING`, status `PENDING_DISPATCH`,
   `warehouse_id` read from the order row.
   *Verify:* an integration test runs the handler twice for the same order and
   asserts exactly one `shipments` row and no error. A second test runs it for
   an order whose `warehouse_id` is null and expects the handler to throw.

6. **Retries, dead-letter queues and failure history.** Apply the retry
   configuration, add the `warn` log on every failed attempt, and confirm the
   DLQ retention.
   *Verify:* two integration tests, both with short retry delays and fast
   polling so they run in seconds.
   - *Synthetic:* a `debug.always-fail` queue created inside the test; after
     five attempts the job is in `debug.always-fail.dlq`, the attempt count is
     5, the stored error matches, and five `warn` lines were logged with
     ascending `attempt`.
   - *Realistic:* `order.confirmed` published for an `orderId` that does not
     exist. `shipment.create` fails the foreign key five times and lands in
     `shipment.create.dlq` with the constraint violation as its last error,
     **while `customer.notify` and `analytics.record` complete** — the fan-out
     isolation this phase exists to prove.

7. **Tracing, correlation and logs.** Add `tracing.ts` and import it as the
   first line of `main.ts` and `main.worker.ts`. Add the correlation
   middleware (inbound `X-Correlation-Id` when valid, UUID otherwise, echoed
   back, stored in `AsyncLocalStorage`), the pino `mixin` that stamps
   `correlationId` on every line, the `meta` capture in the publisher and the
   restore in the `JobRunner` — including the single hand-written
   `job <queue>` span, in its own trace, with a span link to the publishing
   span.
   *Verify:* an integration test asserts that a job's log lines carry the same
   `correlationId` as the publishing context, and that the job's span links to
   the publisher's trace id. With the stack up, a request carrying
   `X-Correlation-Id: demo-1` returns it in the response header and every api
   and worker line for that request carries `demo-1`.

8. **DLQ gauge.** Register the observable gauge `queue.dlq.size{queue}`,
   sampled every `DLQ_GAUGE_INTERVAL_MS` from pg-boss's queue statistics.
   *Verify:* after step 6's realistic scenario has left one job in
   `shipment.create.dlq`, Grafana shows `queue.dlq.size` at 1 for that queue
   and 0 for the other two.

9. **Health.** `GET /health` becomes a pure liveness check with no database
   call; `GET /health/ready` checks the database and the queue. The worker
   writes a readiness file at boot and removes it on shutdown; add
   `worker-healthcheck.js` and wire it as the worker's compose healthcheck.
   *Verify:* with the stack up, `/health` and `/health/ready` both return 200.
   `docker compose stop postgres` leaves `/health` at 200 and moves
   `/health/ready` to 503; `docker compose start postgres` returns it to 200
   with no api restart. `docker compose ps` reports the worker healthy, and
   unhealthy while it is stopped.

10. **Compose, the dev publisher and `lgtm`.** Add the `lgtm` service
    (replacing P0's placeholder), `stop_grace_period: 30s` on `worker` and
    `ENABLE_DEV_ENDPOINTS: "true"` on `api`. Add `ENABLE_DEV_ENDPOINTS` to
    `env.schema.ts` and `.env.example`, and register
    `POST /internal/events/order-confirmed` only when it is true.
    *Verify:* with the flag unset, the route returns 404 and the app boots
    normally. With the stack up, `curl -X POST
    localhost:3000/internal/events/order-confirmed -d '{"orderId":"…"}'`
    returns 202 and produces one shipment and two log events. Grafana at
    `localhost:3001` shows the request trace and the three job traces, linked,
    all sharing one `correlationId`.

11. **`events-check` and `verify`.** Write `scripts/events-check.ts`:
    it creates a fixture order, publishes `order.confirmed`, waits for the
    three jobs to complete and asserts one shipment and three completed jobs,
    exiting non-zero otherwise. Wire it into `npm run verify` and add P3's
    integration tests to CI.
    *Verify:* `npm run verify` is green end to end against a freshly seeded
    stack, and `npm run events-check` fails loudly when the worker is stopped.

12. **README.** A P3 section: the queue topology diagram, the retry and DLQ
    table, how one order reads as a trace in Grafana, the `X-Correlation-Id`
    walkthrough, how to inspect a DLQ job in psql and how to reprocess it.
    *Verify:* following the walkthrough from a clean `docker compose up`
    reproduces every step as written.

## Acceptance criteria

**Transactional outbox (R3.2)**

- [ ] Publishing `order.confirmed` inside a transaction that is then rolled
      back leaves **zero** job rows in pg-boss's job table for all three
      queues.
- [ ] The same publish followed by a commit leaves exactly three job rows, one
      per queue.
- [ ] Both assertions hold when the transaction also writes an `orders` row:
      the order and the jobs are saved together, or neither is.
- [ ] `publish()` without a `tx` still enqueues, so a caller outside a
      transaction (a script) works.
- [ ] Publishing an event type absent from `EVENT_ROUTING` throws
      `UnroutedEventError` and enqueues nothing.

**Fan-out and handlers (R3.4, R3.6)**

- [ ] One `order.confirmed` produces exactly three jobs, one per queue, each
      with its own job id and its own retry counter.
- [ ] The three handlers run independently: with `shipment.create` failing
      every attempt, `customer.notify` and `analytics.record` still complete.
- [ ] Running the same `shipment.create` job twice creates exactly one
      `shipments` row and raises no error.
- [ ] A `shipment.create` job for an order with no `warehouse_id` fails rather
      than writing a partial row.
- [ ] The created shipment has status `PENDING_DISPATCH`, null `carrier` and
      null `tracking_number`, and its `warehouse_id` matches the order's.

**Retries and dead-letter queues (R3.5)**

- [ ] A handler that always throws is attempted exactly **5 times**, and the
      gap between attempts grows.
- [ ] After the fifth failure the job is in `<queue>.dlq`, carrying its
      attempt count and the last error, and its `sourceId` points at the
      original job.
- [ ] Five structured `warn` lines were logged for it, with ascending
      `attempt` and the same `correlationId` — the per-attempt history pg-boss
      does not keep.
- [ ] `order.confirmed` published for a non-existent `orderId` lands
      `shipment.create` in its DLQ with a foreign-key violation as the last
      error, while the other two queues complete. *(Deviation: the last
      error is a `NOT NULL` violation on `warehouse_id`, not a foreign-key
      violation on `order_id` — Postgres checks `NOT NULL` before `FOREIGN
      KEY` and the missing-order subquery resolves `NULL` either way. See
      Decisions, "Retries and dead-letter queues".)*
- [ ] A job sitting in a DLQ is still there after pg-boss maintenance has run:
      DLQ retention is explicit, not the default.
- [ ] Grafana shows `queue.dlq.size` at 1 for `shipment.create.dlq` and 0 for
      the other two after that scenario.

**Correlation and tracing (R3.7)**

- [ ] A request with a valid `X-Correlation-Id` reuses it; a request without
      one gets a generated UUID. Either way it comes back in the response
      header.
- [ ] An inbound `X-Correlation-Id` longer than 128 characters or containing
      anything outside `[A-Za-z0-9-]` is rejected and replaced by a generated
      one.
- [ ] Every api and worker log line produced by one order carries the same
      `correlationId`, plus `trace_id` and `span_id`.
- [ ] Grafana shows the `POST /internal/events/order-confirmed` request as one
      trace, and each job as its own trace named `job <queue>`, **linked** to
      the request's trace and sharing its `correlationId`. *(Deviation from the
      phase's AC 5, which asks for a single trace — see Decisions.)*
- [ ] Each job trace contains the `pg` spans its handler produced; no orphan
      database span appears outside a job trace.
- [ ] Handlers receive `payload` only: no handler reads `meta`,
      `correlationId` or `traceparent`.
- [ ] No log line or span attribute contains a card number: `redact()` still
      applies after the pino mixin is added.

**Health and shutdown (R3.1, R3.3, R3.8)**

- [ ] `GET /health` returns 200 while postgres is stopped; `GET /health/ready`
      returns 503 and returns to 200 once postgres is back, with no api
      restart.
- [ ] `/health/ready` reports the queue separately from the database.
- [ ] `docker compose ps` shows the worker healthy while it runs and unhealthy
      once stopped.
- [ ] `docker compose stop worker` during an in-flight job lets that job
      finish, exits cleanly, and the job is not re-delivered on the next start.
- [ ] The worker process listens on no TCP port (`ss`/`netstat` inside the
      container shows none).
- [ ] `WorkerModule` does not import `ApiModule`, and the api registers no
      `boss.work()`.

**Wiring and configuration**

- [ ] `docker compose up` from a clean volume creates the `pgboss` schema and
      all six queues, and a restart of both containers creates nothing new.
- [ ] With `ENABLE_DEV_ENDPOINTS` unset, `POST /internal/events/order-confirmed`
      returns 404 and the app boots normally.
- [ ] `npm run verify:db` still passes: the `pgboss` schema does not disturb
      the application schema check.
- [ ] `src/domain/**` still passes `no-restricted-imports`; no domain file
      imports pg-boss or OpenTelemetry.
- [ ] `npm run events-check` exits zero with the stack up and non-zero with the
      worker stopped.
- [ ] `npm run lint`, `npm run build`, `npm run test:unit`,
      `npm run test:integration` and `npm run verify` all pass.

## Decisions

**pg-boss@12 API — step 1 findings**

Confirmed against the installed `pg-boss@12.33.2` (types + compiled source
under `node_modules/pg-boss/dist/`) and a real Postgres, via a scratch script
deleted after this section was written.

- **ESM-only package, named export.** `pg-boss@12`'s `package.json` sets
  `"type": "module"`; its only export of the client is a **named** export
  (`export declare class PgBoss`), not a default export. `import PgBoss from
  'pg-boss'` fails to compile under this project's `module: nodenext`
  (TS2351, "not constructable") — every import must be
  `import { PgBoss } from 'pg-boss'`. Node's CJS `require()` still loads the
  package transparently at runtime (Node's `require(esm)` support, stable
  and unflagged since Node 22.12, ahead of this project's `node:22-alpine`
  base image), so no build-tool change is needed beyond the correct import.
- **`createQueue`/`getQueue` round-trip exactly as the spec assumes.**
  `notify`, `deadLetter`, `retryLimit`, `retryBackoff`, `retryDelay`,
  `retryDelayMax` and `retentionSeconds` are all accepted by
  `createQueue(name, options)` and read back unchanged by `getQueue(name)`.
  No fallback needed for any of them.
- **`send(name, data, { db: { executeSql } })` is accepted and is genuinely
  transactional.** `SendOptions` includes `ConnectionOptions` (`db?:
  IDatabase`), so the spec's exact shape works. Empirically: a job sent with
  `db.executeSql` bound to an open `pg` client, followed by that client
  rolling back, left the queue at zero jobs — the insert rolled back with
  the caller's transaction. This is FR-9's premise, confirmed here ahead of
  step 3's formal gate.
- **A dead-lettered job inherits the DLQ *queue's own* retry/retention
  configuration, not the original queue's — confirmed empirically, not just
  from the doc comment, which reads ambiguously.** Reading
  `plans.js`'s `insertDeadLetterJob` SQL shows the copy's `retry_limit`,
  `retry_backoff`, `retry_delay` and `keep_until` (the retention deadline)
  all come from `FROM {schema}.queue q WHERE q.name = $1`, where `$1` is the
  **dead-letter queue's name** — not the source queue. Verified by creating
  a work queue with `retryBackoff: true, retryDelay: 1` whose DLQ was
  created with only `retentionSeconds: 777` (so the DLQ's `retryLimit`,
  `retryBackoff`, `retryDelay` sat at their library defaults: `2`, `false`,
  `0`): the row that landed in the DLQ after retries were exhausted carried
  `retry_backoff: false, retry_delay: 0` — the **DLQ's** defaults, and a
  `keep_until` matching the DLQ's `retentionSeconds: 777`. Consequence: each
  `<queue>.dlq`'s own `createQueue()` call must set
  `retentionSeconds: DLQ_RETENTION_DAYS * 86400` for retention to mean
  anything — setting it only on the work queue would have no effect on the
  copy that actually sits in the DLQ.
- **The queue-statistics call behind the DLQ gauge cannot be `getQueue()`.**
  `getQueue(name).totalCount`/`.queuedCount` read cached columns on
  `pgboss.queue`, refreshed only by pg-boss's own periodic monitor —
  empirically still `0` twenty seconds after a job had already landed in
  the DLQ. `getQueueStats(name, { force: true })` recomputes from the job
  table on demand and returned the correct count (`queuedCount: 1`)
  immediately. Step 8's gauge reads `getQueueStats(dlqName, { force: true
  })` for each of the three DLQs, not `getQueue()`.
- **`PGBOSS_POLL_INTERVAL_SECONDS` is not a constructor option.** It maps to
  a per-`work()` call option, and there are two of them, not one:
  `pollingIntervalSeconds` (the base poll, used when a queue has no
  `notify` or the listener is down; library default `2`) and
  `notifyPollingIntervalSeconds` (the backstop poll used **once `notify` is
  active and the listener is established**; library default `30`).
  `infrastructure.md` §7's "Poll 15 s + NOTIFY" table commits to a 15 s
  worst-case for a retried or scheduled job *regardless* of listener state,
  so the `JobRunner`'s `boss.work(queue, options, handler)` must set **both**
  fields to `PGBOSS_POLL_INTERVAL_SECONDS`. Setting only
  `pollingIntervalSeconds` would leave the notify-active backstop poll at
  its 30 s default once the listener comes up, silently doubling the
  documented worst-case retry latency.
- **The instance-level switch for the dedicated LISTEN/NOTIFY connection is
  `useListenNotify`** (`ConstructorOptions`, default `false`). Only the
  worker's `PgBoss` instance sets it to `true`; the api's instance (publish
  and readiness reads only, no `work()`) does not need the listener.

**Queue topology and fan-out**

- **Yes:** three queues, one per effect, consumed by one worker process. In
  pg-boss a retry re-runs the **whole job**, so a single handler doing all
  three effects would re-create the shipment every time the notification
  failed, record analytics twice, and put one ambiguous entry in the DLQ. The
  effects are split because their failures are unrelated, which is FR-9's
  point, not decoration.
- **No:** one queue carrying three jobs distinguished by an `effect`
  discriminator. It keeps independent retries and cuts polling cost by two
  thirds — a legitimate option, and the one `infrastructure.md` §7 names as a
  mitigation at scale — but it collapses three DLQs and three gauges into one,
  and R3.4 names the three queues. At 3 queues × 1 worker ÷ 15 s the polling
  cost is ~0.2 queries/s, which is not worth optimising.
- **No:** one `order.confirmed` job whose handler fans out to the other three.
  An extra hop, and the fan-out would no longer be atomic with the order.
- **Yes:** routing lives in code (`EVENT_ROUTING`), and `publish()` sends one
  job per target queue through the same `db.executeSql`.
- **No:** pg-boss's native `publish`/`subscribe`. Its routing table lives in
  the database, and a `publish` issued before anyone has ever run `subscribe`
  — a fresh database, a worker that never started — finds zero subscriptions,
  enqueues nothing and reports success. A confirmed order with no shipment, no
  error and no retry is precisely the failure FR-9 exists to prevent. The
  code-side map has no boot-order dependency and is visible in review.
- **Yes:** an event type missing from the map throws. A typo must fail loudly
  at publish time, not vanish.

**The transactional outbox**

- **Yes:** the pg-boss job table *is* the outbox (FR-9). The job insert joins
  the caller's transaction through `{ db: { executeSql } }`, so the order and
  its jobs commit together or not at all.
- **Yes:** step 3's rollback check is a hard gate. If a rolled-back transaction
  leaves a job row, the outbox claim is false, P4 cannot be built on it, and the
  phase stops rather than continuing on a broken premise.
- **Yes:** `notify: true` per queue. `NOTIFY` fires only when the transaction
  commits, so a rolled-back TX2 never wakes a worker for a job that does not
  exist — the atomicity guarantee extends to the wake-up for free.
- **Yes:** polling stays the durable floor at 15 s. A `NOTIFY` is fire-and-forget:
  if the worker is down or restarting when it fires, it is gone, and only the
  poll recovers the job. The durable mechanism is primary; the fast one is the
  optimisation (`infrastructure.md` §7).

**Retries and dead-letter queues**

- **Yes:** `retryLimit: 4`, which is **5 attempts in total** — R3.5 asks for a
  maximum of 5 attempts, and pg-boss counts retries *after* the first attempt.
  Writing `retryLimit: 5` would silently give 6.
- **Yes:** `retryBackoff: true` with a 1 s base and a 60 s ceiling, the same
  for all three queues. Uniform is easier to explain, and when a real email
  provider arrives its queue can be retuned with `updateQueue` without a code
  change.
- **Accepted:** because retries carry no `NOTIFY`, the 15 s poll is the real
  retry granularity — the five attempts land roughly a minute apart in total
  rather than at 1/2/4/8 s. Acceptable for post-confirmation work, and stated
  in the data model so nobody reads the backoff numbers as wall-clock.
- **Yes:** one DLQ per queue. Three queues with independent lifecycles imply
  three destinations; a shared DLQ would force every consumer of it to
  re-derive which queue a job came from.
- **Yes:** a `warn` log on every failed attempt. pg-boss keeps only the **last**
  error on the job, so without this the "failure history" R3.5 requires does
  not exist. The logs hold the history, filterable by `jobId` and
  `correlationId`, with no new table.
- **Yes:** explicit long retention on the DLQs. Their jobs have no consumer, so
  pg-boss's ordinary maintenance would eventually remove them — which would
  turn "never silently dropped" into exactly that, weeks later.
- **Yes:** every error is retried, including permanent ones like a foreign-key
  violation. Distinguishing retryable from terminal errors needs a taxonomy
  that P3 has no evidence to write; five attempts of a doomed job cost about a
  minute and the DLQ records the cause. Revisit if a class of permanent errors
  becomes common.
- **Yes:** two DLQ demonstrations. A synthetic always-failing queue proves the
  mechanism deterministically; the realistic foreign-key scenario proves the
  same mechanism **and** the fan-out isolation, with a real PostgreSQL error
  rather than an invented `throw`.
- **Deviation, step 6 — the realistic scenario's error is `NOT NULL`, not a
  foreign-key violation.** `ShipmentService`'s `warehouse_id` comes from a
  subquery against `orders` (Scope: "warehouse_id read from the order"); for
  an `orderId` that does not exist, that subquery returns `NULL` — the exact
  same value it returns for an existing order with no `warehouse_id`.
  Verified directly in psql: Postgres checks `NOT NULL` constraints
  (`ExecConstraints`, before the row is even built) ahead of `FOREIGN KEY`
  triggers (which only run on a row already inserted), so the `NOT NULL`
  violation on `warehouse_id` always wins when both would otherwise fire —
  there is no query shape that reaches `order_id`'s foreign key here without
  first resolving a non-null `warehouse_id`, which a genuinely missing order
  can never supply. Both this spec's own Implementation plan step 6 and its
  Acceptance criteria describe this scenario's last error as "a foreign-key
  violation"; SPEC 04 step 6's test instead asserts the `NOT NULL` text that
  Postgres actually produces. The mechanism this scenario exists to prove —
  fails without a partial row, `customer.notify`/`analytics.record`
  unaffected — holds regardless of which `NOT NULL` constraint reports it;
  only the specific wording of the acceptance criteria is superseded by this
  note.

**Correlation and tracing**

- **Yes:** an inbound `X-Correlation-Id` is honoured when valid, and generated
  otherwise. A client or gateway that already has its own identifier can then
  search its logs and ours with the same string. Validation (≤128 chars,
  `[A-Za-z0-9-]`) keeps an attacker from injecting newlines or megabytes into
  every log line the request touches.
- **Yes:** `correlationId` and W3C `traceparent` are both carried. They are not
  redundant: the first is ours, human-sized, and appears in logs and in P4's
  error bodies; the second is what the tracing backend needs to relate spans.
- **Yes:** they travel in a `meta` envelope alongside the payload, put there by
  the adapter and consumed by the `JobRunner`. The frozen `EventPublisher` port
  is untouched, P4 keeps calling `publish({ type, payload }, tx)`, and handlers
  receive `payload` only.
- **No:** requiring P4 to place `correlationId` inside the payload. It would
  make correlation depend on discipline at every call site, and pollute a
  domain event with transport concerns.
- **Yes:** `AsyncLocalStorage` for the correlation context, written by the api
  middleware and by the `JobRunner`, read by the pino mixin and the publisher.
  It is Node's own mechanism for exactly this, and it keeps the identifier out
  of every function signature.
- **Yes:** each job gets **its own trace**, linked to the publishing span,
  rather than being a child span of the request. This is OpenTelemetry's
  messaging convention: the job is a separate unit of work that may run
  minutes later and be retried five times, and nesting it would stretch a
  "request" trace far past the `201` the client already received.
- **Deviation, deliberate:** the phase's AC 5 asks for "a trace spanning the
  HTTP request and the jobs that followed". With linked traces Grafana shows
  the request trace and three job traces, joined by links and by
  `correlationId`, instead of one waterfall. The acceptance criterion is
  restated accordingly. The requirement behind it — reconstruct one order's
  whole story from one identifier — is met either way.
- **Yes:** exactly one hand-written span, `job <queue>`, opened by the
  `JobRunner`. The phase asks for auto-instrumentation only, but nothing
  auto-instruments pg-boss: without this span the handler's `pg` spans appear
  as orphan traces with no name and no link, and no criterion about tracing
  can be met. It is one span, in one file, and handlers create none.
- **Yes:** logs stay on stdout, gaining `correlationId`, `trace_id` and
  `span_id`. NFR-4 requires structured, correlated logs, not a log backend.
- **No:** exporting logs to Loki over OTLP. It would make log/trace navigation
  prettier in the demo, at the cost of another dependency and another surface
  where an unredacted line could be stored.
- **No:** a pre-provisioned Grafana dashboard. A dashboard JSON in the
  repository rots the first time a metric is renamed, and Grafana's Explore
  view demonstrates the same data. The one metric that must be visible, the DLQ
  gauge, is asserted by an acceptance criterion instead.

**The worker, its connections and shutdown**

- **Yes:** both processes hold a pg-boss instance, but the api runs it with
  `supervise: false`, `schedule: false` and no `work()`. It needs to publish
  and to read queue state for readiness; it must not compete with the worker
  for maintenance or consume jobs.
- **No:** the api publishing with hand-written SQL instead of pg-boss. It would
  duplicate the queue's internal table format, which pg-boss is free to change
  between versions.
- **Yes:** pg-boss gets its own pool (api 2, worker 5) beside TypeORM's (api
  10, worker 5), plus the worker's dedicated `LISTEN` session connection —
  12 and 11 connections respectively. A slow application query must not be able
  to starve the worker of its ability to fetch jobs, and `LISTEN` needs a
  session-level connection that cannot come from a transaction-mode pool
  (`infrastructure.md` §7).
- **Yes:** graceful shutdown stops fetching, drains in-flight jobs up to 25 s,
  and exits — under compose's 30 s `stop_grace_period`, so Docker never SIGKILLs
  mid-job. Compose's default 10 s would cut a job in half; the job would be
  re-delivered and the work repeated.
- **Yes:** the worker still listens on no port (R3.3). Its healthcheck is a
  command: a readiness file written at boot and removed on shutdown, plus a
  database ping.
- **No:** a small HTTP health listener in the worker, which R3.8 explicitly
  permits. It would give a slightly more direct signal at the cost of the one
  property that makes the worker easy to reason about — it is a consumer, not a
  server, and nothing calls it.

**Health endpoints**

- **Yes:** `GET /health` becomes a pure liveness check with no database call,
  and `GET /health/ready` takes over the database and queue checks. A liveness
  probe that pings the database restarts every healthy api instance during a
  30-second database blip, turning a recoverable outage into a restart storm.
  This corrects P0's `/health`, which is why the file is touched here.

**Demonstrating the phase without P4**

- **Yes:** a development-only `POST /internal/events/order-confirmed`, behind
  `ENABLE_DEV_ENDPOINTS`. P3's tracing criteria need a real HTTP request as the
  origin, and `POST /orders` does not exist until P4. Twenty lines that P4
  deletes.
- **Yes:** an explicit env var rather than `NODE_ENV`, which P0 never added to
  the schema. Enabling a dev route should be a deliberate act, not a side
  effect of an unset variable.
- **Yes:** `scripts/events-check.ts` as well, so `npm run verify` proves the
  fan-out end to end without a browser — the same role `payments-check` plays
  for P2.

**The event contract**

- **Yes:** `order.confirmed` carries `{ orderId, occurredAt }` and nothing
  else. Handlers read current state from the database, which is cheap (same
  instance) and cannot go stale between publish and execution — and a handler
  needing a new field later does not force a change on P4.
- **No:** an enriched payload. It saves a query and buys a class of bugs where
  the job acts on a snapshot the database has since contradicted.

**Deviations from the phase's file ownership**

`phases/03-queue-worker-observability.md` lists the files P3 owns. This spec
also touches, deliberately:

- `src/modules/shared.module.ts` — to bind `PgBossEventPublisher` over P0's
  no-op stub, which SPEC 01 anticipated.
- `src/infrastructure/health/health.controller.ts` — the liveness/readiness
  split above.
- `src/main.ts` — the tracing import, the correlation middleware and the
  dev-only route registration.
- `src/infrastructure/config/env.schema.ts` and `.env.example` —
  `ENABLE_DEV_ENDPOINTS`.
- `docker-compose.yml` — beyond `lgtm`: `stop_grace_period` on the worker and
  `ENABLE_DEV_ENDPOINTS` on the api.
- `package.json`, `.github/workflows/tests.yml` and `README.md` — the
  `events-check` script, CI steps and documentation.

**Noted for P4**

- `POST /orders` replaces the dev publisher; delete
  `POST /internal/events/order-confirmed` and `ENABLE_DEV_ENDPOINTS` in P4's
  first step.
- P4 publishes `order.confirmed` **inside TX2**, passing the transaction, and
  builds `{ orderId, occurredAt }` — nothing more.
- The RFC 9457 error body's `correlationId` is the one this phase puts in
  `AsyncLocalStorage`; P4 reads it from there rather than generating its own.
- A new event type needs an entry in `EVENT_ROUTING`, or publishing it throws.

## Risks

| Risk | Mitigation |
| --- | --- |
| pg-boss v12's `send` does not accept the `db: { executeSql }` option, or accepts it with different semantics. FR-9's entire outbox argument depends on it. | Step 1 verifies it against the installed version before any adapter is written, and step 3's rollback check proves it empirically. If it is genuinely unsupported, the phase **stops and raises the conflict** (`phases/README.md`, rule 3): the alternative is a real `outbox_events` table plus a relay, which is a different spec, not an improvisation inside this one. |
| The retention option for DLQ jobs is guessed rather than verified, so pg-boss maintenance quietly deletes dead-lettered jobs weeks later. Nothing fails; the evidence just disappears. | Step 1 confirms the exact option name; an acceptance criterion asserts a DLQ job survives a maintenance run. This is the failure mode that motivates step 1 existing at all. |
| The `AsyncLocalStorage` context is lost across pg-boss's callback boundary, so worker logs come out with no `correlationId` — and the loss is silent, because a missing field breaks nothing. | The `JobRunner` restores the context explicitly from `meta` rather than relying on propagation, and an integration test asserts that a job's log lines carry the publishing request's `correlationId`. |
| A future refactor adds an import above `import './infrastructure/observability/tracing'` in `main.ts`. Auto-instrumentation silently stops patching `http`/`pg`, and traces quietly go half-empty. | The import carries a comment stating why it must stay first, and the acceptance criterion "no orphan database span appears outside a job trace" fails if instrumentation is not installed. |
| The linked-traces decision is read as not meeting the phase's AC 5, which says "a trace spanning". | The deviation is stated in Decisions with its reasoning, the acceptance criterion is rewritten rather than quietly dropped, and the README walkthrough shows how to navigate from the request trace to its job traces. The underlying requirement — one identifier reconstructs one order's whole story — is met. |
| Integration tests need short retry delays and fast polling to run in seconds, so the tested configuration is not the shipped one. | The constants are read from one module and overridden per test queue, never redefined; the shipped values are asserted once by a test that reads back the queue configuration created at boot. |
| The worker's healthcheck reports healthy while the process is alive but its job loops are stuck (a blocked event loop, a hung handler). The readiness file still exists and the database still answers. | Accepted and documented. A truly stuck worker surfaces as jobs not being consumed, which the DLQ gauge and queue depth show. A heartbeat updated by the running loops would be stronger and belongs with P6's operability work. |
| Both processes run queue setup at boot and race on a cold start, or pg-boss's own schema migration runs twice. | Queue creation is idempotent by design (`createQueue` is a no-op when the queue exists), and pg-boss guards its migrations with advisory locks — verified in step 2 by restarting both containers against an existing schema. |
| The pino `mixin` adds fields that bypass `redact()`, reopening the PAN leak SPEC 03 closed. | The mixin only ever adds an identifier it generated itself, and a unit test logs through the full configured pipeline (mixin + formatter) asserting a card number still comes out masked. |
| `ENABLE_DEV_ENDPOINTS` is left enabled somewhere it should not be, exposing an endpoint that publishes domain events. | It defaults to `false`, it is set only in `docker-compose.yml`, the endpoint takes an existing `orderId` and creates no order, and P4 deletes it outright. |
| The `lgtm` container is heavy (Grafana, Prometheus, Tempo, Loki in one image) and slows a laptop running the whole stack. | It is only needed for the observability demo; `docker compose up` works without it and the app degrades gracefully when the OTLP endpoint is unreachable — traces are dropped, nothing blocks. |

## What is **not** in this spec

- `POST /orders`, the three-phase saga, DTOs, idempotency keys and the RFC 9457
  error contract. — P4.
- The reservation reaper and payment reconciliation. — P6.
- Custom spans inside handlers, and business metrics beyond the DLQ gauge.
- Exporting logs to Loki, and a pre-provisioned Grafana dashboard.
- Real email and analytics sinks; shipment lifecycle beyond `PENDING_DISPATCH`.
- Running more than one worker, and consolidating queues to cut polling cost.
- A dedicated `outbox_events` table and relay, which only become necessary if
  the queue ever leaves PostgreSQL.

Each one of those, if it lands, goes in its own spec.
