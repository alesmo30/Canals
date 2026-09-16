# Architectural Requirements — Canals Order Management Service

| | |
|---|---|
| **Status** | Draft for review |
| **Author** | Alejandro Estrada Moscoso |
| **Last updated** | 2026-09-15 |
| **Target delivery** | 2026-09-18 |
| **Related** | [`data-model.dbml`](./data-model.dbml) |

---

## 1. Context and Goals

We are building the backend service for an e-commerce platform that retails Apple
consumer electronics in the United States. The deliverable is a **minimal but
production-grade order management API**.

The single non-trivial piece of domain logic is **order fulfilment routing**: an
order must be filled from exactly one warehouse, that warehouse must hold every
requested product in sufficient quantity, and among all qualifying warehouses we
pick the one geographically closest to the shipping address.

The goal of this document is to fix *what* we are building and *what quality bar
it must meet* before any code is written, so that every later decision can be
checked against it.

**Explicit non-goal:** breadth. The assessment states *"Only the functionality
specified above"* while also demanding *"production-ready"*. We optimise for
depth on the specified path — correctness under concurrency, data integrity,
failure handling, observability — rather than for a large surface area of
half-finished endpoints.

### 1.1 Assumptions

| # | Assumption |
|---|---|
| A-1 | The frontend exists and is out of scope. We expose an HTTP/JSON API only. |
| A-2 | Customers, products, warehouses and inventory are pre-existing data, managed elsewhere. We seed them; we do not expose CRUD for them. |
| A-3 | No authentication or authorisation layer. Every caller is trusted. |
| A-4 | Geocoding and payments are third-party systems, mocked behind interfaces we control. |
| A-5 | A single currency (USD) for v1. Money is still modelled multi-currency-ready. |

---

## 2. Scope

### 2.1 In scope

- `POST /orders` — the core use case.
- `GET /orders` / `GET /orders/:id` — read side, required to verify the system.
- Warehouse selection (availability + proximity).
- Mocked geocoding provider.
- Mocked payment provider.
- Inventory reservation and release with concurrency safety.
- Durable background job processing (retries, backoff, DLQ).
- Observability, migrations, local one-command startup.

### 2.2 Out of scope (deliberate)

| Item | Rationale |
|---|---|
| `PATCH /orders/:id` | Deferred — see FR-11. Mutating a paid, allocated order pulls in re-allocation, partial refunds and a full state machine. |
| `DELETE /orders/:id` | Cancellation, not deletion, is the correct domain operation. Reversing a captured payment is a separate bounded context. |
| Customer / product / warehouse CRUD | Explicitly excluded by the assessment. |
| Auth, rate-limit tiers, multi-tenancy | Explicitly excluded by the assessment. |
| Split-warehouse fulfilment | Forbidden by the business rule in C-6. |
| Sales tax | US sales tax is a genuine domain of its own — state, county and city rates, nexus rules, exemption certificates. The assessment says nothing about it, and a wrong implementation is worse than none. `orders.total_cents` is therefore the sum of the line items. |
| Shipping cost calculation | Same reasoning. The distance is computed for *routing*, not for pricing. |
| Automated test suite | Optional per the assessment. See NFR-9. |

---

## 3. Functional Requirements

### FR-1 — Create an order

`POST /orders`

**Request** (all fields validated, unknown fields rejected):

```jsonc
{
  "customerId": "uuid",
  "shippingAddress": {
    "recipient": "string",
    "line1": "string",
    "line2": "string?",
    "city": "string",
    "state": "string?",
    "postalCode": "string?",
    "country": "US"
  },
  "items": [
    { "productId": "uuid", "quantity": 1 }
  ],
  "payment": {
    "cardNumber": "string"
  }
}
```

Header `Idempotency-Key: <uuid>` is **required** (see FR-6).

**Happy path, in order:**

1. Validate payload; resolve customer and products; reject unknown/inactive products.
2. Geocode the shipping address to `(lat, lng)` (FR-3).
3. Select the fulfilling warehouse (FR-2).
4. Reserve inventory and persist the order as `PENDING_PAYMENT` (FR-5, phase 1).
5. Charge the payment provider (FR-4).
6. Commit the reservation and transition the order to `PAID` → `CONFIRMED` (FR-5, phase 3).
7. Emit `order.confirmed` to the outbox for asynchronous follow-up (FR-9).

**Response** `201 Created` with the full order representation, including the
selected `warehouseId`, per-line price snapshots, computed total, and payment
status.

**Order state machine:**

```
                      ┌──────────────► PAYMENT_FAILED ──► CANCELLED
                      │
PENDING_PAYMENT ──────┼──────────────► PAID ──► CONFIRMED
       │              │
       │              └──────────────► CANCELLED (reservation expired)
       ▼
  NO_FULFILMENT (422, no order persisted)
```

**Failure modes and responses:**

| Condition | HTTP | Behaviour |
|---|---|---|
| Invalid payload | 400 | No side effects. |
| Unknown customer / product | 404 | No side effects. |
| No single warehouse can fill the order | 422 | No order persisted. Response names the unsatisfiable products. |
| Inventory race lost on all candidates | 409 | Retry-able; no reservation held. |
| Payment declined | 402 | Order persisted as `PAYMENT_FAILED`, reservation released. |
| Payment provider unreachable / timeout | 502 | Order held as `PENDING_PAYMENT`, reservation retained until TTL, reconciliation job resolves it (FR-5). |

### FR-2 — Warehouse selection

This is the heart of the exercise and must be **one database query**, not an
N+1 loop in application code.

**Rules:**

1. A warehouse is a *candidate* only if, for **every** line in the order, it holds
   `quantity_available >= requested_quantity`.
2. Candidates are ranked by geodesic distance between the warehouse location and
   the geocoded shipping address, ascending.
3. Ties are broken deterministically by `warehouse.id` to keep behaviour reproducible.
4. If reserving against the top candidate fails due to a concurrent order
   (see FR-5), we fail over to the next candidate, up to **3** attempts, before
   returning 409.

**Implementation:** a single SQL statement joining `inventory` against the
requested `(product_id, quantity)` set, grouped by `warehouse_id`, with
`HAVING count(*) = :lineCount`, ordered by
`location <-> :shippingPoint`. PostGIS `geography(Point, 4326)` with a GiST index
gives us metre-accurate distance and index-assisted nearest-neighbour ordering.

**Correctness note:** the selection query is a *read*. It does not guarantee the
stock is still there when we reserve. Reservation is the authoritative step
(FR-5) and selection is an optimisation over it.

### FR-3 — Geocoding

Exposed to the domain as a `GeocodingProvider` port:

```ts
export interface GeocodingProvider {
  geocode(address: ShippingAddress): Promise<Coordinates>;
}
```

**Two adapters ship, and which one runs is an environment variable.** The
assessment permits a mock (C-4); we take the permission for the default but
implement a real provider as well, because the port is only credible if
something real has actually been plugged into it.

| Adapter | When | Why |
|---|---|---|
| `StaticGeocodingProvider` **(default)** | `docker compose up`, no configuration | Lookup table of US cities plus deterministic per-address jitter hashed from the full address string. Same input always yields the same output, so every scenario in the README is reproducible and no network call can make a demo flaky. Satisfies C-11: the reviewer needs no account and no key. |
| `GeoapifyGeocodingProvider` | `GEOCODING_DRIVER=geoapify` + `GEOAPIFY_API_KEY` | A real third-party call, with timeout, retry and circuit breaker exercised against a real network. |

#### Why Geoapify and not Mapbox

This is a licensing constraint, not a preference, and it is worth stating
because it is easy to get wrong:

**Our design persists the geocoded coordinates permanently** — `shipping_location`
is the frozen evidence of why a warehouse was chosen (see FR-2 and NFR-5). Most
geocoding free tiers forbid exactly that:

| Provider | Free tier | Permanent storage of results |
|---|---|---|
| **Geoapify** | 3,000 credits/day, no credit card | ✅ Explicitly permitted — may be cached, stored and redistributed, with attribution |
| Mapbox | 100k/month (*Temporary* Geocoding) | ❌ Temporary use only. *Permanent* Geocoding, which allows storage, has **no free tier** ($5.00 / 1,000) |
| LocationIQ | 5,000/day | ❌ 48-hour cache limit on the free tier |
| Google | ~$200 credit/month | ❌ Coordinates cachable 30 days; place IDs only beyond that |
| HERE | 30,000/month | ❌ 30-day retention cap; permanent geocoding excluded from the self-serve plan |
| Nominatim (public) | unlimited | ⚠️ Low-volume non-commercial use only |

Geoapify is the only mainstream free tier whose terms permit the storage our
architecture depends on, and it requires no credit card. Attribution
("Powered by Geoapify") is required and goes in the README.

> Choosing Mapbox would have meant either violating its terms or re-geocoding on
> every read — which breaks the audit trail that FR-2 depends on. This is a
> good example of a licensing term dictating an architectural decision.

#### Behaviour, both adapters

- Results are cached by normalised address hash, both to cut cost and to keep
  repeated requests consistent.
- **Only the shipping address is geocoded.** Warehouse coordinates are fixed
  reference data, seeded once. Geocoding them per request would be an external
  call to resolve something that never changes.
- **The result is persisted on the order** (`shipping_location`). Frozen
  evidence of the routing decision — see FR-2.
- The provider is allowed to fail: timeout 2s, retry with backoff, circuit
  breaker. Terminal failure → `422` with a clear message; no order is persisted.

### FR-4 — Payment (mocked)

- Exposed as a `PaymentGateway` port:
  `charge({ cardNumber, amountMinor, currency, description, idempotencyKey })`.
- v1 implementation is `MockPaymentGateway`, which deterministically simulates
  the full outcome space based on the card number, so every failure branch is
  demonstrable without network access:

  | Outcome | Trigger | Handling |
  |---|---|---|
  | Approved | default | Proceed. |
  | Declined | designated test PANs | Terminal. Release reservation, `PAYMENT_FAILED`. |
  | Transient 5xx | designated test PANs | Retry with exponential backoff + jitter, max 3 attempts. |
  | Timeout | designated test PANs | **Unknown** outcome. Do *not* retry blindly; reconcile (FR-5). |

- **Security:** the full PAN never reaches the database or the logs. We persist
  `card_last4` and `card_brand` only. The PAN exists in memory for the duration
  of the request and is redacted by a log serialiser.
- The gateway call is wrapped in a timeout (2s) and a circuit breaker.

### FR-5 — Transactional integrity (three-phase saga)

> **This requirement supersedes the naive "wrap everything in one transaction"
> approach.** Holding a database transaction open across an outbound HTTP call
> keeps row locks on `inventory` for the full network round-trip, serialises
> unrelated orders against the same warehouse, and exhausts the connection pool
> under load. It is the single most common way this exercise is failed.

**Phase 1 — Reserve (short local transaction):**

- `BEGIN`
- Lock the candidate warehouse's relevant `inventory` rows with
  `SELECT ... FOR UPDATE`, **ordered by `product_id`** so that concurrent orders
  acquire locks in the same sequence and cannot deadlock.
- Re-verify availability. If insufficient, roll back and fail over to the next
  candidate (FR-2 rule 4).
- `quantity_available -= qty`, `quantity_reserved += qty`.
- Insert `orders` (`PENDING_PAYMENT`, `reservation_expires_at = now() + 15 min`),
  `order_items` with price snapshots, and `inventory_movements` (`RESERVE`).
- `COMMIT`

**Phase 2 — Charge (no transaction open):**

- Call `PaymentGateway.charge(...)` with a stable idempotency key derived from
  the order id, so a retry can never double-charge.
- Persist the attempt in `payments` regardless of outcome.

**Phase 3 — Settle (short local transaction):**

- *Approved:* `quantity_reserved -= qty` (the stock is now gone for good),
  record `COMMIT` movements, order → `PAID` → `CONFIRMED`, write the
  `order.confirmed` outbox event.
- *Declined:* release the reservation (`quantity_available += qty`,
  `quantity_reserved -= qty`), record `RELEASE` movements, order → `PAYMENT_FAILED`.
- *Unknown:* leave the order `PENDING_PAYMENT` and let reconciliation decide.

**Reservation reaper (background job):** periodically scans for orders still
`PENDING_PAYMENT` past `reservation_expires_at`, queries the payment provider
for the authoritative status of that idempotency key, and either settles or
releases. This closes the timeout hole and is what makes the system actually
safe rather than merely happy-path correct.

**Invariants enforced at the database level, not just in code:**

- `CHECK (quantity_available >= 0)` and `CHECK (quantity_reserved >= 0)` on `inventory`.
- `CHECK (quantity > 0)` on `order_items`.
- At most one `CAPTURED` payment per order, via a partial unique index.
- Every `orders` row in a terminal state has a non-null resolution timestamp.

### FR-6 — Idempotency

`POST /orders` is idempotent on the `Idempotency-Key` header.

- The key plus a SHA-256 fingerprint of the request body is inserted into
  `idempotency_keys` under a unique constraint **before** any work begins.
- Same key + same body, request still running → `409 Conflict`.
- Same key + same body, request completed → the original stored response is
  replayed verbatim.
- Same key + **different** body → `422 Unprocessable Entity`. This catches
  client bugs rather than silently doing the wrong thing.
- Keys expire after 24 hours.

Without this, a retry from the UI on a flaky connection charges the customer twice.

### FR-7 — Read orders

- `GET /orders/:id` — full representation including items, payment attempts,
  selected warehouse and shipment.
- `GET /orders` — **keyset (cursor) pagination**, not `OFFSET`. Offset pagination
  degrades linearly and produces duplicates/gaps when rows are inserted
  concurrently, which is exactly the situation here.
  - Filters: `customerId`, `status`, `warehouseId`, `createdAtFrom`, `createdAtTo`.
  - Default page size 20, maximum 100.
  - Stable sort on `(created_at DESC, id DESC)` with a matching composite index.
  - Response carries `nextCursor` and `hasMore`.

### FR-8 — Input validation and error contract

- DTO validation with a strict whitelist: unknown properties are **rejected**,
  not stripped, so the client learns about its mistake.
- All errors use a single envelope based on RFC 9457 (`application/problem+json`):
  `type`, `title`, `status`, `detail`, `instance`, plus a `correlationId` and a
  structured `errors[]` array for field-level failures.
- Error responses never echo back sensitive input. Card numbers, in particular,
  are redacted before the payload is ever serialised into an error message.
- Unhandled exceptions surface as a generic `500` with a correlation id; the
  stack trace goes to logs only.

### FR-9 — Asynchronous work

Order creation stays **synchronous** — the caller needs the real payment result —
but everything that happens *after* confirmation is durable and asynchronous.

#### Transactional outbox

Domain events must be persisted **inside the same transaction** that changes the
order. Otherwise the commit and the enqueue are two writes to two different
systems, and a crash between them leaves an order that is paid and confirmed but
whose shipment is never created — silently, with no error and no retry.

**We satisfy this without a dedicated `outbox_events` table.** `pg-boss` stores
jobs in a table inside our own PostgreSQL database and accepts an external SQL
executor, so the job insert participates in the order's transaction directly:

```ts
await dataSource.transaction(async (trx) => {
  await trx.update(Order, orderId, { status: 'CONFIRMED' });
  await trx.insert(Payment, payment);
  await boss.send('order.confirmed', event, {
    db: { executeSql: (text, values) => trx.query(text, values) },
  });
});  // one COMMIT: order and job are saved together, or neither is
```

The pg-boss job table **is** the outbox. A separate outbox table plus a relay
process would be duplicating what the queue already gives us. This is worth
stating explicitly: the pattern is deliberately satisfied, not skipped.

> If the queue ever moves outside PostgreSQL (see §7), a real `outbox_events`
> table and a relay become mandatory again — and by design that change is
> confined to one adapter (NFR-8).

#### Queue and workers

- **Queue:** `pg-boss`, on the same PostgreSQL instance.
  - *Why not BullMQ/Redis:* correctness first — with a Redis-backed queue the
    enqueue cannot join the database transaction, so an outbox table and a relay
    process become mandatory. Second, durability: a stock `redis:alpine` does not
    persist to disk unless AOF is configured, so a restart can drop queued work.
    Third, one fewer system to run, monitor and back up.
- **Worker:** a separate process from the API, built from the same image with a
  different entrypoint (`main.worker.ts`), so it scales and deploys independently.

#### Event-driven fan-out

One domain event, several **independent** consumers — each with its own retry
lifecycle:

```
                        ┌──► shipment.create   ──► own retries / own DLQ
   order.confirmed ─────┼──► customer.notify   ──► own retries / own DLQ
                        └──► analytics.record  ──► own retries / own DLQ
```

A single handler doing all three would be wrong: if the notification fails, the
whole job retries and the shipment gets created twice. Splitting the effects is
the point of the event-driven model, not decoration.

- **Retries:** exponential backoff with jitter, max 5 attempts per consumer.
- **Dead-letter queue:** jobs exhausting retries land in a DLQ with their full
  failure history, surfaced as a metric and an alert. Never silently dropped.
- **Handlers must be idempotent.** Queues guarantee *at-least-once*, never
  *exactly-once*: a worker can die after doing the work but before marking the
  job complete. Enforced structurally — e.g. `shipments.order_id` is `UNIQUE`, so
  a duplicate delivery hits the constraint instead of creating a second shipment.
- **Jobs:** shipment creation, customer notification, analytics, reservation
  reaper, payment reconciliation.

### FR-10 — Bulk order creation *(optional, stretch)*

`POST /orders/bulk` accepting **up to 25 orders** per request. Each order is
processed independently through the same pipeline; the response is a per-item
result array with `207 Multi-Status` semantics. Partial success is explicit —
one bad order never fails the batch.

The cap is deliberately low. Every order in the batch does its own geocoding
call, warehouse selection, inventory locking and payment call, so a batch of 25
can hold inventory locks and burn provider quota for a meaningful stretch. A
higher cap would push this towards being an async job with a status endpoint,
which is a different feature.

**Only built if FR-1 through FR-9 are complete and hardened.**

### FR-11 — Order modification *(deferred, stretch)*

`PATCH /orders/:id`, restricted to orders still in `PENDING_PAYMENT`, and
restricted to fields that do not affect stock or money (recipient name, address
line 2, delivery notes). Any change to `items` or to the shipping city would
require re-running warehouse selection and re-reserving stock, which is a
materially larger feature.

**Only built if FR-1 through FR-9 are complete and hardened.**

---

## 4. Non-Functional Requirements

### NFR-1 — Correctness under concurrency *(highest priority)*

The system must **never oversell inventory**, under any interleaving of
concurrent requests.

- Enforced by row-level locking with deterministic lock ordering (FR-5) *and* by
  database `CHECK` constraints as a backstop. Application logic is not trusted
  alone.
- Read Committed isolation is sufficient given explicit `FOR UPDATE` locking;
  we do not rely on Serializable and its retry loops.
- **Acceptance:** a load script firing N concurrent orders against a warehouse
  holding exactly N-k units of a product results in exactly N-k successful
  orders and k clean `409`/`422` responses — never N, never a negative balance.

### NFR-2 — Performance

| Metric | Target |
|---|---|
| `POST /orders` p95, excluding payment provider latency | < 300 ms |
| Warehouse selection query p95 | < 50 ms |
| `GET /orders` p95 | < 150 ms |
| Payment call timeout | 2 s |
| Sustained throughput (local, single instance) | ≥ 100 orders/min |

Supporting requirements: no N+1 queries on any path; every foreign key and every
filter/sort column used by FR-7 is indexed; GiST index on warehouse geography;
connection pooling sized explicitly rather than left at defaults.

### NFR-3 — Resilience

- Every outbound call has an explicit timeout. No unbounded waits.
- Retries only on *idempotent or idempotency-keyed* operations, always with
  exponential backoff and jitter.
- Circuit breaker on the payment gateway, so a provider outage degrades quickly
  and visibly instead of exhausting the connection pool.
- Graceful shutdown: stop accepting new requests, drain in-flight work and
  in-flight jobs, then exit.
- No in-memory state that would be lost on restart. Reservations, jobs and
  idempotency records all live in PostgreSQL.

### NFR-4 — Observability

Mandatory, and it must work locally and survive a future deployment unchanged.

- **Logging:** structured JSON, one line per event, every line carrying a
  `correlationId` propagated from the inbound request through jobs. Automatic
  redaction of PANs, emails and full addresses.
- **Tracing:** OpenTelemetry, with spans for the HTTP request, each database
  statement, the geocoding call, the payment call and each background job. A
  single trace must tell the whole story of one order.
- **Metrics:** RED (Rate, Errors, Duration) per endpoint, plus domain counters —
  orders by status, warehouse-selection failures, payment outcomes by type, queue
  depth, DLQ size, reservation expiries.
- **Health:** `GET /health` (liveness) and `GET /health/ready` (readiness —
  database and queue reachable).
- **Local stack:** OpenTelemetry Collector + Prometheus + Grafana + Tempo, wired
  in `docker-compose`, with a pre-provisioned dashboard. Entirely free, entirely
  local, and the exact same instrumentation code points at a hosted backend later
  by changing one environment variable.

### NFR-5 — Data management

- **Migrations only.** `synchronize: false` in every environment. Every migration
  is versioned, reviewed and reversible. The schema is never mutated by the ORM.
- **Money as integer cents.** `bigint` cents plus an ISO-4217 currency code.
  Never a float, and never a JavaScript `number` holding dollars.
  PostgreSQL `NUMERIC` would also be exact, but `node-postgres` returns it as a
  *string* to avoid precision loss — and a single `parseFloat()` anywhere in the
  codebase silently reintroduces binary-floating-point error. Integer cents
  cannot be corrupted that way, and it is also the unit every payment API
  expects, so no conversion happens at the boundary.
- **Snapshots as `jsonb` where the shape is frozen.** `orders.shipping_address`
  is a single `jsonb` column rather than seven flat columns: it is written once,
  never mutated and never queried field-by-field. Flat typed columns remain the
  rule for anything mutable or filtered.
- **Derived values are not stored.** Distance from an order to its warehouse is
  recomputed from the two frozen geographies rather than persisted; retry counts
  and contention live in metrics (NFR-4), not in table columns.
- **Time as `timestamptz`, always UTC.** Formatting is a presentation concern.
- **UUID primary keys** (v7 where available, for index locality).
- **Price snapshots** on `order_items`. A historical order must never change
  because the catalogue changed.
- **Address snapshots** on `orders`. Same reasoning: the customer editing their
  profile address must not rewrite history.
- **Soft delete** (`deleted_at`) on customers, products and warehouses only.
  Orders are cancelled, never deleted — financial records are append-only.
- **Audit trail:** `inventory_movements` is an append-only ledger. The current
  `inventory` balance must always be reconstructable by replaying it.
- Foreign keys are enforced by the database with explicit `ON DELETE` semantics.

### NFR-6 — Security

- No PAN at rest, in logs, in traces or in error responses. Last four digits and
  brand only.
- All configuration via environment variables, validated at boot with a schema.
  The application refuses to start on invalid config rather than failing later.
- No secrets in the repository. `.env.example` documents every variable.
- All SQL is parameterised, including the hand-written selection query.
- Request body size limits and basic rate limiting, as a denial-of-service floor.
- Security headers via Helmet; CORS configured explicitly rather than wildcarded.

### NFR-7 — Scalability

- The API is **stateless** and horizontally scalable behind a load balancer.
- The worker scales independently of the API.
- Database connections are pooled with an explicit ceiling, sized against the
  instance limit so that scaling out the API does not exhaust PostgreSQL.
- The design's known scaling limit is documented rather than hidden: inventory
  row locking serialises orders competing for the *same* product in the *same*
  warehouse. That is inherent to not overselling. Sharding by warehouse is the
  documented next step.

### NFR-8 — Maintainability

- Layered structure with the domain at the centre: HTTP controllers → application
  services → domain → infrastructure adapters.
- The domain layer has no NestJS or TypeORM imports. This is what makes the mocks
  swappable and the logic testable.

**Every external system sits behind a port owned by the domain.** The domain
declares *what* it needs; adapters decide *how*:

| Port (domain) | Adapter today | Adapter later |
|---|---|---|
| `GeocodingProvider` | `StaticGeocodingProvider` (mock, C-4) | `GoogleMapsProvider` |
| `PaymentGateway` | `MockPaymentGateway` (mock, C-5) | `StripeGateway` |
| `EventPublisher` | `PgBossEventPublisher` | `SqsEventPublisher` |

```ts
// src/domain/ports/event-publisher.port.ts — no infrastructure imports
export interface EventPublisher {
  /**
   * Publishes a domain event. When `tx` is supplied the publication MUST be
   * atomic with that transaction. How that is achieved is the adapter's problem.
   */
  publish(event: DomainEvent, tx?: TransactionContext): Promise<void>;
}
```

This inverts the dependency: infrastructure points at the domain, never the
reverse. Three concrete consequences:

1. Swapping the queue touches **one provider binding**, not business logic.
2. The domain is testable with an `InMemoryEventPublisher` — no Docker, no
   PostgreSQL, no AWS.
3. Accidental complexity stays at the edge. The outbox table that a non-PostgreSQL
   queue would require lives inside that adapter and nowhere else.

The assessment mandates mocks for geocoding and payments (C-4, C-5), and a mock
is only swappable if a port exists. `EventPublisher` simply applies the same rule
consistently rather than making an exception for messaging.
- OpenAPI specification generated from the code, served at `/docs`.
- Linting, formatting and commit conventions enforced; CI runs them.

### NFR-9 — Operability and developer experience

- `docker compose up` yields a fully working system — API, worker, PostgreSQL,
  observability stack — with no manual steps.
- A seed script populates realistic data: Apple product catalogue (new and
  refurbished), several warehouses across US cities with real coordinates,
  and inventory
  distributions specifically designed to exercise the interesting branches
  (single qualifying warehouse, multiple qualifying warehouses at different
  distances, no qualifying warehouse, exact-boundary stock).
- README gets a reviewer from clone to a successful order in under five minutes,
  including copy-pasteable `curl` commands for every scenario above, and the
  one-line switch to the real geocoding provider (`GEOCODING_DRIVER=geoapify`)
  for anyone who wants to see the live integration.
- **Tests:** the assessment marks these optional. We write a focused set anyway,
  limited to where they carry real signal — the concurrency invariant (NFR-1),
  the warehouse selection query, and the saga's failure branches. We do not
  pursue coverage for its own sake.

---

## 5. Constraints

| # | Constraint | Source | Implication |
|---|---|---|---|
| C-1 | Only the specified functionality. No customer/product/warehouse APIs, no auth. | Assessment | Scope discipline; documented in §2.2. |
| C-2 | The functionality that *is* built must be production-ready, with real rigour on data storage and management. | Assessment | Drives NFR-1, NFR-5 in particular. |
| C-3 | A real database is mandatory. | Assessment | PostgreSQL 16 + PostGIS, running locally in Docker. No in-memory or file-based stores. Managed hosting (Supabase) is a deployment target, not a prerequisite — see §6.1. |
| C-4 | Geocoding **may** be mocked. | Assessment | Permission, not obligation. FR-3 ships a deterministic mock as the default (so C-11 holds) plus a real Geoapify adapter behind an env var. |
| C-5 | Payments must be mocked; the API takes card number, amount, description. | Assessment | FR-4. The mock's *interface* mirrors that contract exactly. |
| C-6 | **An order must be filled from a single warehouse.** | Assessment | Hard business invariant. No split fulfilment, ever. `orders.warehouse_id` is single-valued by construction. |
| C-7 | If multiple warehouses qualify, pick the closest to the shipping address. | Assessment | FR-2. |
| C-8 | Automated tests are not required. | Assessment | NFR-9 — targeted tests only. |
| C-9 | Any tools, including AI, are permitted. | Assessment | No constraint. |
| C-10 | **Delivery by Friday 2026-09-18.** | Self-imposed | ~3 working days. The single largest constraint. Justifies deferring FR-10, FR-11 and all managed-infrastructure options. |
| C-11 | **A reviewer must be able to run the whole system with `docker compose up`, with no account on any cloud provider and no credentials to obtain.** Hosted services are acceptable in principle if cheap, but not if they become a prerequisite for running the project. | Self-imposed | This is a *reviewability* constraint, not a cost one. It rules out AWS SQS, Temporal Cloud and hosted observability vendors for v1 — not because of price, but because they would put a signup wall in front of the person evaluating the work. |
| C-12 | Frontend is assumed complete and is not built. | Self-imposed | API-only deliverable. |
| C-13 | Domain is an Apple-products retailer in the United States. | Self-imposed | USD currency, US cities and coordinates in seed data. |

---

## 6. Technology Decisions

| Layer | Choice | Rationale |
|---|---|---|
| Language / runtime | TypeScript, Node.js 22 LTS | Existing strength; strong typing across domain boundaries. |
| Framework | NestJS | DI container makes the port/adapter structure of NFR-8 natural; first-class validation, config, OpenAPI and lifecycle hooks. |
| Database | PostgreSQL 16 + PostGIS, `postgis/postgis:16-3.4` in Docker | Required by C-3. PostGIS for FR-2; `jsonb`, partial indexes, `CHECK` constraints and generated columns all pull their weight here. Runs locally so C-11 holds. |
| Geospatial | PostGIS `geography(Point, 4326)` + GiST | Metre-accurate distance and index-assisted nearest-neighbour ordering in a single query. |
| ORM | TypeORM | Familiar; explicit migrations. The warehouse-selection query is **hand-written parameterised SQL** — it is too important to leave to a query builder. |
| Queue | `pg-boss` | Transactional enqueue in the same database — its job table *is* the outbox. See FR-9 for the full argument, and NFR-8 for the port that keeps it replaceable. |
| Observability | OpenTelemetry → Collector → Prometheus / Grafana / Tempo | Vendor-neutral instrumentation, free, local, portable to any backend later. |
| Payments | In-house `MockPaymentGateway` | Mandated by C-5; deterministic failure simulation is impossible against a live sandbox. |
| Geocoding | `StaticGeocodingProvider` (default) / `GeoapifyGeocodingProvider` (opt-in) | Permitted by C-4. Geoapify is the only free tier whose terms allow persisting results — see FR-3. |
| Containerisation | Docker Compose | Satisfies NFR-9. |

### 6.1 On Supabase

Supabase was the original intended database and has been demoted to an
**optional deployment target**. Three reasons, in order of weight:

1. **C-11.** A hosted database makes a Supabase account a prerequisite for
   running the project. The reviewer must be able to `docker compose up` and get
   a working system, so the local `postgis/postgis` container is the primary.
2. **Free-plan projects are paused after 7 days of low activity.** A reviewer
   opening the repo a week after submission would hit a paused database. That
   alone disqualifies it as the default.
3. **Connection mode matters for `pg-boss`.** If we do deploy to Supabase:
   - Use the **direct connection or Supavisor session mode (port 5432)**, never
     the transaction pooler (port 6543). Transaction mode hands a shared
     connection back to the pool between statements, which is incompatible with
     session-scoped state and with a long-lived worker holding its own pool.
   - `pg-boss` creates and owns its own schema, so the role it connects with
     needs `CREATE` on the database. Supabase's `postgres` role has this.
   - PostGIS is available as an extension and must be enabled in the migration.

Nothing in the code changes between the two: both are PostgreSQL, reached
through `DATABASE_URL`.

### 6.2 Rejected alternatives

| Rejected | Why |
|---|---|
| **Temporal** for workflow orchestration | Genuinely the right tool for a long-running saga at scale, and it would look impressive. But it adds a cloud dependency, a second programming model and a significant learning curve against a 3-day deadline (C-10). The three-phase saga in FR-5 plus the reconciliation job delivers the same correctness guarantees with code a reviewer can read in ten minutes. Documented as the natural evolution. |
| **Kafka** | Kafka is a distributed log for streaming *between services or teams* — its value is retention, replay, multiple independent consumers, partition ordering and very high throughput. This system has one service, one consumer, no replay requirement and trivial volume; none of the five apply. It also has no native per-message DLQ or backoff (you build retry topics yourself), and — decisively — **it does not solve the dual-write problem either**, since it is still external to PostgreSQL. The canonical pattern is outbox + CDC → Kafka, i.e. all of that complexity *plus* the original problem still to solve. |
| **AWS SQS** | The strongest of the external options: managed, durable, cheap, native DLQ and retries. Rejected on C-11, not on cost — a reviewer would need their own AWS account and credentials, or we would ship LocalStack: another container and an imperfect emulation. It also reintroduces the dual-write problem, making a real outbox table and relay mandatory. Explicitly retained as the first step in §7. |
| **Asynchronous `POST /orders` returning `202`** | Changes the contract with the UI: the customer would not learn the payment outcome from the request that placed the order. Wrong trade for a checkout flow. |
| **Mapbox geocoding** | Its free Temporary Geocoding tier forbids storing results, and Permanent Geocoding has no free tier. Our design persists `shipping_location` deliberately (FR-2, NFR-5), so Mapbox would force either a terms violation or re-geocoding on every read — destroying the audit trail. Geoapify's terms permit storage; that decided it. |
| **Real Stripe test mode** | Makes the failure branches non-deterministic and network-dependent, which is precisely where we want to demonstrate rigour. The assessment explicitly permits a mock. |
| **Single long transaction spanning the payment call** | See the callout in FR-5. Actively harmful under load. |
| **Offset pagination** | See FR-7. |
| **`SERIALIZABLE` isolation for inventory** | Correct but pushes retry handling into every caller and performs worse than explicit, deterministically-ordered row locks for this access pattern. |

---

## 7. Evolution Path

Deliberately deferred, in the order they would actually be needed. Each is
recorded here so the boundary between *v1 scope* and *not understood* is
unambiguous.

| Trigger | Change |
|---|---|
| A second consumer appears (analytics, fraud, a separate inventory service) | Move event publication off PostgreSQL. This reintroduces the dual-write problem, so a real `outbox_events` table and a relay process become mandatory — both contained inside a new `EventPublisher` adapter (NFR-8), with zero changes to domain code. **AWS SQS is the first choice here**: managed, durable, native DLQ, and no broker to operate. |
| Cross-team, cross-service event streaming with replay | Kafka, fed from the outbox via CDC (Debezium) rather than from application code. |
| Order fulfilment becomes a genuinely long-running, multi-step business process (returns, partial shipments, supplier backorders) | Temporal. The three-phase saga in FR-5 is the right size for the current process; Temporal earns its complexity only once the process outlives a single request by a long margin. |
| Inventory contention on a single warehouse becomes the bottleneck (NFR-7) | Shard by warehouse; consider reservation batching. |
| Order volume outgrows a single table | Partition `orders` by `created_at`; the keyset pagination in FR-7 already aligns with that. |

The design keeps these open cheaply: the domain publishes events through a port
and knows nothing about transport, so the first three are adapter-level changes.

---

## 8. Success Criteria

The deliverable is done when:

1. `docker compose up` produces a working system from a clean clone.
2. A `curl` command creates an order, and the response shows the correct warehouse
   was chosen — demonstrably the closest among those with full stock.
3. The concurrency script in NFR-1 proves no overselling.
4. Every failure branch in FR-1 is reproducible on demand via the seeded test data.
5. A single Grafana trace shows one order end to end, across API, database,
   geocoding, payment and background job.
6. The `README` explains the design in a way that stands on its own.

---

## 9. Open Questions

| # | Question | Current position |
|---|---|---|
| Q-1 | Should the distance ranking use road distance rather than great-circle? | Great-circle. Road distance requires a routing API, which is out of scope and would be mocked anyway — adding no signal. |
| Q-2 | Should reservations survive a `PENDING_PAYMENT` timeout, or release immediately on provider timeout? | Survive until TTL (15 min), then reconcile. Releasing immediately risks releasing stock for an order that was actually charged. |
| Q-3 | Does the assessment expect a shipment concept at all? | Not required, but it makes the warehouse selection *mean* something and costs one table. Kept minimal. |
| Q-4 | Should `GET /orders` be excluded as out-of-scope? | No. Without a read path the reviewer cannot verify the write path. Justified in §2.1. |
| Q-5 | Is a queue justified at all for this volume, or is it over-engineering? | Justified, but on *correctness* grounds rather than throughput: the post-confirmation effects must survive a process crash and must retry independently of one another. A durable queue is the smallest construct that gives both. It costs no extra infrastructure because it lives in PostgreSQL. |
