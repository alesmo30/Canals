# Allocation: warehouse selection and stock reservation

How an order picks a warehouse and reserves stock without overselling.
Pieces: the selection SQL (`select-warehouse.sql`), `InventoryService`
(reserve / release / commit) and `AllocateInventoryUseCase` (the failover
loop that owns the transactions).

Main source: [spec 02, Decisions](../specs/02-fulfilment-core.md#decisions)
and [README, “The selection query and its captured plan”](../README.md#the-selection-query-and-its-captured-plan).
General ledger rules: [references/data-integrity.md](../references/data-integrity.md).

## Contracts

Code: `src/application/allocation/allocation.types.ts` → `OrderLine`, `ReserveCommand`, `ReleaseCommand`, `OnBeforeReserveParams`

These types are shared by the selection query, `InventoryService` and
`AllocateInventoryUseCase`. `OrderLine.quantity` is a positive integer;
validating that is the request DTO's job
([orders-saga.md#validation](orders-saga.md#validation)), not this layer's.

- `ReserveCommand`: everything `reserve` needs. The caller's transaction
  (`manager`) is **not** a field; it is the method's first argument (see
  [Transaction ownership](#transaction-ownership)).
- `ReleaseCommand`: `ReserveCommand` minus `lines`, plus `productIds`. It
  carries no quantities (see [Ledger](#ledger)). It is written as
  `Omit<…> & {…}`, a `type`, because an `interface extends` can only add
  fields, never drop one.
- `OnBeforeReserveParams`: see [Failover loop](#failover-loop).

Source: [spec 02, TypeScript contracts](../specs/02-fulfilment-core.md#typescript-contracts).

## Selection query

Code:
- `src/infrastructure/database/repositories/warehouse-selection.repository.ts` → `WarehouseSelectionRepository`, `WarehouseSelectionRepository.findCandidates`, `WarehouseCandidate`, `SELECT_WAREHOUSE_SQL`
- `src/infrastructure/database/sql/select-warehouse.sql`

The whole warehouse-selection rule lives in one SQL statement: return the
**top 3** active warehouses that can supply **every** requested line in
full (orders never split across warehouses), ordered by PostGIS geodesic
distance to the shipping point. There is deliberately no domain service for
this; a second in-memory check would be a divergent source of truth
([references/layering.md](../references/layering.md)).

- `WarehouseSelectionRepository` only loads the file, binds the three
  parameters and maps rows. It never re-ranks or re-filters what the SQL
  decided.
- `WarehouseCandidate` is one row per candidate, exactly as the SQL returns
  it.
- `SELECT_WAREHOUSE_SQL` is read once at module load. The statement text
  never changes with order size, so there is nothing to rebuild per call.
- `findCandidates` builds the shipping point as WKT. Both `ST_MakePoint` and
  geography text input take **(longitude, latitude)**; see
  [domain.md#coordinates](domain.md#coordinates) for the reversed-pair
  guard. `geography`'s default SRID is 4326, so plain WKT needs no explicit
  SRID.

Source: [spec 02, “The selection statement” and Decisions › “Selection query”](../specs/02-fulfilment-core.md#the-selection-statement).

## Selection query plan

Code:
- `src/infrastructure/database/repositories/warehouse-selection.explain.integration.spec.ts`

The plan was checked by capturing what the planner actually does, not by
assuming it. With the `inventory` / `products` join present, the planner
does **not** drive the `ORDER BY` off `idx_warehouses_location_gist` (tested
with 500 synthetic warehouses and fresh `ANALYZE`, at partial and full
selectivity). It uses the documented fallback instead:

1. the `eligible` CTE resolves which warehouse ids can supply every line
   (the `HAVING count(*) = <lines>` step);
2. only that small set is joined back to `warehouses`, **by primary key**;
3. that small set is sorted directly by distance.

It is never a sequential scan over all warehouses. The test asserts "either
a GiST index scan or this fallback shape".

The test runs inside its own transaction: the synthetic warehouses and the
`ANALYZE` both roll back, so nothing is left behind for other suites.
It uses roughly one third of warehouses as able to supply the product, a
realistic partial selectivity ([testing.md#explain-tests](testing.md#explain-tests)).

The full captured plan is in the README section and in the spec.

Source: [spec 02, Decisions › “Verification” (captured plan) and Risks](../specs/02-fulfilment-core.md#decisions);
[README, “The selection query and its captured plan”](../README.md#the-selection-query-and-its-captured-plan).

## Failover loop

Code:
- `src/application/allocation/allocate-inventory.use-case.ts` → `AllocateInventoryUseCase`, `AllocateInventoryUseCase.execute`
- `src/application/allocation/allocation.types.ts` → `OnBeforeReserveParams`

`AllocateInventoryUseCase` runs the selection query **once**, then tries
each candidate in **its own transaction**, nearest first:

- A rolled-back transaction cannot be retried, so each attempt needs a new
  one. The use case is the only component above `reserve` that can open
  one, which is why the retry lives here and never inside
  `InventoryService`.
- The SQL's `LIMIT 3` is what bounds the loop to "up to 3 attempts"; there
  is no other cap.
- `orderId` is generated once, before the first attempt, and reused on every
  retry. A failed attempt rolls its whole transaction back, so nothing
  conflicts, and the id stays stable for whoever tracks it outside the loop
  (the saga's idempotency key). The saga's `order_number` follows the same
  rule ([orders-saga.md#order-number](orders-saga.md#order-number)).
- `onBeforeReserve(params)` runs inside each attempt's transaction, before
  `reserve`. The order-creation saga inserts the `orders` and `order_items`
  rows there, so the order and its reservation commit or roll back
  together ([orders-saga.md#saga-phases](orders-saga.md#saga-phases)).
- If `reserve` throws `InsufficientStockError`, the loop moves to the next
  candidate. When there are none left it throws
  `NoFulfilmentPossibleError` ([Errors](#errors)).

Source: [spec 02, Scope and Decisions › “Transaction boundaries and ownership”](../specs/02-fulfilment-core.md#decisions).

## Transaction ownership

Code:
- `src/application/allocation/inventory.service.ts` → `InventoryService`
- `src/application/allocation/allocation.types.ts` → `ReserveCommand`

`reserve`, `release` and `commit` all take the caller's `EntityManager` as
their first argument and **never open a transaction of their own**. The
caller owns the boundary: `AllocateInventoryUseCase` for reservations,
`OrderSettlementService` for release/commit at settle time
([orders-saga.md#settlement](orders-saga.md#settlement)).

Source: [spec 02, Decisions › “Transaction boundaries and ownership”](../specs/02-fulfilment-core.md#decisions).

## Locking

Code:
- `src/application/allocation/helpers/inventory.helpers.ts` → `LOCK_TIMEOUT`, `lockInventoryRows`, `isLockTimeout`
- `src/application/allocation/inventory.service.ts` → `InventoryService.reserve`
- `src/infrastructure/database/entities/inventory.orm-entity.ts` → `InventoryOrmEntity`

`lockInventoryRows` is the locking discipline shared by reserve, release and
commit:

1. `SET LOCAL lock_timeout = '3s'` (`LOCK_TIMEOUT`);
2. `SELECT … FROM inventory … FOR UPDATE ORDER BY product_id`.

Rows are always locked in `product_id` order, not in the order the caller's
lines arrived. Otherwise two orders touching the same products in reverse
order could deadlock each other.

- The lock is plain, **blocking** `FOR UPDATE`, never `SKIP LOCKED`. A row
  locked by a concurrent reservation is contention to wait out, not stock
  to report as missing.
- `reserve` **re-checks availability under the lock**. The candidate came
  from a selection query run before this transaction opened, so stock may
  have moved; the failover loop exists exactly for this race.
- If `lock_timeout` fires, `isLockTimeout` recognises Postgres error `55P03`
  (`lock_not_available`) and `reserve` turns it into
  `InsufficientStockError`, so the loop moves on.
- `LOCK_TIMEOUT` is a named constant, not an env var: nobody tunes it per
  deployment ([references/coding-conventions.md](../references/coding-conventions.md)).
- `InventoryOrmEntity` has no domain mirror. An in-memory `reserve()` would
  misrepresent where the real guarantee lives: the row lock plus the
  `quantity_available >= 0` and `quantity_reserved >= 0` `CHECK` constraints
  created in the migration. Those constraints are the backstop; application
  logic is never trusted alone to prevent overselling
  ([database.md#migrations](database.md#migrations)).

Proof under real concurrency: [scripts.md#concurrency-check](scripts.md#concurrency-check).

Source: [spec 02, Decisions › “Locking and concurrency”](../specs/02-fulfilment-core.md#decisions).

## Ledger

Code:
- `src/application/allocation/helpers/inventory.helpers.ts` → `insertMovement`, `updateInventoryBalances`
- `src/application/allocation/inventory.service.ts` → `InventoryService.reserve`, `InventoryService.release`, `InventoryService.commit`
- `src/application/allocation/allocation.types.ts` → `ReleaseCommand`

Every stock change writes the new balances to `inventory`
(`updateInventoryBalances`) **and** appends one row to `inventory_movements`
(`insertMovement`). That table is an append-only ledger: `INSERT` only, never
`UPDATE` or `DELETE`.

- Every movement carries `order_id`. A movement that cannot name its order
  answers none of the questions the ledger exists for.
- **reserve**: `quantity_available` down, `quantity_reserved` up, movement
  `RESERVE`. It also stamps the order's `warehouse_id` and
  `reservation_expires_at` ([Reservation TTL](#reservation-ttl)).
- **release**: returns each line's reserved stock (`available` up,
  `reserved` down) by the amount that line's `RESERVE` movement moved.
- **commit**: ends the reservation (`reserved` down) **without touching
  `quantity_available`**. The units already left the available pool when
  they were reserved; confirming the sale only ends the reservation.
- **No quantities in `ReleaseCommand`**: release and commit read the amount
  from the latest `RESERVE` movement's `quantity_delta` for each
  `(order_id, product_id)`. The ledger, not the caller, is the source of
  truth for "how much"; the caller only says "which".
- **Idempotent**: release and commit do nothing for a line whose *latest*
  movement is already `RELEASE` or `COMMIT`. Checking only "does any RELEASE
  exist" would miss the release-after-commit case. The latest movement is
  read after the row lock is taken.

Source: [spec 02, “Semantics imposed on inventory and inventory_movements” and Decisions › “Ledger and idempotency”](../specs/02-fulfilment-core.md#semantics-imposed-on-inventory-and-inventory_movements).

## Reservation TTL

Code: `src/application/allocation/inventory.service.ts` → `RESERVATION_TTL_MINUTES`

A reservation lasts 15 minutes. `reserve` writes
`orders.reservation_expires_at = now() + RESERVATION_TTL_MINUTES`. The
reservation reaper then selects orders whose stored
`reservation_expires_at` has passed
([messaging-jobs.md#reservation-reaper](messaging-jobs.md#reservation-reaper)),
so the 15 is defined in exactly one place; do not hardcode it anywhere
else.

It is a named constant, not an env var (nobody tunes it per deployment).
Note: `env.schema.ts` also declares a `RESERVATION_TTL_MINUTES` env var
(default 15, present in `.env.example`), but no code reads it; the constant
is what applies.

Source: [spec 02, Decisions › “Locking and concurrency”](../specs/02-fulfilment-core.md#decisions).

## Errors

Code: `src/application/allocation/errors.ts` → `InsufficientStockError`, `NoFulfilmentPossibleError`, `NoFulfilmentPossibleReason`

- `InsufficientStockError`: thrown by `reserve` when availability fails
  under the lock, or when `lock_timeout` fires. `AllocateInventoryUseCase`
  catches it and tries the next candidate.
- `NoFulfilmentPossibleError`: thrown by `AllocateInventoryUseCase` when no
  candidate qualifies or every attempt fails. It carries the unsatisfiable
  product ids and a `reason`:
  - `NO_CANDIDATES`: the selection query returned zero rows; no warehouse
    ever qualified. HTTP **422**.
  - `RESERVATION_RACE_LOST`: one or more candidates qualified at selection
    time, but each lost the stock to a concurrent order before this order
    could lock it. HTTP **409**.

The allocation spec first mapped both to one 422; the order-creation spec
restored the 422 / 409 split by adding `reason`, so a single error class can
map to two statuses
([orders-saga.md#error-contract](orders-saga.md#error-contract)).

Source: [spec 05, “Extensión de NoFulfilmentPossibleError” and Decisions](../specs/05-order-creation-saga.md#decisions) (written in Spanish).
