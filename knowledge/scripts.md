# Scripts: verification harnesses and the demo

Scripts under `scripts/` that prove behaviour against a real database or a
running stack. All but the demo are part of `npm run verify`; they are listed in [CLAUDE.md](../CLAUDE.md), "Commands".

## Concurrency check

Code: `scripts/concurrency-check.ts` → `DEFAULT_N`, `POOL_SIZE`, `resetFixtures`

`npm run concurrency-check` (`-- 50` for N = 50; default N = 5) proves that
`InventoryService.reserve` cannot oversell under real contention. It stocks
a harness product with N units and fires N + 20 reserve attempts at it.

- **Its own `DataSource` with `poolSize: 30`.** TypeORM's default pool of 10
  would queue most of the N + 20 attempts on the connection pool instead of
  on the row lock, and the run would prove nothing about `reserve`'s locking.
- All attempts are fired from one process with `Promise.all` behind a shared
  start signal, so they contend on the same `inventory` row, not on
  connection availability or scheduling.
- **Every successful reserve is immediately committed** (simulating a
  successful payment). That is the only way the final state can reach
  `quantity_available = 0` **and** `quantity_reserved = 0`; reserve alone
  would leave N units in `quantity_reserved`.
- **Self-resetting**: `resetFixtures` restores the harness product's stock
  and deletes its earlier `inventory_movements`, so every run (at any N)
  starts clean. The append-only ledger rule applies to `src/`, not to this
  dev harness resetting its own test data.

Source: [spec 02, Implementation plan and Decisions › “Verification”](../specs/02-fulfilment-core.md#decisions);
[README, “The concurrency proof”](../README.md#the-concurrency-proof).

## Concurrency e2e

Code: `scripts/concurrency-e2e.ts` → `DEFAULT_N`, `EXTRA_LOSING_ATTEMPTS`

The same proof through the full HTTP stack. `concurrency-check` exercises
`reserve` in-process; this script fires real `POST /orders` requests at a
running api (`docker compose up`; `API_URL`, default
`http://localhost:3000`), so the guarantee is proven end to end through the
failover loop, all three saga phases and `OrderSettlementService`.

- It uses its own fixture and its own `DataSource` for setup and
  verification only; it never calls `InventoryService` itself.
- N is an argument (default 5); the burst is N + `EXTRA_LOSING_ATTEMPTS`
  (20). It refuses an N whose burst would exceed the api's
  `RATE_LIMIT_PER_MINUTE` ([architecture.md#http-hardening](architecture.md#http-hardening)).
- It resets its harness product and warehouse every run.

Source: [spec 07, Implementation plan](../specs/07-hardening-demo.md#implementation-plan).

## Harness fixtures

Code:
- `scripts/concurrency-check.ts` → `HARNESS_CUSTOMER_ID` (`d0000000-…`)
- `scripts/events-check.ts` → `HARNESS_CUSTOMER_ID` (`e0000000-…`)
- `scripts/concurrency-e2e.ts` → `HARNESS_CUSTOMER_ID` (`f0000000-…`)

Each harness script uses its own fixed, readable ids (`d0…`, `e0…`, `f0…`),
distinct from each other and from the seed (`a0…`, `b0…`), so the scripts
never contend on the same rows. `events-check` upserts the same
customer/warehouse idempotently on every run. These ids are not RFC 4122
v4, which is why the DTOs use `@IsUUID('loose')`
([orders-saga.md#validation](orders-saga.md#validation)).

## Payments check

Code: `scripts/payments-check.ts` → `DEFAULT_PAYMENTS_URL`, `main`

`npm run payments-check` runs the four deterministic test cards through
`HttpPaymentGateway` against the running `payments-mock`, with the
adapter's real timeout and retry constants (not sped up). Card `0004`'s
worst case is about 6.6 s on its own; about 7 s in total.

It creates a **fresh gateway (and so a fresh, closed breaker) per card**.
Cards `0003` and `0004` each fail all 3 attempts, 6 failures together; with
a shared breaker that is over the threshold of 5, and `0004`'s last attempt
would read `CIRCUIT_OPEN` instead of `TIMEOUT`. Each card shows its own
classification in isolation; the real app deliberately shares one breaker
across orders ([http-payments.md#circuit-breaker](http-payments.md#circuit-breaker)).

Source: [spec 03, Implementation plan and Decisions › “Packaging, tests and CI”](../specs/03-external-adapters.md#decisions);
README, "`payments-mock` — the four test cards".

## Events check

Code: `scripts/events-check.ts` → `TIMEOUT_MS`, `seedFixtureOrder`, `main`

`npm run events-check` publishes `order.confirmed` for a fixture order on
the real queues and waits (up to `TIMEOUT_MS = 45_000`) for the three routed
jobs to complete and the shipment row to appear. It replaces eyeballing
Grafana as the end-to-end check for the queue and worker path.

- It deliberately does **not** start a `JobRunner`: a real worker (the
  compose one) must already be consuming, so a stopped worker is exactly
  what turns this check red.
- Its own `PgBoss` has `supervise` / `schedule` off: the script only
  publishes and reads; the running worker owns maintenance and consumption
  ([messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles)).
- It inserts a fresh order every run (`order_number` is unique) with
  `warehouse_id` set; `ShipmentService` reads it from the order, and
  without it `shipment.create` would dead-letter.
- Its output is also what gets grepped for card numbers
  ([testing.md#e2e-tests](testing.md#e2e-tests)).

Source: [spec 04, Implementation plan and Decisions › “Demonstrating the phase” (event check without the order saga)](../specs/04-queue-worker-observability.md#decisions).

## Demo

Code:
- `scripts/demo/index.ts` → `INITIAL_STOCK`, `warmUpBeforeConcurrency`
- `scripts/demo/scenarios.ts` → `DemoContext`, `REAPER_WAIT_TIMEOUT_MS`, `REAPER_WAIT_AFTER_BREAKER_TRIP_MS`, `scenario8DuplicateKey`
- `scripts/demo/harness.ts` → `API_URL`, `CARD_0004_MOCK_DELAY_MS`, `TEST_CARD_NUMBERS`, `pollOrderStatus`, `createFixture`, `expireReservation`, `startPaymentsMockAndWait`, `getComposeLogsSince`, `fetchWithNetworkBlipRetry`

`npm run demo` walks every failure path from the README's table against a
live `api` / `worker` / `payments-mock` / `postgres` stack
(`docker compose up`), printing each scenario's expected outcome next to
what actually happened.

| # | Scenario |
|---|---|
| 1 | Happy path |
| 2 | Declined card (`…0002`) → 402 |
| 3 | Provider timeout (`…0004`) → 502 with `orderId` |
| 4 | Reaper resolves scenario 3 |
| 5 | Provider down (`docker compose stop payments-mock`) → 502, breaker opens |
| 6 | Mock restarted, scenario 5's orders expire → `CANCELLED`, stock restored |
| 7 | Unsatisfiable quantity → 422 |
| 8 | Duplicate `Idempotency-Key` → replay of scenario 1 |
| 9 | `concurrency-e2e` (own fixture) |
| 10 | Log grep: no test card number or secret anywhere in `docker compose logs` |

Structure:
- `harness.ts` holds the mechanical pieces all scenarios share (the api's
  HTTP surface, direct DB access for setup and verification,
  `docker compose` control, polling). The scenarios' own expectations stay
  in `scenarios.ts` ([references/coding-conventions.md](../references/coding-conventions.md)).
- Scenarios 1–8 share one fixture (`createFixture`: a fresh,
  `randomUUID()`-scoped customer / warehouse / product with
  `INITIAL_STOCK = 10` units), never reused across runs. Scenario 9 has its
  own.
- Each scenario is wrapped in its own try/catch (`run()`), so one failure
  still lets the rest and the final summary run.
- `DemoContext` carries only what a later scenario needs from an earlier
  one (1 → 8, 3 → 4, 5 → 6); each field is read by exactly one named
  scenario.

Details:
- `expireReservation` is the demo shortcut: it sets an order's
  `reservation_expires_at` into the past so the next reaper tick (≤ 60 s)
  picks it up, instead of waiting the real 15 minutes.
- `REAPER_WAIT_TIMEOUT_MS = 75_000`: one reaper cron tick (≤ 60 s) plus
  margin for the mock's 30 s `0004` delay (`CARD_0004_MOCK_DELAY_MS`) to have
  elapsed.
- `REAPER_WAIT_AFTER_BREAKER_TRIP_MS = 150_000`: scenario 6's orders share
  the payments breaker that scenario 5 tripped (`charge()` and
  `getStatus()` share one breaker), so the reaper's `getStatus()` reads
  `CIRCUIT_OPEN` instead of the true 404 until `BREAKER_OPEN_MS` (30 s) has
  passed. That can push resolution to a second tick: two ticks plus the
  cooldown, with margin.
- `startPaymentsMockAndWait` restarts `payments-mock` and waits for its
  `/health`. A fresh container has an empty in-memory charge store.
- `scenario8DuplicateKey` compares the replay **field by field**, not as
  JSON bytes: the replay comes from `idempotency_keys.response_body`
  (`jsonb`), which normalises key order. The contract is the same fields and
  values, not the same serialised string.
- `TEST_CARD_NUMBERS` lists every test card number the demo sends;
  scenario 10 greps `getComposeLogsSince(start)` (logs since the run
  started, never an old stack's full history) for each one and expects zero
  matches.
- `pollOrderStatus` polls `GET /orders/:id` until the status matches or a
  timeout expires.
- Two stability measures found during rehearsal:
  [investigations.md#docker-port-blip](investigations.md#docker-port-blip)
  (`fetchWithNetworkBlipRetry`) and
  [investigations.md#demo-warmup](investigations.md#demo-warmup)
  (`warmUpBeforeConcurrency`).

Source: [spec 07, Implementation plan and Rehearsal notes](../specs/07-hardening-demo.md#rehearsal-notes).
