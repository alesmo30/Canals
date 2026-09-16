# P0 — Foundation

| | |
|---|---|
| **Wave** | 0 — blocking |
| **Depends on** | — |
| **Blocks** | every other phase |
| **Parallel with** | **nothing.** Run this alone. |
| **Risk** | medium — mistakes here propagate everywhere |
| **Target** | Wednesday morning |

## Objective

Produce a repository that builds, starts, migrates and seeds — and whose
**contracts are frozen**: domain entities, port interfaces and the database
schema. Every later phase compiles against what this phase decides.

No business logic. No adapters beyond stubs. This phase is scaffolding and
contracts only.

---

## Requirements

### R0.1 — Repository scaffold

- NestJS project, TypeScript strict mode, Node 22.
- ESLint + Prettier, with a `lint` script that fails on error.
- Path aliases so `src/domain` never imports from `src/infrastructure`.
- Scripts: `build`, `start`, `start:worker`, `migration:run`, `migration:generate`, `seed`.

### R0.2 — Layered directory structure

Create the structure described in `infrastructure.md` §3:

```
src/
├─ domain/            entities, value objects, state machine, port interfaces
├─ application/       use cases (empty for now)
├─ infrastructure/    adapters (stubs for now)
├─ modules/
│  ├─ shared.module.ts
│  ├─ api.module.ts
│  └─ worker.module.ts
├─ main.ts
└─ main.worker.ts
```

`src/domain/**` must not import `@nestjs/*` or `typeorm`. Enforce with an ESLint
`no-restricted-imports` rule so a later phase cannot break it by accident.

### R0.3 — Configuration

- All configuration from environment variables, validated at boot against a
  schema. **The app refuses to start on invalid config** rather than failing later.
- `.env.example` documenting every variable with a safe default.
- Variables needed now: `DATABASE_URL`, `PORT`, `PAYMENTS_URL`,
  `GEOCODING_DRIVER`, `GEOAPIFY_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `PGBOSS_POLL_INTERVAL_SECONDS`, `RESERVATION_TTL_MINUTES`.

### R0.4 — Database schema migration

One migration creating the full schema from `data-model.dbml`. Non-negotiable
details, all of which later phases rely on:

- `CREATE EXTENSION IF NOT EXISTS postgis;`
- 10 tables: `customers`, `products`, `warehouses`, `inventory`, `orders`,
  `order_items`, `payments`, `shipments`, `inventory_movements`, `idempotency_keys`.
- All enums as PostgreSQL enum types.
- `warehouses.location` and `orders.shipping_location` as `geography(Point,4326)`.
- **GiST index** on `warehouses.location`.
- `warehouses.latitude` / `longitude` as generated columns from `location`.
  If the cast is not `IMMUTABLE` on this PostGIS build, fall back to exposing them
  in the API layer and record the deviation in the phase notes.
- `CHECK (quantity_available >= 0)` and `CHECK (quantity_reserved >= 0)` on `inventory`.
- `CHECK (quantity > 0)` on `order_items`.
- Partial unique index: at most one `CAPTURED` payment per order.
- `UNIQUE (order_id)` on `shipments`.
- Composite PK `(warehouse_id, product_id)` on `inventory`.
- All indexes listed in the DBML, including `idx_orders_keyset` and `idx_orders_reaper`.
- Money columns as `bigint` cents. Timestamps as `timestamptz`.

`synchronize: false` in every environment. Migrations are the only way the
schema changes.

### R0.5 — Domain layer (FROZEN CONTRACT)

- Entities and value objects: `Order`, `OrderItem`, `Payment`, `Shipment`,
  `Inventory`, `Product`, `Warehouse`, `Customer`, `ShippingAddress`,
  `Coordinates`, `Money`.
- `Money` as integer cents + currency. No floats anywhere.
- The order state machine as explicit code: allowed transitions and a guard that
  rejects illegal ones.

### R0.6 — Port interfaces (FROZEN CONTRACT)

Define, with no implementations:

```ts
export interface GeocodingProvider {
  geocode(address: ShippingAddress): Promise<Coordinates>;
}

export interface PaymentGateway {
  charge(command: ChargeCommand): Promise<ChargeResult>;
  getStatus(idempotencyKey: string): Promise<ChargeResult>;   // reconciliation
}

export interface EventPublisher {
  publish(event: DomainEvent, tx?: TransactionContext): Promise<void>;
}
```

Plus the injection tokens and the command/result types. **These signatures are
what P2 and P3 implement and what P4 consumes. Changing them later breaks
parallel work.**

### R0.7 — Docker baseline

- Multi-stage `Dockerfile` with no fixed `CMD`.
- `docker-compose.yml` with `postgres` (`postgis/postgis:16-3.4`), `api` and
  `worker`, including healthchecks and `depends_on: condition: service_healthy`.
  P2 adds `payments-mock`, P3 adds `lgtm` — leave clearly marked placeholders.
- Migrations run from **exactly one place**. Either a one-shot `migrate` service
  or the api guarded by a PostgreSQL advisory lock. Both containers running them
  on a cold start is a race.

### R0.8 — Seed script

Data designed to exercise every branch later phases must demonstrate:

- ~8 Apple products, mixing `NEW` and `REFURBISHED` conditions, realistic USD prices.
- 4–5 warehouses in real US cities with **real coordinates** (e.g. Newark NJ,
  Los Angeles CA, Dallas TX, Chicago IL, Miami FL).
- Inventory distributions that produce, deliberately:
  1. an order fillable by **exactly one** warehouse;
  2. an order fillable by **several**, where the correct answer is unambiguously the nearest;
  3. an order fillable by **none** (a product is short everywhere);
  4. a product at **exactly** the requested quantity in one warehouse — the boundary case for P6's concurrency proof.
- Idempotent: running it twice must not duplicate rows.

---

## Files owned by this phase

Everything. This phase creates the repository. After it, the paths below are
**frozen** and later phases may not edit them without raising a conflict:

```
src/domain/**
src/modules/shared.module.ts
src/infrastructure/database/migrations/**
Dockerfile
docker-compose.yml          (later phases add ONLY their named service)
.env.example
```

---

## Acceptance criteria

1. `docker compose up` from a clean clone brings up postgres, api and worker with no manual steps.
2. Migrations run automatically, exactly once, and are reversible (`down` works).
3. `npm run seed` populates the data and is safe to run twice.
4. `GET /health` returns 200 on the api.
5. The worker container starts, connects to the database and stays up doing nothing.
6. `psql` confirms: PostGIS enabled, GiST index present, `CHECK` constraints present, generated lat/lng columns readable.
7. `npm run lint` and `npm run build` pass.
8. Attempting to import `@nestjs/common` from `src/domain/**` fails lint.

## Out of scope

Warehouse selection, payments, geocoding, queue wiring, HTTP endpoints beyond
`/health`, observability. All stubs and empty modules.

## References

NFR-5, NFR-8, NFR-9, C-3, C-11 · `data-model.dbml` · `infrastructure.md` §3, §5
