# Investigations and third-party quirks

Things that were verified by experiment, or behaviour of Postgres, pg-boss,
pino, Node or Docker that is not obvious from their docs. Each entry says
what was observed, how it was confirmed, and what the code does about it.

## NOT NULL before FK

Code:
- `src/application/jobs/shipment.service.ts` → `INSERT_SHIPMENT_SQL`
- `src/infrastructure/messaging/job-runner.integration.spec.ts` → "realistic: order.confirmed for a non-existent order"

**Question:** when `shipment.create` runs for an order that does not exist,
which constraint fails?

`INSERT_SHIPMENT_SQL` reads `warehouse_id` with a subquery on the same `$1`:

```sql
VALUES ($1, (SELECT warehouse_id FROM orders WHERE id = $1), 'DISPATCHED', …)
```

rather than `INSERT … SELECT … FROM orders`. With `INSERT … SELECT`, a
missing order would make the `SELECT` match zero rows and the statement
would silently write nothing and succeed. With the subquery, the `INSERT`
always runs, and either way nothing partial is written and no application
branching is needed:

- the order exists but its `warehouse_id` is `NULL` → the subquery returns
  `NULL` → `warehouse_id NOT NULL` violation;
- the order does not exist → the subquery **also** returns `NULL` → the same
  `warehouse_id NOT NULL` violation, **not** the `order_id REFERENCES
  orders(id)` foreign key.

**Verified directly in psql:** Postgres checks `NOT NULL` constraints
(`ExecConstraints`, before the row is even built) ahead of foreign-key
triggers (which only run on a row that has already been inserted). So a
`NOT NULL` violation always wins when both would fire. No query shape
reaches the `order_id` foreign key here without first resolving a non-null
`warehouse_id`, which a missing order can never supply.

**Consequence:** the phase plan described this failure as a "foreign-key
violation". The actual error is a `NOT NULL` violation. The property the
test exists to prove still holds: the job fails without a partial row, is
retried and dead-lettered, and the other two queues are unaffected.

Source: [spec 04, Decisions › “Retries and dead-letter queues” (deviation noted there)](../specs/04-queue-worker-observability.md#decisions);
[messaging-jobs.md#shipment-create](messaging-jobs.md#shipment-create).

## pino wrapSerializers

Code: `src/infrastructure/logging/pino.config.ts` → `pinoOptions` (`wrapSerializers`, `serializers`)

`pino-http`'s default `req` / `res` serializers (`pino-std-serializers`) dump
every header and Express routing internals (`params.splat`), noise nobody
reads a QA log line for; `correlationId`, `trace_id` and `span_id` already
identify the request. So they are replaced with custom serializers that
keep only what a human scans for.

**Quirk:** by default `pino-http` runs its own `res` serializer **first**
and passes its *output* to ours (`wrapResponseSerializer`). That default
serializer reports `statusCode: null` whenever it runs before
`res.headersSent` becomes true. **Verified:** this happened on every
request here, not just some.

**Fix:** `wrapSerializers: false` (a `pino-http`-only option, so
`pino.config.ts` declares a `PinoHttpOptions` type for it). `pino-http` then
passes the raw `req` / `res` objects straight to our functions, and
`res.statusCode` is the real code by the time pino-http logs on the
`finish` event.

Source: [observability.md#logging](observability.md#logging).

<a id="pgboss-notify-polling"></a>

## pg-boss notify polling

Code: `src/infrastructure/messaging/job-runner.ts` → `JobRunner.start`

**Finding (checked against pg-boss 12 when it was adopted):** `notify: true`
on a queue does not replace polling. It only changes which *backstop* poll
interval applies once the LISTEN/NOTIFY listener is up
(`notifyPollingIntervalSeconds`); otherwise the base
`pollingIntervalSeconds` applies.

The infrastructure design commits to a 15 s worst case for a retried or
scheduled job regardless of listener state, so `JobRunner` sets **both**
fields to the same value, `PGBOSS_POLL_INTERVAL_SECONDS` (default 15). Only
the worker holds the LISTEN/NOTIFY connection
([messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles)).

Source: [spec 04, Decisions › “pg-boss@12 API” findings](../specs/04-queue-worker-observability.md#decisions);
[infrastructure.md, “Decided configuration: 15 s poll + LISTEN/NOTIFY”](../engineering:documentation/infrastructure.md#decided-configuration-15-s-poll--listennotify).

<a id="pgboss-queue-stats-throttle"></a>

## pg-boss queue stats throttle

Code:
- `src/infrastructure/messaging/job-runner.integration.spec.ts` → `dlqRowCount`
- `src/infrastructure/observability/dlq-gauge.integration.spec.ts`
- `src/infrastructure/observability/dlq-gauge.ts` → `registerDlqGauge`

**Quirk:** `boss.getQueueStats(name, { force: true })` recomputes from the
job table at most **once per queue per 60 s**
(`QUEUE_STATS_FORCE_TTL_SECONDS` in `node_modules/pg-boss/dist/manager.js`)
and serves the cached result to every call inside that window. (Plain
`getQueue(name)` is worse: it reads a column the pg-boss monitor refreshes
on its own schedule, stale by tens of seconds.)

**How it was found:** the job-runner test timed out at exactly its 20 s
deadline although the DLQ row had landed 9 s in; its poll loop kept getting
the cached pre-DLQ count. The DLQ gauge test hit it again: a second read
moments after the first silently returned the old snapshot.

**What the code does:**
- The DLQ gauge keeps using `getQueueStats({ force: true })`: it samples once
  every 60 s, the same as the throttle window, so each sample is fresh
  ([observability.md#dlq-gauge](observability.md#dlq-gauge)).
- `dlqRowCount` (job-runner test) reads `pgboss.job` directly. No queue in
  this repo sets `partition: true`, so every job, dead-lettered ones
  included, lives in the one shared `pgboss.job` table.
- The DLQ gauge test reads the gauge only once, takes its baseline from a
  `count(*)` on `pgboss.job`, and back-dates `pgboss.queue.monitor_on` to
  force a real recomputation deterministically instead of sleeping.

Source: [spec 04, Decisions › “pg-boss@12 API” findings](../specs/04-queue-worker-observability.md#decisions).

## Docker port blip

Code: `scripts/demo/harness.ts` → `fetchWithNetworkBlipRetry`

**Observed** with this repo's Docker Desktop setup: right after a
`docker compose stop` / `start`, the host's port forwarding can drop for an
instant. The request fails with a bare `fetch failed` `TypeError` and no HTTP
response at all; it has nothing to do with the api or `payments-mock`.

**Fix:** the demo retries **once**, after a short pause, only on that bare
network failure. A real HTTP response (even a 500) is never retried.

Source: [scripts.md#demo](scripts.md#demo).

## Demo warmup

Code: `scripts/demo/index.ts` → `warmUpBeforeConcurrency`

**Observed:** scenario 6 restarts `payments-mock`. Its `/health` answering
does not mean the api → `payments-mock` path is warm (OpenTelemetry
instrumentation JIT, the outbound `fetch` connection pool, the mock's own
first-request compilation). Firing `concurrency-e2e`'s 5-way simultaneous
burst at that cold path could make one attempt exceed `ATTEMPT_TIMEOUT_MS`
(2 s), which was enough to trip the shared payments breaker and make the
other requests fail in cascade.

It was a `TIMEOUT`, not `CONNECTION_REFUSED`, and an idle sleep in its place
did not help: only real traffic warms the path.

**Fix:** a few **sequential** real orders go through the exact code path
`concurrency-e2e` is about to hit concurrently.

Source: [spec 07, Rehearsal notes](../specs/07-hardening-demo.md#rehearsal-notes).

## Postgres aborted transaction

Code: `src/infrastructure/database/verify-schema.ts` → `checkRejectionsInARolledBackTransaction`

In Postgres, after any statement fails, every later statement in the same
transaction fails with "current transaction is aborted" until a `ROLLBACK`.
The first version of `verify-schema` had no savepoints, and every check
after the first expected failure reported a false negative. Each expected
failure is now wrapped in a `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`
([database.md#savepoints](database.md#savepoints)). (The explanation also
stays as a code comment.)

## instanceof across Jest realms

Code: `src/infrastructure/http/fetch-errors.ts` → `classifyFetchError`

Node's native `fetch` (undici) and Jest's per-file sandbox
(`jest-environment-node` gives each test file its own realm) can disagree on
which `Error` / `DOMException` constructor built an error, so `instanceof`
checks are unreliable across that boundary. `classifyFetchError` therefore
reads properties (`.name`, `.cause.code`) instead
([http-payments.md#fetch-errors](http-payments.md#fetch-errors)). (The
explanation also stays as a code comment.)

## CI connect burst

Code: `test/hardening.e2e-spec.ts` → `itLocalOnly`

The rate-limit e2e test fires 601 truly concurrent connections
(`Promise.all`, no keep-alive) at an in-memory server. It is reliable on a
local machine, but GitHub Actions' shared runners have tighter
socket/backlog limits and the connect burst itself hits `ECONNRESET` before
the app can answer 429. The test is local-only until the request firing is
made CI-safe, most likely with a shared keep-alive agent
([testing.md#e2e-tests](testing.md#e2e-tests)). (The explanation also stays
as a code comment.)

## Related findings documented elsewhere

- pg-boss emits `'error'` on a lost connection; without a listener Node
  crashes the process (found with `docker compose stop postgres`):
  [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles).
- pg-boss 12 is ESM-only and needs `transformIgnorePatterns: []` in Jest:
  [testing.md#pgboss-esm-jest](testing.md#pgboss-esm-jest).
- Dead-lettered jobs take their retention from the DLQ, not the source
  queue: [messaging-jobs.md#retries-dlq](messaging-jobs.md#retries-dlq).
- Without `enableShutdownHooks()` the api's e2e test never exited (pg-boss
  pool leak): [architecture.md#bootstrap](architecture.md#bootstrap).
- TypeORM returns `geography` columns as GeoJSON once `spatialFeatureType`
  / `srid` are declared (verified against a live database):
  [database.md#geography-columns](database.md#geography-columns).
- The selection query does not use the GiST index for ordering (captured
  plan): [allocation.md#selection-query-plan](allocation.md#selection-query-plan).
