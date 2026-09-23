# Database

Postgres + PostGIS through TypeORM. The schema is hand-written SQL
migrations; only `Order`/`OrderItem` map to domain classes; everything else
is used through its ORM entity or raw SQL.

Main sources: [spec 01, Data model and Decisions › “Migrations and schema”, “Layering and contracts”, “Runtime and operations”](../specs/01-foundation.md#decisions),
[data-model.dbml](../engineering:documentation/data-model.dbml) (table
notes), and [references/coding-conventions.md](../references/coding-conventions.md)
(raw SQL for concurrency-critical statements).

## Data source

Code:
- `src/infrastructure/database/data-source.ts` → `config`, `AppDataSource`
- `src/infrastructure/database/persistence-entities.ts` → `PERSISTENCE_ENTITIES`

`data-source.ts` is the TypeORM CLI entrypoint: `npm run migration:run`,
`migration:generate` and `migration:revert` all point at it
(`typeorm-ts-node-commonjs -d <file>`). It runs outside Nest's DI container,
so it validates `process.env` directly with the same Zod schema the app
uses at boot, rather than a second, looser check
([architecture.md#configuration](architecture.md#configuration)). Scripts
and integration tests also import `AppDataSource`.

`PERSISTENCE_ENTITIES` is the one entity list, shared by `data-source.ts`
and `shared.module.ts` (the app's `TypeOrmModule`). It deliberately has no
dependency on `env.schema.ts` or anything with an import-time side effect,
so `shared.module.ts` can import it without triggering
`data-source.ts`'s `validateEnv(process.env)`. Paths are resolved from its
own `__dirname`, so it is correct whichever file imports it.

## Migrations

Code:
- `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` → `InitialSchema1789596059697`, `InitialSchema1789596059697.up`, `InitialSchema1789596059697.down`
- `src/infrastructure/database/migrations/1790028652771-OrderNumberSequence.ts` → `OrderNumberSequence1790028652771`
- `src/infrastructure/database/data-source.ts` → `AppDataSource` (`synchronize`)
- `src/modules/shared.module.ts` → `SharedModule.register` (`migrationsRun: false`)

- **`synchronize: false` in every environment.** Migrations are the only
  way the schema changes.
- **Migrations run from one place only**: the one-shot `migrate` compose
  service (or `npm run migration:run` locally), never from the app itself
  (`migrationsRun: false`).
- **The initial schema is hand-written SQL**, not generated: PostGIS
  `geography` columns, generated columns, the GiST index and the partial
  unique index are not reliably produced by `migration:generate`. It holds
  the full schema from the data model (the extension, six enums, the three
  reference tables `customers` / `products` / `warehouses`, the other seven
  tables, every `CHECK` and index).
- **PostGIS first**: every `geography` column depends on the extension.
- **Warehouses** are fixed reference data, seeded once. Only the shipping
  address is geocoded at request time, never a warehouse.
  `latitude`/`longitude` are generated columns derived from `location`, so
  they are readable in a plain `SELECT` and can never drift out of sync
  ([Geography columns](#geography-columns)).
- **Inventory**: rows are locked with `SELECT … FOR UPDATE ORDER BY
  product_id` during reservation. `CHECK (quantity_available >= 0)` and
  `CHECK (quantity_reserved >= 0)` are the backstop: application logic is
  never trusted alone to prevent overselling
  ([allocation.md#locking](allocation.md#locking)).
- **Shipments**: created asynchronously by the worker on `order.confirmed`;
  `UNIQUE(order_id)` makes that handler idempotent
  ([messaging-jobs.md#shipment-create](messaging-jobs.md#shipment-create)).
- **Idempotency keys**: the row is inserted **before any work begins**, so
  the unique `(scope, idempotency_key)` constraint is what serialises
  duplicate requests ([orders-saga.md#idempotency](orders-saga.md#idempotency)).
- **`down`** drops in reverse order: tables holding foreign keys go before
  the tables and enums they reference. It does **not** drop the `postgis`
  extension: that is shared, cluster-wide infrastructure other objects may
  depend on by the time `down` ever runs for real.
- **`OrderNumberSequence`** creates `order_number_seq`, one global counter
  with no per-year reset (reset logic would be fragile). The
  `CNL-<year>-<6 digits>` format is assembled in `generateOrderNumber()`,
  not stored in the sequence ([orders-saga.md#order-number](orders-saga.md#order-number)).

Automated checks of these constraints: [Verify schema](#verify-schema).

Source: [spec 01, Decisions › “Migrations and schema”](../specs/01-foundation.md#decisions);
[spec 05, Data model (“Nueva migración — secuencia de order_number”)](../specs/05-order-creation-saga.md#data-model).

## Entities

Code:
- `src/infrastructure/database/entities/customer.orm-entity.ts` → `CustomerOrmEntity`
- `src/infrastructure/database/entities/idempotency-key.orm-entity.ts` → `IdempotencyKeyOrmEntity`, `IdempotencyState`
- `src/infrastructure/database/entities/inventory.orm-entity.ts` → `InventoryOrmEntity`
- `src/infrastructure/database/entities/inventory-movement.orm-entity.ts` → `InventoryMovementOrmEntity`, `InventoryMovementOrmEntity.id`, `InventoryMovementType`
- `src/infrastructure/database/entities/order.orm-entity.ts` → `OrderOrmEntity`, `ORDER_STATUS_VALUES`
- `src/infrastructure/database/entities/order-item.orm-entity.ts` → `OrderItemOrmEntity`
- `src/infrastructure/database/entities/payment.orm-entity.ts` → `PaymentOrmEntity`, `PAYMENT_STATUS_VALUES`
- `src/infrastructure/database/entities/product.orm-entity.ts` → `ProductOrmEntity`, `PRODUCT_CONDITION_VALUES`
- `src/infrastructure/database/entities/shipment.orm-entity.ts` → `ShipmentOrmEntity`, `SHIPMENT_STATUS_VALUES`
- `src/infrastructure/database/entities/warehouse.orm-entity.ts` → `WarehouseOrmEntity`

Each entity mirrors its table column for column. Only `orders` and
`order_items` have domain classes (converted by the [mapper](#mapper)).
Every other table has no domain mirror because its rules live in the
database or in one small repository, not in in-memory invariants:

| Entity | Why no domain class |
|---|---|
| `CustomerOrmEntity` | Pre-existing reference data: read, never mutated. |
| `ProductOrmEntity` | Only read inside other queries; no invariant of its own. |
| `WarehouseOrmEntity` | The selection query's table; see [Geography columns](#geography-columns). |
| `InventoryOrmEntity` | Correctness is the row lock plus `CHECK`s ([allocation.md#locking](allocation.md#locking)). |
| `InventoryMovementOrmEntity` | Append-only ledger, never updated or deleted; written by the inventory helpers. |
| `PaymentOrmEntity` | Inserted, then only a status/settlement update. |
| `ShipmentOrmEntity` | Its only rule is `UNIQUE(order_id)`, which makes the worker's handler idempotent. |
| `IdempotencyKeyOrmEntity` | Insert-first / replay-on-duplicate lives in `idempotency.repository.ts`. |

- `OrderOrmEntity` has no business rules; `Order` owns the state machine.
  `shippingLocation` is a `GeoPoint`.
- `OrderItemOrmEntity`: `quantity > 0` is enforced by a `CHECK` in the
  migration and, independently, by `OrderItem`'s constructor.
- `*_STATUS_VALUES` / `PRODUCT_CONDITION_VALUES` are runtime arrays mirroring
  the Postgres enums, because TypeORM's `enum` column option needs an actual
  array, not just a type. `ORDER_STATUS_VALUES` is also used by
  `ListOrdersQueryDto` to validate the `status` filter.
- `IdempotencyState` and `InventoryMovementType` mirror Postgres enums that
  exist only for infrastructure; they are not domain enums.
- `InventoryMovementOrmEntity.id` is `bigint GENERATED ALWAYS AS IDENTITY`.
  TypeORM returns `bigint` as a string, and it stays a string: unlike money,
  this id has no reason to stay in safe-integer range, so no
  `bigintNumberTransformer` ([Bigint money](#bigint-money)).

Source: [spec 01, “Persistence entities, frozen” and Decisions › “Layering and contracts”](../specs/01-foundation.md#persistence-entities-frozen).

## Geography columns

Code:
- `src/infrastructure/database/interfaces/geo-point.ts` → `GeoPoint`
- `src/infrastructure/database/entities/warehouse.orm-entity.ts` → `WarehouseOrmEntity`

Once `spatialFeatureType` / `srid` are declared on the `@Column()`,
TypeORM's Postgres driver returns (and accepts on `repository.save()`) a
`geography(Point, 4326)` column as a **plain GeoJSON Point**, not raw EWKB
hex. This was verified against a live migrated database: a warehouse
inserted with `coordinates: [lng, lat]` read back identical, both through
`find()` and through the generated `latitude` / `longitude` columns.

**Coordinate order is `[longitude, latitude]`** (GeoJSON's x, y), the
reverse of how coordinates are usually spoken. It is the same ordering risk
that `Coordinates.of()`'s named object guards against in the domain
([domain.md#coordinates](domain.md#coordinates)); there is no equivalent
guard here because this shape is GeoJSON's, not ours.

`WarehouseOrmEntity.latitude` / `longitude` are `insert: false,
update: false`: they are `GENERATED ALWAYS … STORED`, and Postgres rejects
writes to them, so TypeORM is told up front instead of finding out from a
rejected query.

## Mapper

Code: `src/infrastructure/database/mappers/order.mapper.ts` → `orderToDomain`, `orderToPersistence`, `orderItemToDomain`, `OrderItemPersistenceFields`

The only mapper, because `Order` / `OrderItem` are the only domain classes
with an ORM entity.

- `shippingLocation` converts to and from `GeoPoint` (verified against a
  live database in both directions, `find()` and `save()`).
- `orderToDomain` trusts the `shipping_address` shape written at order
  creation (validated by the request DTO); this read path does not
  re-validate it.
- `orderToPersistence` does not write `createdAt` / `updatedAt`: no caller
  needed a getter for them, and the database defaults own them on insert.
- `orderItemToDomain`: `order_items` has no currency column; the system is
  USD-only, which is `Money.of`'s default.
- `OrderItemPersistenceFields`: `order_items` has no `updated_at` (rows are
  insert-only); `createdAt` is the database's `DEFAULT now()`.

An integration test round-trips an order through the real database
([testing.md#database-tests](testing.md#database-tests)).

## Bigint money

Code: `src/infrastructure/database/transformers/bigint-number.transformer.ts` → `bigintNumberTransformer`

`pg` returns Postgres `bigint` columns as JS strings by default, because a
real bigint can exceed `Number.MAX_SAFE_INTEGER`. Money columns store cents
for retail orders, far below that limit, so this transformer converts them
to `number` to match the domain's `Money` (built on `number`, see
[domain.md#money](domain.md#money)). It is applied to **money columns
only**; `inventory_movements.id` stays a string.

## Seed

Code: `src/infrastructure/database/seed.ts` → `(module)`, `CUSTOMER`, `PRODUCTS`, `INVENTORY`

`npm run seed` (manual / local only; CI does not run it, and integration
tests never depend on it, see [references/testing.md](../references/testing.md)).

- **Hardcoded UUIDs + `ON CONFLICT DO NOTHING`**: idempotent (running it
  twice never duplicates a row), and tests and scripts can reference the
  ids directly without querying for them.
- **Raw SQL**, not `repository.save()` / `upsert()`: TypeORM's `upsert()`
  does `ON CONFLICT DO UPDATE`, not `DO NOTHING`.
- `CUSTOMER`: one fixed customer, so an `orders` row can be inserted
  without inventing one per test. The demo reuses it.
- `PRODUCTS`: prices and storage tiers were checked against current
  listings (September 2026). The code comment refers to "the commit
  message" for sources, which is a weak pointer. The catalogue stays on the
  iPhone 16/17 generation on purpose, per an explicit request; the newest
  generation was left out deliberately, not missed.
- `INVENTORY` maps warehouse index → { product index → quantity available }
  (0-based into `WAREHOUSES` / `PRODUCTS`). It encodes four required
  scenarios:

  | Product | Scenario |
  |---|---|
  | `[13]` AirPods Pro 3 | exactly one warehouse (Newark) has it |
  | `[3]` iPhone 17 | three warehouses spread across the country (Newark, LA, Miami), so "nearest" is unambiguous for any reasonable address |
  | `[9]` MacBook Pro 16" Pro | 2 units everywhere: no single warehouse can fill more than 2, and orders never split across warehouses |
  | `[12]` iPad Pro 11" | exactly 5 units, Newark only: the boundary case the concurrency proof needs |

Source: [spec 01, Decisions › “Runtime and operations”](../specs/01-foundation.md#decisions);
[spec 02, Decisions › “Cross-phase notes”](../specs/02-fulfilment-core.md#decisions).

## Verify schema

Code: `src/infrastructure/database/verify-schema.ts` → `CheckResult`, `checkRejectionsInARolledBackTransaction`

`npm run verify:db` automates the foundation spec's psql-based acceptance
checks, which were first run by hand. It assumes a fully migrated **and
seeded** stack (`docker compose up`, or `migration:run` + `seed`); it does
not bring anything up itself.

Every check that proves a **rejection** (negative inventory, a zero
`order_items.quantity`, a second `CAPTURED` payment for one order via the
partial unique index) runs inside **one transaction that is always rolled
back**, pass or fail. It needs a real seeded warehouse and product to
satisfy foreign keys, plus a throwaway customer and order, and leaves no
trace in real data. Each expected failure is wrapped in a savepoint
([Savepoints](#savepoints)).

Source: [spec 01, Acceptance criteria](../specs/01-foundation.md#acceptance-criteria).

## Savepoints

Code: `src/infrastructure/database/verify-schema.ts` → `checkRejectionsInARolledBackTransaction`

In Postgres, a failed statement aborts the whole transaction: every later
query fails with "current transaction is aborted" until a `ROLLBACK`, even
if it is valid. A `SAVEPOINT` before each statement that is expected to fail
(and `ROLLBACK TO SAVEPOINT` after it) limits the damage to that one
statement, so the transaction can continue with the next check.

The first version of this function had no savepoints, and every check after
the first expected failure reported a false negative. (Also listed in
[investigations.md#postgres-aborted-transaction](investigations.md#postgres-aborted-transaction).)
