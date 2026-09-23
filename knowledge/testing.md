# Testing

What each test suite needs to run, and the non-obvious reasoning behind
specific tests. Fixture conventions for integration tests (build your own
`randomUUID()`-scoped rows, never depend on the seed, no teardown) are in
[references/testing.md](../references/testing.md). The full list of
commands is in [CLAUDE.md](../CLAUDE.md) ("Commands").

## Integration prereqs

This replaces the prerequisite header each integration / e2e spec used to
carry. It is stated once here.

| Suite | Command | Needs |
|---|---|---|
| Unit (`*.spec.ts`) | `npm run test:unit` | No database, no running services. |
| payments-mock unit tests | `npm test` inside `payments-mock/` | Its own `npm ci` (separate package). |
| Integration (`*.integration.spec.ts`) | `npm run test:integration` | Env vars below exported, and a **migrated** Postgres reachable. Runs serially (`maxWorkers: 1`). |
| E2E (`test/*.e2e-spec.ts`) | `npm run test:e2e` | Same as integration, and `payments-mock` reachable for the order specs. |

**Environment variables** (all three are required by `env.schema.ts`'s
validation even in specs that never use them; CI values shown):

```bash
export DATABASE_URL=postgres://canals:canals@localhost:5432/canals
export PAYMENTS_URL=http://localhost:4000
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

**Local setup:**

```bash
docker compose up -d postgres           # Postgres + PostGIS
npm run migration:run                   # the seed is NOT needed
docker compose up -d payments-mock      # needed by the specs listed below
docker compose stop worker              # if a compose worker is running (see below)
```

- **Migrations yes, seed no.** CI's integration job runs migrations but not
  the seed. Every integration and e2e spec builds its own customers,
  products, warehouses and orders.
- **`payments-mock` must actually be reachable** (not just `PAYMENTS_URL`
  set) for specs that make a real `charge()`:
  `create-order.use-case.integration.spec.ts`,
  `create-order-idempotent.service.integration.spec.ts`,
  `test/orders.e2e-spec.ts` and `test/orders-read.e2e-spec.ts`. Without it
  every charge gets `ECONNREFUSED`, exhausts retries and can trip the
  in-process circuit breaker for the rest of the run.
- **Stop any local worker first.** Integration specs use the real queue
  names. `job-runner.integration.spec.ts` temporarily speeds up the real
  `shipment.create` queue and consumes from it; a `docker compose up`
  worker would race it. CI runs only Postgres and `payments-mock`, no
  worker ([Job runner tests](#job-runner-tests)).
- **Serial on purpose**: specs share one real Postgres and pg-boss
  instance; parallel Jest workers would race each other's queue rows
  ([Shared queues](#shared-queues)).
- **E2E specs boot the real `ApiModule`** (with `SharedModule`'s real
  TypeORM connection and pg-boss), so they have the same database needs as
  integration specs.
- Tests never load `tracing.ts`; no OTLP collector needs to be running even
  though `OTEL_EXPORTER_OTLP_ENDPOINT` must be set.

Source: [references/testing.md](../references/testing.md); `.github/workflows/tests.yml`.

## Domain tests

Code: `src/domain/value-objects/coordinates.spec.ts`, `src/domain/entities/order.spec.ts`, `src/domain/entities/order-status.transitions.spec.ts`

Unit tests with no database. The `@ts-expect-error` compile-time tests
(no public `status`; `Coordinates.of` rejects positional args) are
explained in [domain.md#order-entity](domain.md#order-entity) and
[domain.md#coordinates](domain.md#coordinates). Sample coordinates use
Newark, NJ, one of the seed warehouses.

## Allocation tests

Code:
- `src/application/allocation/allocate-inventory.use-case.integration.spec.ts` → `insertMockOrder`, "lands the reservation on the second candidate"
- `src/application/allocation/inventory.service.integration.spec.ts` → "commit is idempotent"

- `insertMockOrder` is the stand-in order that `onBeforeReserve` inserts
  (the saga inserts the real one).
- **Failover test** ("lands the reservation on the second candidate"): the
  test's `onBeforeReserve` zeroes the nearest warehouse's stock inside the
  first attempt's transaction, simulating a concurrent order draining it
  between the selection query and `reserve()`. `reserve()`'s own lock then
  sees 0, the attempt fails, and the reservation lands on the second
  candidate. Nothing from the failed attempt survives (the mock order, the
  stock-zeroing `UPDATE` and `reserve()`'s work all roll back together).
  This is also the deterministic proof that `RESERVATION_RACE_LOST` maps
  to 409, which the HTTP e2e test cannot force
  ([E2E tests](#e2e-tests)).
- **commit is idempotent**: calling it twice changes nothing the second
  time, and `quantity_available` stays at the post-reserve value (5 − 3 = 2)
  because commit never touches it
  ([allocation.md#ledger](allocation.md#ledger)).

## Saga tests

Code:
- `src/application/orders/create-order.use-case.integration.spec.ts` → "CAPTURED …", "DECLINED …", "UNKNOWN …"
- `src/application/orders/create-order-idempotent.service.integration.spec.ts`
- `src/application/orders/order-settlement.service.integration.spec.ts`

- The full saga spec exercises all three phases (reserve, charge, settle)
  against the real `payments-mock`.
- `CAPTURED` and `DECLINED` set `payments.settled_at` (a definitive
  outcome). `UNKNOWN` leaves it `NULL`, which is how reconciliation finds
  the row ([orders-saga.md#settlement](orders-saga.md#settlement)).
- For `CAPTURED`, the test looks for jobs in the three routed queues:
  `PgBossEventPublisher` fans `order.confirmed` out, so there is no job
  literally named `order.confirmed`.
- The idempotent-service spec asserts that `idempotency_keys.order_id` is
  recorded for a 402, even though the 402 body has no `orderId` (only the
  502 does).
- The settlement-service spec builds `orders` / `order_items` / `inventory`
  fixtures directly, because the service never creates an order; it only
  settles one already in `PENDING_PAYMENT`.

## Order number tests

Code: `src/application/orders/helpers/order-number.helpers.integration.spec.ts`

`order_number_seq` is a real sequence, shared and never reset across the
whole test run (and previous runs); other specs also call
`generateOrderNumber`. So the test asserts the format and that the next
call increments by exactly one, never an absolute value.

## Database tests

Code:
- `src/infrastructure/database/data-source.integration.spec.ts` → "queries every entity against the migrated schema"
- `src/infrastructure/database/mappers/order.mapper.integration.spec.ts`

- `AppDataSource` spec: querying every entity against the migrated schema
  is what proves the mapping. A wrong column name or type in an
  `@Column()` makes TypeORM emit SQL for something that does not exist;
  merely parsing the decorators proves nothing.
- Mapper spec: round-trips an `Order` through the real database, not just
  a type-check of the two directions. The warehouse is at Newark, NJ (same
  as the seed); the order ships to San Jose, CA, deliberately different, so
  a latitude/longitude swap in either direction shows up as a wrong value
  instead of an accidental match.

## Explain tests

Code:
- `src/infrastructure/database/repositories/warehouse-selection.explain.integration.spec.ts`
- `src/infrastructure/database/repositories/orders-read.explain.integration.spec.ts`

Both assert on the real query plan.

- **Warehouse selection**: several hundred synthetic warehouses, of which
  roughly a third can supply the product (a realistic partial selectivity,
  not all and not none), plus `ANALYZE`, all inside a rolled-back
  transaction. The accepted plans are described in
  [allocation.md#selection-query-plan](allocation.md#selection-query-plan).
- **Orders listing**: the base-case listing (no filters) must use
  `idx_orders_keyset`. The test spies on `AppDataSource.query` to capture
  the exact SQL and parameters `findPage` sends, then re-runs that statement
  prefixed with `EXPLAIN (FORMAT JSON)`, so it can never drift from what the
  repository executes. It needs fewer rows than the selection test (enough
  for the index to beat a plain `ORDER BY … LIMIT`; there is no join
  selectivity to model).

## Geocoding tests

Code:
- `src/infrastructure/geocoding/caching-geocoding.provider.spec.ts` → "evicts the least recently used entry once full"
- `src/infrastructure/geocoding/geoapify-geocoding.provider.spec.ts` → "throws after exactly one request on a 401"

- LRU eviction: after B is evicted, re-inserting it evicts C (A is kept
  because it was touched more recently than C).
- A 401 never counts against the breaker: `BREAKER_FAILURE_THRESHOLD` is 5,
  so if 401s counted, the sixth call would be rejected before reaching the
  server. The server seeing a sixth request proves they don't
  ([geocoding.md#geoapify](geocoding.md#geoapify)).

## DTO tests

Code:
- `src/infrastructure/http/dto/create-order.dto.spec.ts`
- `src/infrastructure/http/dto/list-orders-query.dto.spec.ts`

Both run a standalone `ValidationPipe` without booting Nest.
`CreateOrderDto` uses the exact global config from `main.ts`
(`{ whitelist: true, forbidNonWhitelisted: true }`);
`ListOrdersQueryDto` uses the controller's local config with
`transform: true` (which is what makes `pageSize` a number).

## HTTP tests

Code:
- `src/infrastructure/http/filters/problem-details.filter.spec.ts`
- `src/infrastructure/payments/http-payment-gateway.spec.ts` → `TEST_TIMEOUT_MS`, "shared breaker"

- Problem-details filter: one case per error-mapping row, each exception
  passed to `.catch()` directly without booting Nest
  ([orders-saga.md#error-contract](orders-saga.md#error-contract)).
- `TEST_TIMEOUT_MS = 1_000`: 50 ms was too tight on loaded CI runners and
  caused spurious retries in tests that expect exactly one request. The
  hanging-handler test keeps its own short timeout because it must trip
  `TIMEOUT`.
- Shared-breaker test: the second call's first attempt is failure #4
  (breaker still closed), its second attempt is failure #5 and opens the
  breaker, and its third attempt is rejected before any network call.

## payments-mock tests

Code: `payments-mock/src/server.spec.ts` → `buildTestServer`

`buildTestServer` injects the delays (`card0004DelayMs`, `approvedDelay*`)
through a spy that records the requested values but waits only briefly for
real. The values stay distinguishable in assertions without slowing the
suite down ([http-payments.md#payments-mock](http-payments.md#payments-mock)).

## Messaging tests

Code:
- `src/infrastructure/messaging/pg-boss-event-publisher.integration.spec.ts` → `orderFixture`
- `src/infrastructure/messaging/pg-boss-event-publisher.spec.ts` → "wraps a supplied TransactionContext into …"

- `orderFixture` is a minimal valid `orders` row, not built through the
  mapper, standing in for "the order update done alongside the publish".
- The unit test checks the `{ rows }` bridge: `TransactionContext.executeSql`
  resolves whatever `EntityManager.query()` returns, a bare rows array
  ([messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox)).

<a id="pgboss-esm-jest"></a>

## pg-boss ESM in Jest

Code: `src/infrastructure/messaging/pg-boss-event-publisher.integration.spec.ts`; `test/jest-integration.json`

This spec is the **critical gate for the transactional outbox**: if its
rollback assertion fails (a job survives a rolled-back transaction), the
outbox guarantee is false and nothing built on it is sound.

It was also the first test to construct a real `PgBoss`. pg-boss 12 is
**ESM-only**. Jest's default `transformIgnorePatterns` skips
`node_modules`, so `require('pg-boss')` inside Jest's CommonJS sandbox
throws `ERR_REQUIRE_ESM`, even though the built app
(`node dist/main.worker.js`) loads it fine through Node's own
`require(esm)`, which Jest's VM-sandboxed loader does not use.
`test/jest-integration.json` sets `"transformIgnorePatterns": []` so
`ts-jest` transforms it.

Source: [spec 04, Decisions › “The transactional outbox” and “pg-boss@12 API” findings](../specs/04-queue-worker-observability.md#decisions).

## Job runner tests

Code: `src/infrastructure/messaging/job-runner.integration.spec.ts` → `FAST_POLLING_INTERVAL_SECONDS`, `FAST_CONFIG_SERVICE`, `dlqRowCount`, "retries and dead-letter queues", "scheduled jobs"

- **Fast polling**: both tests run with a 1 s poll interval
  (`FAST_CONFIG_SERVICE`), so five attempts take seconds, not minutes. The
  shipped retry constants (`QUEUE_RETRY_LIMIT`, delays) are never redefined
  for tests; one test reads back the queue configuration created at boot
  and asserts the shipped values.
- **Supervise interval**: dead-lettering happens on pg-boss's background
  supervise pass, not on job pickup. The default
  `superviseIntervalSeconds` is 60 s, so the DLQ row could land anywhere up
  to 60 s after the last attempt, racing the 20 s wait. The test speeds it
  up the same way.
- **Realistic test** (`order.confirmed` for a non-existent order):
  - it temporarily speeds up only the retry *timing* of the real
    `shipment.create` queue with `updateQueue` (integer seconds only, so 1 s
    is the minimum), then restores it; the attempt count is untouched. This
    is why a live local worker must be stopped first
    ([Integration prereqs](#integration-prereqs));
  - it waits for the full end state (DLQ row **and** the other two queues'
    successful jobs), not just the DLQ row: `shipment.create`'s five
    attempts take longer than the others' single attempt, but each queue
    polls independently;
  - every assertion is scoped to this run's `orderId` (the dead-lettered
    copy carries the same `data`), so rows left by an earlier local run
    cannot satisfy it early;
  - the failure is a `NOT NULL` violation, not the `order_id` foreign key
    ([investigations.md#not-null-before-fk](investigations.md#not-null-before-fk)).
- **Synthetic test**: a handler that always throws; `source_retry_count`
  on the DLQ copy is 0-indexed at the last attempt, so +1 is the attempt
  count ([messaging-jobs.md#dead-letter](messaging-jobs.md#dead-letter)).
- `dlqRowCount` reads `pgboss.job` directly instead of `getQueueStats`
  ([investigations.md#pgboss-queue-stats-throttle](investigations.md#pgboss-queue-stats-throttle)).
- **Scheduled jobs**: a job with `{ payload: {} }` and no `meta` is exactly
  what `boss.schedule(queue, cron, { payload: {} })` inserts, and must run.

Source: [spec 04, Risks and Decisions › “Retries and dead-letter queues”](../specs/04-queue-worker-observability.md#risks).

## Observability tests

Code:
- `src/infrastructure/messaging/correlation-and-tracing.integration.spec.ts`
- `src/infrastructure/observability/dlq-gauge.integration.spec.ts`

- **No real `tracing.ts`** in tests (nothing imports `main.ts` /
  `main.worker.ts`). Each spec registers its own provider: a
  `NodeTracerProvider` with an `InMemorySpanExporter`, or a
  `MeterProvider` with an `InMemoryMetricExporter`. Nothing else registers
  a provider or propagator first.
- Correlation test: before publishing, it sets up what
  `CorrelationMiddleware` and `HttpInstrumentation` provide for a real
  request (a correlation id in `AsyncLocalStorage` and an active span).
- DLQ gauge test: collection is driven with `forceFlush()` instead of
  waiting for the 60 s interval. Because `getQueueStats({ force: true })`
  is throttled to one recomputation per queue per 60 s, the gauge is read
  at most **once** in the file; the baseline comes from a plain
  `count(*)` on `pgboss.job`. To defeat the 60 s cache deterministically,
  the test back-dates `pgboss.queue.monitor_on` instead of sleeping
  ([investigations.md#pgboss-queue-stats-throttle](investigations.md#pgboss-queue-stats-throttle)).

## Shared queues

Code: `src/infrastructure/messaging/correlation-and-tracing.integration.spec.ts`

All integration specs use the same real queue names, and some leave a job
unconsumed (for example the publisher spec's "still enqueues without a tx"
case). A handler or span read that is not filtered would also see those
leftovers when the whole suite runs. So assertions filter by this run's own
`orderId`, or by this run's job ids (`messaging.message.id`).

## E2E tests

Code:
- `test/app.e2e-spec.ts`
- `test/hardening.e2e-spec.ts` → `itLocalOnly`
- `test/orders.e2e-spec.ts` → "409/422: two concurrent orders racing …", "502: card …0004 times out …"
- `test/orders-read.e2e-spec.ts` → "1/2/3: paginates 50 seeded orders …"

All run real HTTP requests against a fully booted `ApiModule`. Fixtures are
built with `AppDataSource` (`randomUUID()`-scoped); the requests use the
app's own connection (`app.get(DataSource)`), which is what query spies
target.

- **Hardening**: `Test.createTestingModule` does not run `main.ts`'s
  `bootstrap()`, so Helmet, CORS and the body parser are re-applied in the
  test exactly as `main.ts` applies them. The throttler is already an
  `APP_GUARD` in `ApiModule`.
  - The rate-limit test (`itLocalOnly`) fires 601 truly concurrent
    connections (`Promise.all`, no keep-alive) at an in-memory server. It
    is reliable locally, but GitHub Actions' shared runners have tighter
    socket/backlog limits and the connect burst hits `ECONNRESET` before
    the app can answer 429. It stays local-only until the request firing is
    made CI-safe (probably a shared keep-alive agent). (Also listed in
    [investigations.md#ci-connect-burst](investigations.md#ci-connect-burst).)
- **POST /orders**: covers the error-mapping rows, the happy path and
  idempotency. Not covered here, by design:
  - `payments-mock` stopped → 502 plus open breaker: the breaker is global
    in-process state, and tripping it would contaminate every other test's
    payment calls. It needs its own isolated run;
  - "no card number in logs": checked by grepping log output
    (`npm run events-check`, `npm run demo`), not a Jest assertion.
- **Racing orders (409/422)**: which status the loser gets depends on how
  the two in-process requests interleave. If the winner's whole reserve
  phase commits before the loser's selection query, the loser sees no
  candidates (422, `NO_CANDIDATES`); if both select the same candidate and
  only one wins the row lock, the loser exhausts its failover loop (409,
  `RESERVATION_RACE_LOST`). `Promise.all` over two HTTP calls cannot force
  either interleaving (the same lesson as the concurrency harness: a run
  can look concurrent while actually running sequentially). The
  deterministic 409 proof is the allocation integration test
  ([Allocation tests](#allocation-tests)). This test asserts only the
  invariant that matters at HTTP level: no double-booking.
- **502 for card `…0004`**: the 502 body carries `orderId`, so the client
  polls `GET /orders/:id` instead of retrying with a new key.
- **Read side**: covers the listing and detail acceptance criteria; the
  `EXPLAIN` criterion lives in the repository's explain spec
  ([Explain tests](#explain-tests)). The pagination test inserts a brand-new
  order (newer than every other row, so it would sort first if pagination
  restarted) between page 1 and page 2; it must not leak into a later page
  of the in-flight cursor walk.

Source: [spec 05, Risks](../specs/05-order-creation-saga.md#risks);
[spec 06, Acceptance criteria](../specs/06-read-side.md#acceptance-criteria);
[spec 02, Risks](../specs/02-fulfilment-core.md#risks).
