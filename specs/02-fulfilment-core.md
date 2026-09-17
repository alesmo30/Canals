# SPEC 02 — P1 Fulfilment Core: warehouse selection and stock reservation

> **Status:** Approved
> **Depends on:** SPEC 01
> **Date:** 2026-09-17
> **Objective:** Pick, in one SQL statement, the nearest warehouse that can supply every line of an order, and reserve its stock inside a short transaction that no amount of concurrency can make oversell.

## Scope

**In:**

- A single hand-written, parameterised SQL statement in
  `src/infrastructure/database/sql/select-warehouse.sql` returning the top 3
  warehouses that can supply **every** line of an order, ordered by geodesic
  distance from the shipping point, ties broken by `warehouse.id`.
- `WarehouseSelectionRepository` executing that statement, passing order lines as
  two parallel arrays (`uuid[]`, `int[]`) unpacked with `unnest`.
- A `WarehouseCandidate` type — `warehouseId`, `name`, `distanceMeters` — and
  nothing else. **No domain service**: every FR-2 rule lives in the SQL.
- `InventoryService.reserve(manager, ...)` — one attempt, inside a transaction
  opened by the caller. Locks with `SELECT ... FOR UPDATE ORDER BY product_id`
  under a 3-second `lock_timeout`, re-verifies availability under the lock,
  moves available → reserved, appends `RESERVE` movements, and stamps
  `orders.warehouse_id` and `orders.reservation_expires_at`.
- `InventoryService.release(manager, ...)` and `InventoryService.commit(manager, ...)`,
  both idempotent: they read the latest `inventory_movements` row for
  `(order_id, product_id)` and no-op when it is already `RELEASE` or `COMMIT`.
- `AllocateInventoryUseCase` in `src/application/allocation/`, owner of the
  failover loop: one transaction per candidate, up to 3 attempts, then
  "no fulfilment possible". It accepts an `onBeforeReserve(manager, warehouseId)`
  callback executed inside each attempt's transaction — P1 inserts a mock order
  through it, P4 will insert the real one.
- One fixed customer added to the P0 seed, with a hardcoded UUID, so an order row
  can exist without inventing a customer per test.
- `sql/verify-ledger.sql` — reconstructs every `inventory` balance by replaying
  its movements and returns only the discrepancies.
- `scripts/concurrency-check.ts` — seeds N units, fires N + 20 concurrent
  reservation attempts through its own `DataSource` with a pool of 30, asserts
  exactly N succeed and the ledger reconciles. N is an argument, default 5.
- Integration tests against the compose stack: nearest-warehouse correctness,
  the C-6 "no single warehouse can fill it" case, idempotent `release`/`commit`,
  and an `EXPLAIN` assertion that the GiST index drives the ordering.
- An ESLint `no-restricted-imports` rule forbidding HTTP clients under
  `src/application/allocation/**` and
  `src/infrastructure/database/repositories/**`.
- A README section showing the selection query's plan and the ledger replay.
- `npm run verify` extended with P1's integration tests and the default-size
  concurrency harness.

**Out of scope (for future specs):**

- `POST /orders`, DTOs, idempotency keys and the error contract — P4. P1 is
  driven from tests and scripts only.
- Creating `orders` and `order_items` rows as production behaviour, and every
  order status transition. P1 writes only `warehouse_id` and
  `reservation_expires_at`; the mock order exists solely to satisfy the
  foreign key from `inventory_movements`. — P4.
- Geocoding. Coordinates are passed in directly as `Coordinates`. — P2.
- Payment, and therefore the decision of when `release` or `commit` is called in
  production. — P2, P4.
- The reservation reaper and payment reconciliation, which consume `release` and
  `commit` but schedule nothing here. — P6.
- pg-boss, jobs, events and observability. — P3.
- The end-to-end concurrency proof through HTTP. P1 builds the harness; P6
  extends it. — P6.
- Restocking (`RESTOCK`) and manual corrections (`ADJUST`). Those movement types
  exist in the schema and stay unused.

## Data model

**This spec introduces no new tables, columns, enum types or indexes.** The
schema is frozen by SPEC 01 and P1 compiles against it as-is. What follows is
the shape of the code contracts P1 introduces, plus the exact semantics it
imposes on two tables that already exist.

### TypeScript contracts

```ts
// What the selection query returns, one row per candidate warehouse.
export interface WarehouseCandidate {
  warehouseId: string;
  name: string;
  distanceMeters: number;
}

// One requested line. Quantity is a positive integer; validation
// belongs to P4's DTO, not here.
export interface OrderLine {
  productId: string;
  quantity: number;
}

// Everything reserve() needs. `manager` is the caller's transaction.
export interface ReserveCommand {
  orderId: string;
  warehouseId: string;
  lines: OrderLine[];
}
```

`AllocateInventoryUseCase` takes the shipping `Coordinates` (SPEC 01's value
object), the lines, and an `onBeforeReserve(manager, warehouseId)` callback run
inside each attempt's transaction before `reserve`.

Failure is expressed with two named errors, so the caller can tell a retryable
condition from a terminal one:

- `InsufficientStockError` — raised by `reserve` when availability fails under
  the lock, or when `lock_timeout` fires. The use case catches it and moves to
  the next candidate.
- `NoFulfilmentPossibleError` — raised by the use case when no candidate
  qualifies, or when all attempts are exhausted. Carries the unsatisfiable
  product ids, which P4's 422 response will need.

### The selection statement

`src/infrastructure/database/sql/select-warehouse.sql`, one statement, three
parameters: `$1` the shipping point as `geography`, `$2` the product ids as
`uuid[]`, `$3` the quantities as `int[]`.

```sql
WITH requested AS (
  SELECT product_id, quantity
  FROM unnest($2::uuid[], $3::int[]) AS t(product_id, quantity)
)
SELECT w.id, w.name, ST_Distance(w.location, $1::geography) AS distance_meters
FROM warehouses w
JOIN inventory i ON i.warehouse_id = w.id
JOIN requested r ON r.product_id = i.product_id
JOIN products p ON p.id = i.product_id
WHERE w.is_active AND p.is_active AND i.quantity_available >= r.quantity
GROUP BY w.id, w.name, w.location
HAVING count(*) = (SELECT count(*) FROM requested)
ORDER BY w.location <-> $1::geography, w.id
LIMIT 3;
```

Three details carry the rules:

- `HAVING count(*) = (SELECT count(*) FROM requested)` is C-6. A warehouse
  covering four of five lines produces four rows and is discarded. Combined
  stock across warehouses is never considered.
- `<->` is the operator the GiST index answers; `ST_Distance` is only for the
  payload. Ordering by `ST_Distance` instead would force a sort.
- `w.id` as the second `ORDER BY` key makes the result reproducible when two
  warehouses sit at the same distance.

### Semantics imposed on `inventory` and `inventory_movements`

Every movement row records the balances **after** applying it, so a replay is a
running sum, not a reconstruction of intent:

| Operation | `quantity_available` | `quantity_reserved` | Movement row |
|---|---|---|---|
| `reserve` | − qty | + qty | `RESERVE`, `quantity_delta = -qty` |
| `release` | + qty | − qty | `RELEASE`, `quantity_delta = +qty` |
| `commit` | unchanged | − qty | `COMMIT`, `quantity_delta = 0` |

`commit` leaves `quantity_available` untouched on purpose: the units left the
available pool when they were reserved. Its `quantity_delta` of `0` reflects
that no stock moved in or out of availability — only the reservation ended.

`order_id` is never null on rows written by P1. The ledger is append-only: no
`UPDATE`, no `DELETE`, ever.

### Seed addition

One customer with a hardcoded UUID, `ON CONFLICT DO NOTHING` like every other
seeded row, added to `src/infrastructure/database/seed.ts`. It exists so an
`orders` row can be inserted without inventing a customer per test, and P4 reuses
it for its demo.

## Implementation plan

Every step ends with the repository building and `npm run lint` clean. Steps 2
onward are verified against the running compose stack on `localhost:5432`.

1. **Groundwork.** Add the fixed customer to
   `src/infrastructure/database/seed.ts` with a hardcoded UUID and
   `ON CONFLICT DO NOTHING`. Add the ESLint `no-restricted-imports` rule
   forbidding HTTP clients (`axios`, `node-fetch`, `undici`, `@nestjs/axios`,
   `http`, `https`) under `src/application/allocation/**` and
   `src/infrastructure/database/repositories/**`.
   *Verify:* running the seed twice leaves the customer row count at 1; a
   scratch file importing `axios` under `src/application/allocation/` fails
   `npm run lint`, then delete it.

2. **The selection statement.** Write
   `src/infrastructure/database/sql/select-warehouse.sql` and the
   `WarehouseSelectionRepository` that loads and executes it, mapping rows to
   `WarehouseCandidate`.
   *Verify:* against the seeded data, a request for the iPhone 17 shipping to a
   New York point returns Newark first; the distance matches a hand-checked
   `ST_Distance` between the known city coordinates.

3. **Selection integration tests.** The nearest-warehouse case, the C-6 case
   (MacBook Pro 16" at quantity 3 — 2 units in every warehouse, combined stock
   would cover it, result must be empty), the inactive-warehouse exclusion, and
   the tie-break by `warehouse.id`.
   *Verify:* the suite passes against the compose stack.

4. **The `EXPLAIN` assertion (R1.2).** A test that opens a transaction, inserts
   several hundred synthetic warehouses, runs `ANALYZE warehouses`, executes
   `EXPLAIN (FORMAT JSON)` on the selection statement, asserts the `Order By:`
   sits inside an `Index Scan using idx_warehouses_location_gist`, and rolls
   back.
   *Verify:* the test passes, and the captured plan is pasted into the spec's
   decisions. If the planner refuses the index scan with the inventory join
   present, record the plan and the reason, then apply the documented fallback:
   select candidates by availability first, order that smaller set by distance.

5. **`InventoryService.reserve`.** Takes the caller's `EntityManager`. Sets
   `lock_timeout` to 3s, locks the candidate's rows with
   `SELECT ... FOR UPDATE ORDER BY product_id`, re-verifies availability,
   applies the deltas, appends `RESERVE` movements with the resulting balances,
   and stamps `orders.warehouse_id` and `orders.reservation_expires_at` from
   `RESERVATION_TTL_MINUTES`. Raises `InsufficientStockError` on failure, lock
   timeout included.
   *Verify:* an integration test reserves against the seeded iPad Pro, asserts
   the balances moved, the movement rows landed with correct
   `available_after` / `reserved_after`, and `reservation_expires_at` is 15
   minutes out. A second test asks for more than the stock and expects
   `InsufficientStockError` with the balances untouched.

6. **`release` and `commit`.** Same locking discipline. Each reads the latest
   `inventory_movements` row for `(order_id, product_id)` inside the
   transaction and returns without writing when it is already `RELEASE` or
   `COMMIT`.
   *Verify:* reserve, then release twice — stock returns exactly once and the
   ledger holds exactly one `RELEASE` per line. Same for commit. Then release
   after commit: no-op, balances unchanged.

7. **Ledger replay.** Write `sql/verify-ledger.sql`, summing every movement per
   `(warehouse_id, product_id)` and returning only rows that disagree with
   `inventory`.
   *Verify:* after step 6's tests have moved stock around, the query returns
   zero rows. Then a deliberate manual `UPDATE inventory` makes it return
   exactly that row; undo it afterwards.

8. **`AllocateInventoryUseCase`.** Calls the selection repository, then loops
   over candidates: one transaction per attempt, running
   `onBeforeReserve(manager, warehouseId)` and then `reserve`. Catches
   `InsufficientStockError` and moves on. After 3 attempts or with no
   candidates left, raises `NoFulfilmentPossibleError` with the unsatisfiable
   product ids.
   *Verify:* an integration test where the first candidate's stock is zeroed
   between the selection and the reservation — the reservation lands on the
   second candidate, and no partial write survives from the first attempt.

9. **Concurrency harness.** `scripts/concurrency-check.ts`: its own `DataSource`
   with `poolSize` 30, `N` from argv (default 5), sets the test product's stock
   to N and clears its prior movements, releases N + 20 attempts against a
   shared start signal, then reports successes, failures, final balances and the
   ledger check.
   *Verify:* `npm run concurrency-check` reports exactly N successes and 20
   `InsufficientStockError`s, `quantity_available = 0`, and `verify-ledger.sql`
   returns nothing. Re-running gives the same result. `-- 50` gives 50 and 20.

10. **README and `verify`.** A README section with the captured plan, the
    ledger replay query and a sample harness run. Wire P1's integration tests
    and the default-size harness into `npm run verify`.
    *Verify:* `npm run verify` is green end to end against a freshly seeded
    stack.

## Acceptance criteria

- [ ] For the seeded data and a New York shipping point, the selection query
      returns Newark first, and its `distance_meters` matches a hand-computed
      `ST_Distance` against the known city coordinates.
- [ ] An order for 3 units of the MacBook Pro 16" returns **no candidates**,
      although the five warehouses hold 10 units between them (C-6).
- [ ] An order whose lines are spread across two warehouses, each holding only
      part of them, returns no candidates.
- [ ] Setting a warehouse `is_active = false` removes it from the results;
      setting a product `is_active = false` removes every warehouse for orders
      containing it.
- [ ] Two warehouses at an identical distance are returned in `warehouse.id`
      order, and repeated runs return the same order.
- [ ] The query returns at most 3 candidates.
- [ ] `EXPLAIN` on the selection statement, with several hundred warehouses and
      fresh `ANALYZE` statistics, shows `Order By:` inside
      `Index Scan using idx_warehouses_location_gist` — or the deviation is
      recorded in the decisions section with its plan and its reason.
- [ ] The selection statement is a single statement, contains no string
      concatenation, and is identical regardless of the number of order lines.
- [ ] `reserve` moves `quantity_available` down and `quantity_reserved` up by
      exactly the requested quantity, and writes one `RESERVE` movement per line
      whose `available_after` / `reserved_after` match the row's post-state.
- [ ] `reserve` sets `orders.warehouse_id` and
      `orders.reservation_expires_at = now() + RESERVATION_TTL_MINUTES`.
- [ ] `reserve` raises `InsufficientStockError` and leaves every balance
      untouched when the request exceeds what the lock reveals.
- [ ] The locking `SELECT` carries `FOR UPDATE` with `ORDER BY product_id`, and
      the transaction sets `lock_timeout` to 3 seconds.
- [ ] Calling `release` twice for the same order returns the stock exactly once
      and leaves exactly one `RELEASE` movement per line.
- [ ] Calling `commit` twice clears the reservation exactly once and leaves
      exactly one `COMMIT` movement per line.
- [ ] `release` after a `commit` for the same order writes nothing and changes no
      balance.
- [ ] `commit` leaves `quantity_available` unchanged.
- [ ] When the first candidate's stock disappears between selection and
      reservation, the use case reserves against the second candidate, and no
      row written by the failed attempt survives.
- [ ] With every candidate unable to supply, the use case raises
      `NoFulfilmentPossibleError` naming the unsatisfiable product ids, after at
      most 3 attempts.
- [ ] `npm run concurrency-check` reports exactly N successes and 20 failures for
      N = 5, ends with `quantity_available = 0` and `quantity_reserved = 0`, and
      never N + 1.
- [ ] The same run with `-- 50` reports exactly 50 successes and 20 failures.
- [ ] No `CHECK` constraint violation appears in the PostgreSQL logs during the
      harness run.
- [ ] `sql/verify-ledger.sql` returns zero rows after the harness, and returns
      exactly the tampered row after a manual `UPDATE inventory`.
- [ ] No `UPDATE` or `DELETE` statement against `inventory_movements` exists
      anywhere in `src/`.
- [ ] A file under `src/application/allocation/` importing `axios` fails
      `npm run lint`.
- [ ] No HTTP client is imported by any file reachable from `reserve`,
      `release`, `commit` or `AllocateInventoryUseCase`.
- [ ] `npm run lint`, `npm run build` and `npm run verify` all pass.

## Decisions

**Transaction boundaries and ownership**

- **Yes:** `reserve`, `release` and `commit` all take the caller's
  `EntityManager` and never open a transaction of their own. P4's saga phase 1
  must insert `orders`, reserve stock and insert `order_items` atomically; a
  service that opens its own transaction makes that impossible and leaves
  orphaned orders behind a partial failure.
- **Yes:** P1 writes no `orders` row as production behaviour, and no status
  transition. P4 owns order creation (R4.3) and the state machine P0 built.
  P1 writes only `warehouse_id` and `reservation_expires_at`.
- **Noted for P4:** R4.3 lists its phase 1 as "reserve stock → insert orders".
  The real order is the reverse — `inventory_movements.order_id` has a foreign
  key to `orders`, so the order row must exist first. The sequence inside each
  attempt is: insert `orders` → `reserve` → insert `order_items`. Since a failed
  attempt rolls the whole transaction back, the order id can be generated in the
  application and reused across attempts.
- **Yes:** `AllocateInventoryUseCase` owns the failover loop, one transaction per
  candidate. A rolled-back transaction cannot be retried, so each attempt needs
  its own, and the only component that can open one is the one above `reserve`.
- **No:** the retry loop inside `InventoryService`. It would have to open its own
  transactions, which contradicts the first decision, and would force two
  variants of the same method.
- **Yes:** the `onBeforeReserve(manager, warehouseId)` callback. P1 keeps the
  failover loop — its own requirement, R1.3 — and can prove it end to end with a
  mock order, while P4 drops the real creation into the same hole without
  touching the loop.
- **No:** P1 returning candidates and letting P4 write its own loop. The failover
  is FR-2 rule 4 and belongs to this phase; P1 would have nothing to demonstrate
  against acceptance criterion 4.

**Selection query**

- **Yes:** no domain service for warehouse selection, against the file layout in
  `phases/01-fulfilment-core.md`. All three FR-2 rules are in the SQL:
  eligibility is the `HAVING`, ranking is the `ORDER BY`, the tie-break is its
  second key. A domain service would re-check in memory what PostgreSQL just
  guaranteed. This applies SPEC 01's own test — can the rule be guaranteed in
  memory, or does it need the database? — which is what cut P0 from eleven
  domain classes to two.
- **No:** a pure `rankCandidates()` with a database-free unit test. If it
  reorders, there are two sources of truth for one rule; if it only checks, it
  is a test wearing production clothes. Worse, its existence invites letting the
  SQL return anything and fixing it in TypeScript — exactly what acceptance
  criterion 3 forbids.
- **Yes:** order lines travel as two parallel arrays unpacked with
  `unnest($2::uuid[], $3::int[])`. The statement text is identical for every
  order size, so the plan is reusable and the captured `EXPLAIN` means something.
- **No:** `jsonb_to_recordset`. Same guarantees, plus serialisation, to carry two
  scalar columns.
- **No:** placeholders built at runtime (`VALUES ($2,$3), ($4,$5), ...`). It is
  still parameterised and safe, but it produces a different statement per order
  size, so the captured plan only covers the size that was tested — and R1.1
  asks for a hand-written statement, not one assembled by code.
- **Yes:** `ORDER BY location <-> $1` for the ranking, `ST_Distance` only for the
  payload. The `<->` operator is what the GiST index answers; ordering by
  `ST_Distance` forces a sort node over the full result.

**Locking and concurrency**

- **Yes:** plain `FOR UPDATE`, blocking. Correcting the comment in
  `src/infrastructure/database/entities/inventory.orm-entity.ts`, which mentions
  `SKIP LOCKED`. Under `SKIP LOCKED` a row locked by a concurrent order vanishes
  from the result set and the attempt reads it as "no stock" — with 5 units and
  25 attempts the harness would report 1 or 2 successes instead of 5, breaking
  acceptance criterion 4 from below. `SKIP LOCKED` is right for the P6 reaper,
  where scanning expired orders genuinely is queue work.
- **No:** `FOR UPDATE NOWAIT`. It fails instantly on contention, which under the
  harness is the normal case, not an error.
- **Yes:** `ORDER BY product_id` on the locking `SELECT`, never relying on the
  order the caller passed its lines in. Otherwise a client sending its lines
  reversed could deadlock two orders against each other.
- **Yes:** `lock_timeout = '3s'` inside the reservation transaction, raising
  `InsufficientStockError` so the use case fails over to the next candidate. An
  unbounded wait turns one stuck transaction into an exhausted connection pool —
  the same failure mode we avoid by keeping payment outside the transaction,
  entering through a different door.
- **Yes:** the timeout is a named constant in the repository, not an environment
  variable. Adding one means touching P0's `env.schema.ts` and `.env.example`
  for a value nobody will tune per deployment.

**Ledger and idempotency**

- **Yes:** `release` and `commit` guard on the **latest** movement row for
  `(order_id, product_id)`, read inside the transaction with the rows already
  locked. If it is already `RELEASE` or `COMMIT`, the operation is a no-op.
  Checking only for "any `RELEASE` exists" would miss the release-after-commit
  case.
- **No:** guarding on `orders.status`. It is what FR-5 describes, but the
  statuses are governed by P4; P1 would depend on semantics it does not own, and
  a future intermediate status would break it silently.
- **Why this matters at all:** `release` is not rollback. A failure inside the
  reservation transaction is undone by PostgreSQL and needs no compensation.
  `release` exists to undo a transaction that already committed, which means it
  always runs later and from a different caller — the settle path and the P6
  reaper both call it, without knowing about each other. A duplicate release
  credits stock that does not exist, stays positive, passes every `CHECK`, and
  surfaces weeks later as missing goods in the warehouse.
- **Yes:** `commit` leaves `quantity_available` untouched. The units left
  availability when they were reserved; confirming the sale only ends the
  reservation. Subtracting again is the classic silent bug here.
- **Yes:** `order_id` is always populated on movements written by P1. A ledger
  row that cannot name the order that caused it answers none of the questions
  the ledger exists for.

**Verification**

- **Yes:** the `EXPLAIN` check is an automated test, not a one-off capture. A
  plan pasted into a README rots the first time someone edits the query.
- **Yes:** that test inserts several hundred synthetic warehouses and runs
  `ANALYZE` before measuring. With the 5 seeded warehouses PostgreSQL may
  correctly prefer a sequential scan, which would fail the test without anything
  being wrong. The whole test runs inside a transaction and rolls back —
  `ANALYZE`'s statistics roll back with it, so no residue is left for other
  tests.
- **No:** accepting either plan and only failing on an explicit `Sort` node.
  Stable, but it stops proving the thing the phase is graded on.
- **Captured (step 4):** the planner refuses `Index Scan using
  idx_warehouses_location_gist` once the `inventory`/`products` join sits in
  the same query as the `ORDER BY`. Reproduced with 500 synthetic warehouses,
  fresh `ANALYZE` statistics, and roughly a third of them stocked with the
  requested product (the partial-selectivity shape a real catalogue has) — and
  again with every warehouse stocked, so it is not a selectivity artefact
  either way. The documented fallback (Risks table) is applied in
  `select-warehouse.sql`: an `eligible` CTE resolves C-6's `HAVING` first
  (which warehouse ids can supply every line), then only that small set is
  joined back to `warehouses` — by primary key, never a sequential scan — and
  sorted by distance. Condensed captured plan (full JSON logged by
  `warehouse-selection.explain.integration.spec.ts`):

  ```
  Limit
    InitPlan (CTE requested): Function Scan
    Result
      Sort  Sort Key: (w.location <-> '...'::geography), w.id
        Nested Loop
          Aggregate  Group Key: i.warehouse_id  Filter: (count(*) = $1)
            InitPlan 2 (returns $1): Aggregate over CTE Scan requested
            Sort  Sort Key: i.warehouse_id
              Nested Loop  Join Filter: (i.quantity_available >= r.quantity) AND (i.product_id = r.product_id)
                Hash Join  Hash Cond: (p.id = r.product_id)
                  Seq Scan on products p  Filter: is_active
                  Hash -> CTE Scan requested r
                Index Scan using idx_inventory_availability on inventory i
                  Index Cond: (product_id = p.id)
          Index Scan using warehouses_pkey on warehouses w
            Index Cond: (id = i.warehouse_id)  Filter: is_active
  ```

  No node anywhere touches `idx_warehouses_location_gist`, and `warehouses` is
  reached exactly once, by primary key, for the handful of ids the `eligible`
  CTE resolved — never a sequential or index scan over the full table. Sorting
  that small set costs essentially nothing next to probing a spatial index in
  distance order against a table where most rows fail the join; the planner's
  choice is the cheaper one, not a missing index or a planner defect. The
  integration test asserts exactly this shape (no `Seq Scan` on `warehouses`,
  `warehouses` reached only via `warehouses_pkey`) and accepts a GiST-driven
  plan as the alternative pass condition, in case a future dataset shape ever
  favours it.
- **Yes:** the concurrency harness fires from one process with `Promise.all` and
  its own `DataSource` with `poolSize` 30. TypeORM's default pool of 10 would
  queue 15 of the 25 attempts in the pool rather than on the row lock, and the
  test would prove nothing. The pool size is set explicitly and commented for
  that reason.
- **No:** one child process per attempt. Real OS-level concurrency, but the
  process startup costs more than the test and the results need inter-process
  plumbing.
- **Yes:** `N` is an argument and the script sets the stock itself before each
  run. It makes the harness repeatable — a fixed version finds the stock at zero
  on its second run — and lets the pressure go up when it is worth it.
- **Yes:** `sql/verify-ledger.sql` as a standalone file, used by the integration
  tests, the harness and the README. The reviewer can paste it into `psql`
  without running Jest.
- **Yes:** the ESLint rule forbidding HTTP clients in the allocation and
  repository paths ships in P1, although P1 imports none. The barrier goes up
  before the temptation arrives in P4, and P0 set the precedent of defending an
  architectural boundary with `no-restricted-imports` rather than discipline.
- **Yes:** P1's integration tests and the default-size harness join
  `npm run verify`, keeping one command as the proof of everything built so far.

**Cross-phase notes**

- **Noted:** `phases/06-hardening-demo.md` R6.1 sends a reaped order to
  `CANCELLED`, while FR-5 and P4 send a declined payment to `PAYMENT_FAILED`.
  Not a contradiction — "the provider said no" and "this expired unresolved" are
  different events — but they are easy to conflate when implementing. P1 writes
  neither status.
- **Yes:** the fixed customer is added to P0's `seed.ts`. The seed is not part of
  SPEC 01's frozen contracts — those are the domain, the ports, the persistence
  entities and the schema — so extending it is legitimate. Recorded here so the
  cross-phase edit is deliberate rather than an accident of scope.

## Risks

| Risk | Mitigation |
| --- | --- |
| The planner refuses the GiST index scan once the `inventory` join is present, and orders with a `Sort` node instead. | Step 4 hits it before the reservation is built on top. The fallback is already written: select candidates by availability first, order that smaller set by distance. Either way the plan and the reason are recorded. |
| The harness reports N successes while actually running sequentially, proving nothing. | The script owns its `DataSource` with `poolSize` 30 and a shared start signal, so the attempts contend on the row lock rather than on the pool. Running it at `-- 50` widens the window; a serialised run would still pass at N=5 but the concurrency it claims to prove would be absent. |
| A duplicate `release` credits stock that does not exist. Balances stay positive, every `CHECK` passes, and the error surfaces weeks later as missing goods. | The guard on the latest movement row, read under the same lock. Acceptance criteria cover release-twice, commit-twice and release-after-commit explicitly, because none of them can be caught by watching the balances. |
| `commit` also subtracts from `quantity_available`, double-counting the sale. | Stated in the data model table, restated in the decisions, and asserted as its own acceptance criterion. It is the single easiest mistake to make in this phase and it is silent. |
| P4 inserts `orders` after reserving, following R4.3's literal wording, and hits the foreign key from `inventory_movements`. | Written down as a cross-phase note in the decisions, with the corrected sequence and the reason. |
| `ST_MakePoint` takes longitude first. A swapped pair routes orders to the wrong continent without raising an error. | The nearest-warehouse test checks a hand-computed distance against known city coordinates, not just that some warehouse came back. P0's seed already carries the same guard. |
| `reserve` grows a network call in a later phase, reintroducing the locked-rows-across-the-wire failure. | The ESLint rule blocks HTTP client imports on those paths from this phase onward, before P4 brings a payment gateway into the codebase. |
| The reservation TTL is written by P1 but nothing consumes it until P6, so a wrong value goes unnoticed for three phases. | An acceptance criterion asserts `reservation_expires_at` lands 15 minutes out, verified against `RESERVATION_TTL_MINUTES` rather than a hardcoded 15. |

## What is **not** in this spec

- `POST /orders`, DTOs, idempotency keys, the error contract and the saga that
  strings the three phases together. P4.
- Creating orders and order items as production behaviour, and every order status
  transition. P4.
- Geocoding. Coordinates arrive as a `Coordinates` value object. P2.
- Payment, and with it the decision of when `release` or `commit` actually runs.
  P2 and P4.
- The reservation reaper and payment reconciliation. They consume `release` and
  `commit`; nothing here schedules them. P6.
- Queues, jobs, events and observability. P3.
- The concurrency proof through the full HTTP stack. P1 builds the harness, P6
  extends it.
- `RESTOCK` and `ADJUST` movements. The enum values exist and stay unused.

Nothing above gets slipped in "while we're here". Each one has its own phase file
and gets its own spec.
