# SPEC 01 — P0 Foundation: scaffold, frozen contracts and seeded schema

> **Status:** Approved
> **Depends on:** —
> **Date:** 2026-09-16
> **Objective:** Stand up a NestJS repository that builds, boots two entrypoints, migrates a PostGIS schema and seeds it, freezing the domain entities, port interfaces and database schema that every later phase compiles against.

## Scope

**In:**

- NestJS repository at the repo root: TypeScript strict, Node 22, ESLint + Prettier, path aliases.
- Layered directory structure (`domain`, `application`, `infrastructure`, `modules`) with two entrypoints, `main.ts` and `main.worker.ts`.
- An ESLint `no-restricted-imports` rule that fails the lint when `src/domain/**` imports `@nestjs/*`, `typeorm`, or anything under `src/infrastructure`.
- Environment configuration validated at boot with Zod, exporting an `AppConfig` type. The app refuses to start on invalid config.
- A global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` installed in `main.ts`, with no DTOs to validate yet.
- One hand-written TypeORM migration creating the full schema from `data-model.dbml`: PostGIS extension, 10 tables, enum types, geography columns, GiST index, CHECK constraints, partial unique indexes and generated `latitude` / `longitude` columns.
- **FROZEN:** domain entities, value objects and the order state machine in `src/domain/**`.
- **FROZEN:** the `GeocodingProvider`, `PaymentGateway` and `EventPublisher` port interfaces, their injection tokens and their command/result types.
- **FROZEN:** TypeORM persistence entities in `src/infrastructure/database/entities/**`, mirroring the migration.
- `SharedModule` wiring config, TypeORM and every port token, with a no-op stub bound to `EventPublisher`.
- `/health` on the api via `@nestjs/terminus`, including a PostgreSQL connectivity check.
- Multi-stage `Dockerfile` with no `CMD`, and a `docker-compose.yml` with `postgres`, a one-shot `migrate` service, a one-shot `seed` service, `api` and `worker`.
- An idempotent seed script using hardcoded UUIDs, producing the four inventory scenarios later phases need.
- Jest configured, plus a `verify` script running lint, build and the acceptance checks against a running compose stack.

**Out of scope (for future specs):**

- Warehouse selection and the reservation mechanics — P1.
- Real `PaymentGateway` and `GeocodingProvider` adapters, and the `payments-mock` compose service — P2.
- pg-boss wiring, job handlers, the worker's real health signal and the `lgtm` observability service — P3.
- Every HTTP endpoint beyond `/health`, all request DTOs, idempotency handling and the error contract — P4.
- `GET /orders` and the read side — P5.
- Application-side UUID v7 generation. The schema keeps `gen_random_uuid()`.
- Testcontainers. Integration tests target the compose stack on `localhost:5432`.

## Data model

The full schema is specified in `engineering:documentation/data-model.dbml`. This
spec does not restate it. It records the parts that are non-negotiable because
later phases depend on them, and the shape of the code artifacts that mirror it.

### Enum types

Created as PostgreSQL enum types, not `varchar` with a CHECK:

`order_status`, `payment_status`, `shipment_status`, `product_condition`,
`inventory_movement_type`, `idempotency_state`.

### Tables

`customers`, `products`, `warehouses`, `inventory`, `orders`, `order_items`,
`payments`, `shipments`, `inventory_movements`, `idempotency_keys`.

### Non-negotiable schema details

- `CREATE EXTENSION IF NOT EXISTS postgis;` runs first in the migration.
- `warehouses.location` and `orders.shipping_location` are `geography(Point,4326)`.
- GiST index `idx_warehouses_location_gist` on `warehouses.location`.
- `warehouses.latitude` / `longitude` are `numeric(9,6)`, `GENERATED ALWAYS AS
  ST_Y(location::geometry)` / `ST_X(location::geometry)` `STORED`.
- `inventory` has composite primary key `(warehouse_id, product_id)`, plus
  `CHECK (quantity_available >= 0)` and `CHECK (quantity_reserved >= 0)`.
- `order_items` has `CHECK (quantity > 0)`.
- Partial unique index allowing at most one `CAPTURED` payment per order.
- `UNIQUE (order_id)` on `shipments`.
- Indexes `idx_orders_keyset` and `idx_orders_reaper` are present.
- Money columns are `bigint` cents. Timestamps are `timestamptz`.
- Primary keys default to `gen_random_uuid()`.

### Domain layer, frozen

`src/domain/**`, plain TypeScript with no `@nestjs/*` and no `typeorm` imports.

**Build a layer only where there is something to put in it.** A domain class
for a table with no invariants is ceremony; if a rule's correctness depends
on the database (row locking, `SELECT ... FOR UPDATE SKIP LOCKED`), it
belongs in a repository with explicit SQL, not an in-memory guard pretending
to be one. Revised from this spec's original 11-entity list down to two, for
exactly that reason.

Two domain classes, not ten:

- **`Order` (+ `OrderItem`)** — a rich domain class, separate from its
  TypeORM entity, with a mapper between them. `status` is exposed as a
  getter only; transitions happen through named methods (`markPaid()`,
  `markPaymentFailed()`, `confirm()`, `cancel()`). `order.status =
  'CONFIRMED'` must not compile.
- Everything else — `Payment`, `Shipment`, `Inventory`, `Product`,
  `Warehouse`, `Customer`, `inventory_movements`, `idempotency_keys` —
  stays a plain TypeORM entity, with no domain mirror and no mapper.
  `Inventory` specifically: its correctness depends on `SELECT ... FOR
  UPDATE SKIP LOCKED`, so an in-memory `reserve()` would be a lie about
  where the real guarantee lives.

Value objects: `Money`, `Coordinates`, `ShippingAddress`.

- `Money` is integer cents plus a currency code — no floating-point money
  anywhere, and no method may return a decimal `number`. Mixing currencies
  must not compile.
- `Coordinates` takes a single named `{ latitude, longitude }` object, not
  positional arguments, so a `ST_MakePoint(lng, lat)`-style ordering bug
  cannot be introduced by an accidental argument swap.

The order state machine is explicit code: a transition table plus the named
`Order` methods above, which reject illegal transitions.

### Port interfaces, frozen

`src/domain/ports/**`. P2 implements the first two, P3 implements the third,
P4 consumes all three.

```ts
export interface GeocodingProvider {
  geocode(address: ShippingAddress): Promise<Coordinates>;
}

export interface PaymentGateway {
  charge(command: ChargeCommand): Promise<ChargeResult>;
  getStatus(idempotencyKey: string): Promise<ChargeResult>;
}

export interface EventPublisher {
  publish(event: DomainEvent, tx?: TransactionContext): Promise<void>;
}
```

Shipped alongside them: the injection tokens, and the `ChargeCommand`,
`ChargeResult`, `DomainEvent` and `TransactionContext` types.

### Persistence entities, frozen

`src/infrastructure/database/entities/**`, one `@Entity()` class per table,
mirroring the migration column for column, for all 10 tables regardless of
whether a domain class exists for it. These classes carry no business rules.
A mapper converts between a persistence entity and its domain class only
where one exists — today that is `Order`/`OrderItem` alone (see Domain
layer, frozen); everything else is read and written as the plain entity.

### Configuration schema

A Zod schema validated at boot, exporting the `AppConfig` type. Variables:
`DATABASE_URL`, `PORT`, `PAYMENTS_URL`, `GEOCODING_DRIVER`, `GEOAPIFY_API_KEY`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `PGBOSS_POLL_INTERVAL_SECONDS`,
`RESERVATION_TTL_MINUTES`. Every one documented in `.env.example` with a safe
default.

## Implementation plan

Each step ends with the repository building and, from step 9 onward, with
`docker compose up` still working. Each step states how it is verified before the
next one starts.

1. **Initialise the repository.** `git init`, then scaffold the NestJS project at
   the repo root with the Nest CLI. Enable TypeScript strict mode, add ESLint and
   Prettier, and declare the scripts: `build`, `start`, `start:worker`,
   `migration:run`, `migration:generate`, `seed`, `verify`.
   *Verify:* `npm run lint` and `npm run build` both exit zero.

2. **Create the layered skeleton.** The `domain`, `application`, `infrastructure`
   and `modules` directories, path aliases in `tsconfig.json`, and the ESLint
   `no-restricted-imports` rule scoped to `src/domain/**` blocking `@nestjs/*`,
   `typeorm` and `src/infrastructure/*`.
   *Verify:* a scratch file importing `@nestjs/common` under `src/domain/` fails
   `npm run lint`; delete it afterwards.

3. **Configuration.** The Zod schema, the config module that validates
   `process.env` at boot and exports `AppConfig`, and `.env.example` documenting
   every variable with a safe default.
   *Verify:* booting with `DATABASE_URL` unset exits non-zero with a message
   naming the missing variable.

4. **Value objects and the `Order`/`OrderItem` domain classes.** `Money`,
   `Coordinates`, `ShippingAddress`, then `Order` and `OrderItem` — the only
   two domain classes (see Domain layer, frozen). No framework imports.
   *Verify:* Jest unit tests for `Money` arithmetic, run with no database.

5. **Order state machine.** The transition table and the named `Order`
   methods (`markPaid()`, `markPaymentFailed()`, `confirm()`, `cancel()`)
   that use it to reject illegal transitions. `status` stays a getter —
   `order.status = 'CONFIRMED'` must not compile.
   *Verify:* Jest unit tests covering one legal transition and one rejected
   transition per terminal state.

6. **Port interfaces.** `GeocodingProvider`, `PaymentGateway`, `EventPublisher`,
   their injection tokens and their command/result types. No implementations.
   *Verify:* `npm run build` passes.

7. **Migration, part one.** Create the migration file. `CREATE EXTENSION postgis`,
   the six enum types, and the reference tables `customers`, `products`,
   `warehouses` — including the geography column, the GiST index and the
   generated `latitude` / `longitude` columns.
   *Verify:* `npm run migration:run` against a local postgres succeeds; `psql`
   confirms the GiST index and that the generated columns return numbers. If
   PostgreSQL rejects the generated columns as non-immutable, drop them, expose
   the values in the API layer instead, and record the deviation in this spec's
   decisions.

8. **Migration, part two.** The remaining seven tables in the same file, with
   every CHECK constraint, the partial unique index on `CAPTURED` payments,
   `UNIQUE (order_id)` on `shipments`, the composite primary key on `inventory`
   and the indexes named in the DBML. Write the `down` method.
   *Verify:* migration runs clean on an empty database, `down` reverts it, and
   `psql` confirms the CHECK constraints are present.

9. **Persistence entities and the `Order`/`OrderItem` mapper.** One `@Entity()`
   class per table under `src/infrastructure/database/entities/**` — all 10
   tables. Plus the mapper to and from the domain classes, needed only for
   `Order`/`OrderItem`; every other entity is used directly, no mapper.
   *Verify:* a Jest test boots the TypeORM DataSource against the migrated
   database with `synchronize: false` and confirms metadata loads with no
   mismatch.

10. **Modules and entrypoints.** `SharedModule` wiring config, TypeORM and every
    port token, with a no-op stub bound to `EventPublisher`. Then `ApiModule`
    with the terminus `/health` controller, `WorkerModule`, `main.ts` with the
    global `ValidationPipe`, and `main.worker.ts` using
    `createApplicationContext()`.
    *Verify:* `npm start` answers `GET /health` with 200 including the database
    check; `npm run start:worker` connects and stays up with no HTTP port bound.

11. **Docker baseline.** Multi-stage `Dockerfile` with no `CMD`. Compose with
    `postgres`, the one-shot `migrate` and `seed` services, `api` and `worker`,
    wired as a single chain: `postgres` on `condition: service_healthy`, then
    `migrate` and `seed` on `condition: service_completed_successfully`. `api`
    and `worker` therefore refuse to start when either one-shot service exits
    non-zero. The `seed` service runs `npm run seed`; step 12 writes what that
    does. Marked placeholders where P2 adds `payments-mock` and P3 adds `lgtm`.
    *Verify:* `docker compose up` from a clean checkout brings everything up and
    migrations run exactly once.

12. **Seed script and seed service.** Hardcoded UUIDs, `ON CONFLICT DO NOTHING`,
    around eight Apple products, five warehouses with real coordinates, and
    inventory producing the four scenarios: exactly one viable warehouse,
    several with an unambiguous nearest, none viable, and a product at exactly
    the requested quantity. The compose wiring belongs to step 11.
    *Verify:* `docker compose up` twice in a row leaves identical row counts, a
    `psql` query confirms each of the four scenarios exists, and forcing the seed
    to exit non-zero leaves `api` and `worker` unstarted.

13. **The `verify` script.** One command chaining lint, build, the Jest suites and
    the `psql` assertions behind the acceptance criteria.
    *Verify:* `npm run verify` is green against a running stack.

## Acceptance criteria

- [ ] `docker compose up` from a clean clone brings up `postgres`, `migrate`,
      `seed`, `api` and `worker` with no manual steps.
- [ ] Migrations run exactly once on a cold start, from the `migrate` service
      only.
- [ ] `npm run migration:revert` reverts the migration on an empty database
      without error.
- [ ] Running `docker compose up` a second time leaves every table's row count
      unchanged.
- [ ] When the `seed` service exits non-zero, `api` and `worker` do not start and
      `docker compose up` terminates naming the failed dependency.
- [ ] `GET /health` on the api returns 200 and reports the PostgreSQL check as up.
- [ ] The `worker` container starts, connects to the database, binds no HTTP port
      and stays up.
- [ ] `psql` confirms the `postgis` extension is installed.
- [ ] `psql` confirms `idx_warehouses_location_gist` exists and is a GiST index.
- [ ] `psql` confirms the CHECK constraints on `inventory.quantity_available`,
      `inventory.quantity_reserved` and `order_items.quantity`.
- [ ] `SELECT name, latitude, longitude FROM warehouses` returns numeric
      coordinates, or the deviation is recorded in the decisions section.
- [ ] `UPDATE warehouses SET latitude = 0` is rejected by PostgreSQL, or the
      deviation is recorded.
- [ ] Inserting a second `CAPTURED` payment for the same order is rejected by the
      partial unique index.
- [ ] Inserting an `inventory` row with `quantity_available = -1` is rejected.
- [ ] The seed produces a product fillable by exactly one warehouse, one fillable
      by several with an unambiguous nearest, one fillable by none, and one
      stocked at exactly a requested quantity.
- [ ] Booting the api with `DATABASE_URL` unset exits non-zero and names the
      missing variable.
- [ ] A file under `src/domain/` importing `@nestjs/common` fails `npm run lint`.
- [ ] A file under `src/domain/` importing `typeorm` fails `npm run lint`.
- [ ] `order.status = 'CONFIRMED'` fails to compile; `Coordinates.of(40, -74)`
      (positional args) fails to compile.
- [ ] `npm run lint` and `npm run build` pass.
- [ ] The Jest suite passes, including the `Money` and state machine unit tests
      that run with no database.
- [ ] `npm run verify` is green end to end.

## Decisions

**Migrations and schema**

- **Yes:** a one-shot `migrate` service in compose. A failure surfaces directly in
  `docker compose up`, and no startup logic leaks into the api.
- **No:** the api running migrations under a PostgreSQL advisory lock. It works,
  but it hides a deployment concern inside application boot.
- **Yes:** the migration is hand-written raw SQL via `queryRunner.query`. PostGIS
  geography columns, generated columns, the GiST index and the partial unique
  index are not reliably produced by `migration:generate`, and this schema is a
  frozen contract.
- **No:** entities first, then generate. It would make the generator's output the
  contract instead of the DBML.
- **Yes:** attempt the generated `latitude` / `longitude` columns, with the
  fallback written down. On PostGIS 3.4 the cast and `ST_Y` are `IMMUTABLE`, so
  it is expected to work; if it does not, the migration fails in the first
  twenty seconds and the fallback is a documented deviation, not a surprise.
- **Yes:** `gen_random_uuid()` as the primary key default, following
  `data-model.dbml`. Noted discrepancy: `architectural-requirements.md:512` asks
  for UUID v7 "where available" for index locality, and PostgreSQL 16 has no
  native `uuidv7()` — it arrives in PostgreSQL 18. At this exercise's volume the
  locality difference is not observable.
- **No:** generating UUID v7 in the application. It would split key generation
  across two places for a benefit nothing here can measure.

**Layering and contracts**

- **Yes:** P0 writes the TypeORM persistence entities and freezes them alongside
  the schema. P1 and P5 both need the `orders` mapping and can run in parallel;
  written twice they would diverge.
- **Yes:** `no-restricted-imports` for the domain boundary. Zero extra
  dependencies, and it is exactly what acceptance criterion 8 requires.
- **No:** `eslint-plugin-boundaries`. A full whitelist of layer dependencies is
  more than a three-day exercise needs, and the only boundary being graded is the
  domain one.
- **Yes:** `SharedModule` registers the queue module in P0 with a no-op stub bound
  to `EventPublisher`. The DI graph is closed from day one, so P3 swaps an
  implementation rather than reshaping a frozen file.
- **No:** creating the `pgboss` schema in P0's migration. pg-boss creates its own
  tables at boot, and pinning them in a frozen migration would tie the schema to a
  library version.
- **Yes:** revised R0.5 from 11 domain classes down to two (`Order` +
  `OrderItem`) mid-step-4, after review. The deciding question: can the rule
  be guaranteed in memory, or does it need the database? `Inventory` was the
  clearest case — its correctness depends on `SELECT ... FOR UPDATE SKIP
  LOCKED`, so a domain-level `reserve()` would assert a guarantee it cannot
  keep. The six deleted classes (`Customer`, `Product`, `Warehouse`,
  `Inventory`, `Payment`, `Shipment`) had no invariant that survives that
  test; they become plain TypeORM entities with no mapper (steps 4, 9).
- **Yes:** `Coordinates.of()` takes a single `{ latitude, longitude }` object,
  not positional arguments. Both parameters are `number`, so positional args
  let `Coordinates.of(lng, lat)` compile silently — the ±90/±180 range checks
  do not catch a swap within the continental US, since both values are in
  range for both fields either way.
- **Noted, not yet closed:** two pieces of the revised R0.5 are contract, not
  yet code, as of step 4. `Money`'s "mixing currencies must not compile" is
  currently a runtime guard (`assertSameCurrency` throws); making it a type
  error needs a currency-branded type, not attempted yet. `Order`'s named
  transition methods (`markPaid()`, `markPaymentFailed()`, `confirm()`,
  `cancel()`) and the guard against `order.status = 'CONFIRMED'` are step 5's
  content — `Order` in step 4 is fields and getters only.

**Configuration and validation**

- **Yes:** Zod for environment variables. Inferred types, no decorators, and the
  same schema exports `AppConfig`.
- **Yes:** `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
  installed in P0 with no DTOs to validate yet. These are two different layers:
  Zod guards the process environment at boot, the pipe strips undeclared
  properties from HTTP bodies at request time. Installing it now means P4 only
  writes DTOs.

**Runtime and operations**

- **Yes:** the NestJS project lives at the repo root. Acceptance criterion 1 is
  "`docker compose up` from a clean clone"; a subdirectory adds a path to every
  command for nothing.
- **Yes:** `@nestjs/terminus` for `/health`, including the PostgreSQL check. It
  holds under multiple api instances because each one answers for itself, with no
  shared state.
- **Yes:** no `healthcheck` on the `worker` service in P0. It has no HTTP
  listener, and criterion 5 only asks that it start, connect and stay up. A real
  liveness signal belongs to P3, where the worker actually processes jobs.
- **No:** a minimal HTTP listener on the worker just to expose `/health`. It would
  contradict `createApplicationContext()`, which is the point of the second
  entrypoint.
- **Yes:** the seed runs as a one-shot compose service after `migrate`. Criterion
  1 forbids manual steps, and the seed is idempotent, so running it on every `up`
  is harmless. Data survives restarts in the `pgdata` volume; only
  `docker compose down -v` clears it.
- **Yes:** hardcoded UUIDs in the seed with `ON CONFLICT DO NOTHING`. Later
  phases' tests can reference concrete ids without querying for them first.
- **Yes:** `api` and `worker` are gated on `seed` completing successfully, not
  only on `migrate`. A half-loaded seed is invisible at boot and resurfaces hours
  later as P1 returning 409 for an order that should be fillable; failing at
  `docker compose up` turns a silent, deferred fault into an immediate one.
- **Noted:** in production you would not block application rollout on a
  reference-data job, because the two lifecycles are separate. Here the
  `docker compose up` is the deliverable and the four seeded inventory scenarios
  are what make P1 and P6 demonstrable, so the coupling is deliberate.
- **Yes:** the seed stays invocable as `npm run seed` independently of compose. A
  load that fails for an odd reason can be cleaned up and re-run by hand against
  the running stack, without rebuilding anything.

**Process**

- **Yes:** every implementation step is validated against its own check before the
  next one starts, as recorded inline in the plan.
- **Yes:** integration tests connect to the compose stack on `localhost:5432`.
- **No:** Testcontainers. It would earn its cost in an isolated CI pipeline,
  which is not what this week is.
- **Yes:** the Nest CLI, via the `nestjs-cli` agent, generates the mechanical
  scaffolding in steps 1 and 10. Steps 4 through 9 are contracts and SQL written
  by hand on purpose.

## Risks

| Risk | Mitigation |
| --- | --- |
| `GENERATED ALWAYS AS ST_Y(location::geometry)` is rejected as non-immutable on this PostGIS build. | Step 7 hits it before the other seven tables are written. Fallback: drop the columns, derive the values in the API layer, record the deviation in the decisions section. |
| A frozen contract turns out to be wrong once P1 or P4 is under way. | The phase rule applies: the phase stops and raises the conflict rather than editing the interface while a sibling session compiles against it. |
| `docker-compose.yml` is the one file two later phases both touch — P2 adds `payments-mock`, P3 adds `lgtm`. | P0 leaves a clearly marked placeholder for each. The wave order keeps P2 and P3 apart; if they ever run together, one of the two services is added by hand. |
| `ST_MakePoint` takes longitude first, the reverse of how coordinates are spoken. A swap puts warehouses in the wrong hemisphere and silently corrupts distance ranking in P1. | The seed's four scenarios are verified by querying actual distances, not by eyeballing the inserted rows. A swapped pair makes the "unambiguous nearest" scenario pick the wrong warehouse. |
| Both `api` and `worker` race to migrate on a cold start. | Migrations run only from the one-shot `migrate` service. Neither entrypoint runs them. |
| The seed's hardcoded UUIDs make later phases' tests depend on seeded ids. | Accepted deliberately. The alternative — querying for ids first — makes every test longer for no gain in a fixture set that is itself frozen. |
| Enum types are harder to alter later than a `varchar` with a CHECK. | Accepted. The enum values come from the DBML and are part of the frozen contract; altering them is meant to be a deliberate act, not a convenience. |

## What is **not** in this spec

- Warehouse selection, the single-query candidate ranking and the reservation
  mechanics. That is P1, and it is the phase carrying the exercise's real signal.
- Real `PaymentGateway` and `GeocodingProvider` adapters, and the `payments-mock`
  compose service. P2.
- pg-boss wiring, job handlers, the reaper, OpenTelemetry and the `lgtm` service.
  P3 replaces P0's no-op `EventPublisher` stub.
- `POST /orders`, request DTOs, idempotency handling and the error contract. P4.
- `GET /orders` and anything else on the read side. P5.
- Concurrency proofs and load testing. P6.
- Bulk creation and `PATCH`. P7, and only behind the stretch gate.

Nothing above gets slipped in "while we're here". Each one has its own phase file
and gets its own spec.
