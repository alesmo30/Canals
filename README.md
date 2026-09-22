# Canals

An order-fulfilment API: nearest-warehouse selection, an append-only
inventory ledger proved correct under concurrent load, a three-phase
order-creation saga with idempotent payment capture, a Postgres-backed
job queue with retries/DLQs, and the hardening (redaction, reconciliation,
rate limiting, OpenAPI) that makes the whole thing safe to demo.

## Prerequisites

- Docker and Docker Compose (the whole stack — Postgres/PostGIS, the api,
  the worker, a payments mock, Grafana/Tempo — runs in containers; nothing
  else needs to be installed to get an order through).
- Node.js `22.x` and npm — only needed on the host to run `npm run demo`,
  `npm run concurrency-e2e` and the other scripts under `scripts/`, which
  talk to the dockerized stack over HTTP/Postgres rather than running
  inside a container themselves.

## Quickstart

```bash
git clone https://github.com/alesmo30/Canals.git
cd Canals
docker compose up -d --build
```

`--build` matters on every pull, not just the first clone: `docker compose
up` alone restarts a container from whatever image it already has, it
does not rebuild it — see *Known limitations*.

Compose brings up Postgres, runs migrations and the seed script (both
one-shot, gated with `service_completed_successfully` — the api and
worker do not start until seeding has actually finished), then starts the
api, the worker and a `payments-mock` test provider. First boot takes
30-60s depending on image build time.

| Port | Service | What's there |
|---|---|---|
| `3000` | `api` | the HTTP API — `POST /orders`, `GET /orders`, `GET /health`, `GET /docs` (OpenAPI) |
| `4000` | `payments-mock` | the test payment provider (see *The four test cards* below) |
| `5432` | `postgres` | Postgres/PostGIS |
| `3001` | `lgtm` (Grafana) | trace/log explorer, no login |
| `4318` | `lgtm` (OTLP) | trace/metric ingest — internal, not something you curl |

`worker` has no port: it only consumes queues (`shipment.create`,
`customer.notify`, `analytics.record`, plus the reaper/reconciliation
cron jobs), it never serves HTTP.

```bash
curl http://localhost:3000/health
# {"status":"ok","info":{},"error":{},"details":{}}
```

## Your first order

The seed script (already run by compose) creates a fixed customer and a
small catalogue with real stock, so this works against a clean clone with
no setup:

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{
    "customerId": "c0000000-0000-0000-0000-000000000001",
    "shippingAddress": {
      "recipient": "Ada Lovelace",
      "line1": "1 Canal St",
      "city": "Newark",
      "state": "NJ",
      "country": "US"
    },
    "items": [{ "productId": "b0000000-0000-0000-0000-000000000001", "quantity": 1 }],
    "payment": { "cardNumber": "4242424242424242" }
  }'
```

`201`, `status: "CONFIRMED"`, and a `warehouse` object naming the DC that
filled it (Newark DC — it has the stock and it's the nearest one to a
Newark, NJ address). Replay the exact same body with the exact same
`Idempotency-Key` and you get the identical `201` back, byte-for-byte,
with no second charge and no second order — that's what the header is
for.

## Design

**Why three phases, not one transaction.** `POST /orders` runs Phase 1
(geocode the address, select the nearest warehouse that can fill every
line, reserve the stock — one short DB transaction), then Phase 2
(charge the payment gateway — a network call to a provider that can hang
for tens of seconds, deliberately *outside* any open transaction: holding
a row lock across a slow or dead HTTP call would let one stuck order
starve every other order contending on the same inventory row), then
Phase 3 (settle: commit or release the reservation, transition the order,
publish `order.confirmed` — one more short transaction, via
`OrderSettlementService`). The reaper and reconciliation jobs
(`specs/07-hardening-demo.md`) call that same `OrderSettlementService`
for the two ways Phase 2 can end ambiguously — the provider times out, or
the process dies between charging and settling — so there is exactly one
implementation of "settle this order," row-locked, everywhere.

**Why warehouse selection is one statement.** `select-warehouse.sql`
resolves which warehouses can fill every line of the order (an `eligible`
CTE) before it ever touches distance, then sorts only that small,
already-qualified set by geodesic distance. Doing it as "find candidates,
then rank them" in application code would mean reading full warehouse
rows into Node before knowing most of them can't even fill the order; a
single statement lets Postgres discard the ineligible ones without ever
materialising them. The captured `EXPLAIN` plan and why the planner
doesn't just walk the GiST location index directly are in *P1 —
Fulfilment core* below.

**Why the queue lives in Postgres.** `pg-boss` stores every job as a row
in the same database the order was written to. `order.confirmed`'s
fan-out (`shipment.create`, `customer.notify`, `analytics.record`) is
three job inserts in the *same transaction* as the order's own state
transition — a job exists if and only if the order state it describes
was actually committed, with no second system (Redis, RabbitMQ, SQS) to
keep consistent with Postgres by hand, and no outbox-polling relay in
between. The cost is a worker that polls (every
`PGBOSS_POLL_INTERVAL_SECONDS`, backed by `LISTEN`/`NOTIFY` for low
latency in between polls) rather than a push-based broker — a deliberate
trade documented in `specs/04-queue-worker-observability.md`.

## Commands

```bash
docker compose up -d --build      # start (or rebuild + restart) the whole stack
docker compose logs -f api worker # tail application logs
docker compose down -v            # tear down, including the Postgres volume

npm install                       # only needed to run the scripts below locally
npm run lint / build              # rm -rf dist first if a stale build confuses lint's glob
npm run test:unit                 # no DB needed
npm run test:integration          # needs a migrated Postgres reachable
npm run test:e2e                  # needs the full stack reachable
npm run concurrency-check         # P1's ledger proof, in-process — `-- 50` for N=50
npm run concurrency-e2e           # P6's ledger proof, through real HTTP — see below
npm run payments-check            # exercises all four payments-mock cards through HttpPaymentGateway
npm run events-check              # publishes order.confirmed, waits for the 3 jobs + 1 shipment it produces
npm run demo                      # walks every scenario below end-to-end, twice green on a fresh `docker compose up`
npm run verify                    # everything above, in the order CI expects
```

The scripts under `scripts/` run on the host against the dockerized stack
over `DATABASE_URL`/`PAYMENTS_URL`/etc, not inside a container — copy
`.env.example` to `.env` and export it first:

```bash
cp .env.example .env
set -a && source .env && set +a
```

## P1 — Fulfilment core: warehouse selection and stock reservation

specs/02-fulfilment-core.md. FR-2's nearest-warehouse selection and the
reservation ledger (`reserve` / `release` / `commit`), proved against
concurrent load. Driven from tests and scripts only — no HTTP endpoint
yet (`POST /orders` is P4).

### The selection query and its captured plan

`src/infrastructure/database/sql/select-warehouse.sql` returns the top 3
warehouses able to supply every requested line, ordered by geodesic
distance. With the `inventory`/`products` join present, the planner does
**not** drive the ordering off `idx_warehouses_location_gist` — reproduced
with 500 synthetic warehouses and fresh `ANALYZE` statistics, at both
partial and full selectivity. The query applies the documented fallback
instead: an `eligible` CTE resolves which warehouse ids can supply every
line first (C-6's `HAVING`), then only that small set is joined back to
`warehouses` — by primary key, never a sequential scan — and sorted by
distance. Condensed captured plan (full JSON logged by
`warehouse-selection.explain.integration.spec.ts`; see
`specs/02-fulfilment-core.md`'s Decisions for the complete writeup):

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

`warehouses` is reached exactly once, by primary key, for the handful of
ids the `eligible` CTE resolved — never a scan over the full table.

### The ledger replay

`src/infrastructure/database/sql/verify-ledger.sql` reconstructs every
`inventory` balance from `inventory_movements` and returns only the rows
that disagree. Not a `SUM(quantity_delta)`: that column only tracks
`quantity_available`'s own per-movement change (no equivalent for
`quantity_reserved` — `COMMIT`'s delta is `0` even though `reserved`
drops), and a row's starting stock is a direct `INSERT`, never a
movement, so a bare sum has no anchor. Every movement already carries the
full post-movement balance in `available_after`/`reserved_after` — the
latest one, per `(warehouse_id, product_id)`, *is* the replayed balance:

```sql
WITH latest_movement AS (
  SELECT DISTINCT ON (warehouse_id, product_id)
    warehouse_id, product_id, available_after, reserved_after
  FROM inventory_movements
  ORDER BY warehouse_id, product_id, id DESC
)
SELECT
  i.warehouse_id, i.product_id,
  lm.available_after AS expected_available, i.quantity_available AS actual_available,
  lm.reserved_after AS expected_reserved, i.quantity_reserved AS actual_reserved
FROM inventory i
JOIN latest_movement lm ON lm.warehouse_id = i.warehouse_id AND lm.product_id = i.product_id
WHERE i.quantity_available <> lm.available_after
   OR i.quantity_reserved <> lm.reserved_after;
```

Runnable directly in `psql`, no Jest required:

```bash
docker compose exec postgres psql -U canals -d canals -f - < src/infrastructure/database/sql/verify-ledger.sql
```

### The concurrency proof

```bash
npm run concurrency-check        # N = 5
npm run concurrency-check -- 50  # N = 50
```

Seeds a fixed product with exactly `N` units, fires `N + 20` concurrent
reservation attempts against a shared start signal (so every attempt
contends on the same `inventory` row, not on connection availability),
commits every winner immediately, then reports the result:

```
--- concurrency-check ---
N = 5, attempts = 25
successes = 5, failures = 20
final balances: quantity_available = 0, quantity_reserved = 0
verify-ledger.sql discrepancies = 0
PASSED
```

Exactly `N` succeed, exactly 20 fail with `InsufficientStockError`, never
`N + 1` — `reserve`'s `SELECT ... FOR UPDATE ORDER BY product_id` under a
3-second `lock_timeout` is what the run is proving. Re-running (at any
`N`) gives the same shape of result: the script resets its own fixture's
stock and movements before each run.

## P2 — External adapters: payment gateway, geocoding

specs/03-external-adapters.md. `HttpPaymentGateway` against a standalone
`payments-mock` service, a deterministic `StaticGeocodingProvider`
(default) and an opt-in `GeoapifyGeocodingProvider`, both behind
`retry.ts`'s full-jitter backoff and `circuit-breaker.ts`'s per-provider
breaker. Every provider failure ends in a typed, reproducible outcome
within a bounded time, and no card number ever reaches a log.

### `payments-mock` — the four test cards

Outcomes are keyed on the card's last four digits. All four numbers are
Luhn-valid, so P4's DTO can validate them without breaking this table.

| Card | Outcome | `HttpPaymentGateway` result |
|---|---|---|
| `4242424242424242` | `200` approved, 200–600 ms | `CAPTURED` |
| `4000000000000002` | `402` declined | `DECLINED` / `CARD_DECLINED` |
| `4000000000090003` | `500` provider error | `UNKNOWN` / `PROVIDER_ERROR` |
| `4000000000080004` | hangs ~30 s (recorded as approved) | `UNKNOWN` / `TIMEOUT` |

Try them directly once `docker compose up` has `payments-mock` healthy
(port `4000`):

```bash
curl -X POST http://localhost:4000/charge \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-1' \
  -d '{"cardNumber":"4242424242424242","amountCents":9900,"currency":"USD","description":"Demo"}'
```

Or run all four through the real adapter — retries, timeouts and
`describeCard()` included:

```bash
npm run payments-check
```

Each card there gets its own `HttpPaymentGateway` (and so its own
breaker): 0003 and 0004 each exhaust all 3 attempts on their own, and
sharing one breaker across both in a single run would open it mid-way
through 0004, turning its `TIMEOUT` into `CIRCUIT_OPEN` — not what the
script is there to prove. A real client sharing one gateway across
orders (P4's `POST /orders`, or the walkthrough below) does **not** get
this isolation, which is the point of the next section.

### The breaker across repeated failures — `docker compose stop payments-mock`

`HttpPaymentGateway.charge()` and `getStatus()` share one
`CircuitBreaker`, counting each failed **attempt**, not each call. With
`payments-mock` stopped, two orders using card `0003` or `0004` — three
failed attempts each — are enough to cross `BREAKER_FAILURE_THRESHOLD`
(5) partway through the second one. That is correct, load-shedding
behaviour, not a bug: retrying against a provider that is provably down
wastes ~7 s per order for nothing. It is proven by
`circuit-breaker.spec.ts` (a fake clock, no real 30 s wait) and by
`http-payment-gateway.spec.ts`'s "shared breaker" test, which reproduces
exactly this sequence against a real, stopped `node:http` server.

To see the mock itself go down and come back:

```bash
docker compose up -d
curl http://localhost:4000/health          # {"status":"ok"}

docker compose stop payments-mock
curl http://localhost:4000/charge -X POST \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-2' \
  -d '{"cardNumber":"4242424242424242","amountCents":9900,"currency":"USD","description":"Demo"}'
# curl: (7) Failed to connect — the port stopped accepting connections.
# Through HttpPaymentGateway this is CONNECTION_REFUSED, retried, and
# (per the ordering above) can open the breaker for every card for 30 s.

docker compose start payments-mock
# ~5s for the healthcheck; a probe after the breaker's 30 s window
# succeeds and closes it again, no api/worker restart needed.
```

**Demo order matters.** Run the happy-path cards (`4242…`, `4000…0002`)
first; save `0003`/`0004` for last, or wait 30 s between them. Two
consecutive `0003` orders alone are enough to open the breaker for
every card, including the ones that would otherwise succeed.

### Geocoding: static by default, Geoapify opt-in

`GEOCODING_DRIVER` (default `static`) picks the adapter in
`SharedModule`; nothing else in the app branches on it. Either driver is
wrapped in an in-memory LRU cache (10,000 entries, no TTL, keyed by the
normalised address).

**`StaticGeocodingProvider`** — the default, and what `docker compose up`
uses with no `.env` at all. A table of 32 US cities plus a deterministic
`sha256` jitter of up to ±0.05° (~5 km) — enough to keep the nearest-
warehouse choice verifiable by hand, since warehouses sit hundreds of km
apart. It logs a boot warning: **it is for demo and test use only.**

Supported cities (`city, STATE`; `Portland` needs a state — both `OR`
and `ME` are in the table, deliberately, to prove the ambiguity rule):

```
Newark, NJ · Los Angeles, CA · Dallas, TX · Chicago, IL · Miami, FL
New York, NY · Philadelphia, PA · San Diego, CA · Houston, TX
Milwaukee, WI · Orlando, FL · Seattle, WA · Denver, CO
Portland, OR · Portland, ME · Boston, MA · Atlanta, GA · Phoenix, AZ
San Francisco, CA · Austin, TX · San Antonio, TX · Charlotte, NC
Columbus, OH · Indianapolis, IN · San Jose, CA · Detroit, MI
Nashville, TN · Memphis, TN · Baltimore, MD · Las Vegas, NV
Minneapolis, MN · New Orleans, LA
```

Limits: any other city, an ambiguous city with no state, or a non-US
country throws `GeocodingFailedError('UNKNOWN_ADDRESS')` — there is no
fallback point, since an arbitrary guess would persist a fake location
as if it were real. `state` is optional in `ShippingAddress`, so with no
state a city resolves only when its name is unique in the table.

**`GeoapifyGeocodingProvider`** — opt-in, for a real deployment. Two
lines in a git-ignored `.env` switch to it:

```bash
GEOCODING_DRIVER=geoapify
GEOAPIFY_API_KEY=<your key>
```

`docker compose up` picks both up automatically; `GEOCODING_DRIVER`
unset (or any value other than `geoapify`) keeps the static default, and
the app refuses to boot if `geoapify` is set without a key (Zod
refinement in `env.schema.ts`). A bad or expired key answers `401`/`403`
— logged, never retried, and never counted by the breaker, since a
misconfigured key is not an outage. Geoapify's free tier is 3,000
credits/day; the cache absorbs repeat lookups for the same address.

Geocoding powered by [Geoapify](https://www.geoapify.com/).

## P3 — Queue, worker and observability

specs/04-queue-worker-observability.md. A real `pg-boss` adapter behind
the frozen `EventPublisher` port: `order.confirmed` fans out to three
queues in one transaction, a standalone worker consumes them (the api
never does), and every request and job is a trace in Grafana sharing one
`correlationId`. During P3's own development, a now-removed
`POST /internal/events/order-confirmed` endpoint stood in for P4's
`POST /orders` to trigger this flow before the saga existed; P4 deleted
it, so every walkthrough below goes through the real endpoint instead.

### Queue topology

```
POST /orders
              │  order.confirmed
              ▼
   EVENT_ROUTING fan-out (event-routing.ts)
   one transaction, one job insert per queue
   ┌──────────────┼───────────────────┐
   ▼               ▼                   ▼
shipment.create  customer.notify  analytics.record
   │               │                   │
   ▼               ▼                   ▼
ShipmentCreate-  CustomerNotify-   AnalyticsRecord-
Handler          Handler           Handler
   │ 5 failed attempts (~1 min)
   ▼
shipment.create.dlq          (customer.notify.dlq, analytics.record.dlq — same shape)
```

| Queue | Dead letter | Handler |
|---|---|---|
| `shipment.create` | `shipment.create.dlq` | `ShipmentCreateHandler` |
| `customer.notify` | `customer.notify.dlq` | `CustomerNotifyHandler` |
| `analytics.record` | `analytics.record.dlq` | `AnalyticsRecordHandler` |

Both api and worker create all six queues at boot (idempotent — a restart
creates nothing new); only the worker calls `boss.work()` on them.

### Retries and dead-letter queues

| Setting | Value | Why |
|---|---|---|
| `retryLimit` | `4` | 5 attempts total — pg-boss counts retries *after* the first (R3.5) |
| `retryBackoff` / `retryDelay` / `retryDelayMax` | `true` / `1s` / `60s` | exponential backoff between attempts |
| `DLQ_RETENTION_DAYS` | `30` | a dead-lettered job must outlive a long weekend |

Retries carry no `NOTIFY`, so the 15 s polling interval is the real clock:
a doomed job's five attempts land roughly at t+0s, ~15s, ~30s, ~45s and
~60s, reaching its DLQ about a minute after the first failure. A job
lands in a DLQ on either kind of failure — a handler throwing, or (the
realistic case) `shipment.create` for an order whose `warehouse_id` is
still `NULL` — and stays there indefinitely: DLQs have no consumer, by
design, so nothing is silently retried forever or silently dropped.

### Reading one order as a trace in Grafana

```bash
docker compose up -d
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{
    "customerId": "c0000000-0000-0000-0000-000000000001",
    "shippingAddress": {
      "recipient": "Ada Lovelace", "line1": "1 Canal St",
      "city": "Newark", "state": "NJ", "country": "US"
    },
    "items": [{ "productId": "b0000000-0000-0000-0000-000000000001", "quantity": 1 }],
    "payment": { "cardNumber": "4242424242424242" }
  }'
# 201, and an X-Correlation-Id response header
```

Open **http://localhost:3001** (Grafana, no login needed —
`grafana/otel-lgtm`'s default). Explore → data source **Tempo** → Search
tab → `Service Name` = `canals-api`, `Span Name` = `POST` finds the
request trace. Do the same with `Service Name` = `canals-worker` to find
the three `job shipment.create` / `job customer.notify` / `job
analytics.record` traces that same request produced.

Each job trace is its **own** trace, not a child span of the request —
`JobRunner` opens it with `root: true` (job-runner.ts) because pg-boss's
own fetch loop is an unrelated, unrooted context by the time the handler
runs. What connects it back is a **span link** to the request's span,
captured from the `traceparent` `PgBossEventPublisher` stamps into the
job's `meta` at publish time (W3C trace context, not a custom header).
Opening a job trace in Grafana and expanding its root span's "Links"
panel shows the originating request trace — that is the mechanism behind
the phase's AC 5 deviation ("linked traces sharing one `correlationId`",
not one single trace: a job can run seconds or minutes after the request
that queued it, so nesting it inside that request's trace would leave
the request's own span artificially open).

Each job trace also contains the `pg` spans its handler produced (e.g.
`ShipmentCreateHandler`'s insert) — `context.with()` around the handler
call is what nests them there instead of them showing up as orphans
outside any job trace.

### The `X-Correlation-Id` walkthrough

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: '"$(uuidgen)" \
  -H 'X-Correlation-Id: demo-correlation-1' \
  -d '{
    "customerId": "c0000000-0000-0000-0000-000000000001",
    "shippingAddress": {
      "recipient": "Ada Lovelace", "line1": "1 Canal St",
      "city": "Newark", "state": "NJ", "country": "US"
    },
    "items": [{ "productId": "b0000000-0000-0000-0000-000000000001", "quantity": 1 }],
    "payment": { "cardNumber": "4242424242424242" }
  }'
# X-Correlation-Id: demo-correlation-1  — echoed back unchanged
```

Omit the header and the api generates one (a UUID) instead — either way
it comes back on the response and travels with every job the request
enqueues (`meta.correlationId` in the job envelope). Grep the api's and
the worker's logs for it and every line the request and its three jobs
produced comes back, each carrying its own `trace_id`/`span_id` but the
same `correlationId`:

```bash
docker compose logs api worker | grep demo-correlation-1
```

This is what a support ticket ("order X never shipped") actually gets
searched by: `correlationId` is a plain string an operator can paste
into a log query with no tracing backend involved, while the linked
traces above are what a developer opens afterwards to see *where* in
that request's timeline the time went.

### Inspecting and reprocessing a DLQ job

Inspect (the job's `data` is the same `{ payload, meta }` envelope every
handler receives, plus `payload`; `output` is pg-boss's own record of the
last failure):

```bash
docker exec -it canals-postgres-1 psql -U canals -d canals -c \
  "SELECT id, data, output->>'message' AS last_error
   FROM pgboss.job
   WHERE name = 'shipment.create.dlq'
   ORDER BY created_on DESC LIMIT 5;"
```

There is no reprocessing tool (Scope — "P3 does not build one"): a DLQ
job sits there until a human replays it, deliberately, once whatever it
was proving is fixed. Fix the underlying issue first (here, the realistic
case: give the order a `warehouse_id`), then re-`send` the DLQ job's own
`data` back onto its original queue:

```bash
JOB_ID=<id from the query above>
DATA=$(docker exec canals-postgres-1 psql -U canals -d canals -t -A -c \
  "SELECT data FROM pgboss.job WHERE id = '$JOB_ID'")

DATABASE_URL=postgres://canals:canals@localhost:5432/canals \
  node --input-type=module -e "
import { PgBoss } from 'pg-boss';
const data = JSON.parse(process.argv[1]);
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
await boss.start();
console.log('re-queued as', await boss.send('shipment.create', data));
await boss.stop({ close: true });
" "$DATA"
```

The original DLQ row is left in place — it is the paper trail that this
happened and was replayed, not a queue slot to be cleared — and the
worker picks the new job up within one polling interval. `pg-boss`'s own
`--input-type=module` is required because `pg-boss@12` ships ESM-only; a
plain `require('pg-boss')` throws `ERR_REQUIRE_ESM`.

## P6 — Hardening and demo: every failure path

specs/07-hardening-demo.md. `npm run demo` walks all ten scenarios below
against a live stack and exits `0` when every one of them produced its
documented output — including the final log grep proving no card number
or secret ever reached a log line. Each scenario is independently
try/caught, so one failure doesn't stop the rest from running. What
follows is the same walkthrough, one `curl` at a time, against the same
seed data as *Your first order* above.

| # | Scenario | Expected |
|---|---|---|
| 1 | Happy path | `201`, `CONFIRMED`, `warehouse.name`/`distanceMeters` present |
| 2 | Declined card (`…0002`) | `402`, stock released back |
| 3 | Provider timeout (`…0004`) | `502` with `orderId`, order `PENDING_PAYMENT`, reservation held |
| 4 | Reaper resolves (3) | order (3) reaches `CONFIRMED` within ~75s of its reservation expiring |
| 5 | Provider down | `502` on two orders, breaker opens (second one fails faster) |
| 6 | Mock restarted, (5)'s orders expire | both reach `CANCELLED`, stock back to pre-(5) balance |
| 7 | Unsatisfiable order | `422` |
| 8 | Duplicate `Idempotency-Key` | identical `201` body, exactly one `payments` row |
| 9 | `concurrency-e2e` | exactly N `201 CONFIRMED`, 20 `422`/`409`, ledger reconciles |
| 10 | Log grep | no test card number, no `GEOAPIFY_API_KEY` value, anywhere in `docker compose logs` |

**1 — happy path.** *Your first order*, above, already is this scenario.

**2 — declined card.**

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{"customerId":"c0000000-0000-0000-0000-000000000001","shippingAddress":{"recipient":"Ada Lovelace","line1":"1 Canal St","city":"Newark","state":"NJ","country":"US"},"items":[{"productId":"b0000000-0000-0000-0000-000000000001","quantity":1}],"payment":{"cardNumber":"4000000000000002"}}'
# 402 payment-declined; GET the inventory back and it's unchanged.
```

**3 — provider timeout, `502` with `orderId`.**

```bash
RESPONSE=$(curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{"customerId":"c0000000-0000-0000-0000-000000000001","shippingAddress":{"recipient":"Ada Lovelace","line1":"1 Canal St","city":"Newark","state":"NJ","country":"US"},"items":[{"productId":"b0000000-0000-0000-0000-000000000001","quantity":1}],"payment":{"cardNumber":"4000000000080004"}}')
echo "$RESPONSE"
ORDER_ID=$(echo "$RESPONSE" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).orderId))")

curl http://localhost:3000/orders/$ORDER_ID
# status: "PENDING_PAYMENT" — the reservation is still held, do not
# retry with a new Idempotency-Key (the body says so).
```

**4 — the reaper resolves it.** The real TTL is 15 minutes
(`RESERVATION_TTL_MINUTES`); the demo shortens it by moving
`reservation_expires_at` into the past, documented as exactly that — a
shortcut, not a different constant:

```bash
docker compose exec postgres psql -U canals -d canals -c \
  "UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = '$ORDER_ID'"

# wait up to ~75s for the reaper's next cron tick, then:
curl http://localhost:3000/orders/$ORDER_ID
# status: "CONFIRMED" — payments-mock did record the charge; getStatus()
# told the reaper so.
```

**5 — provider down, breaker opens.**

```bash
docker compose stop payments-mock

curl -s -o /dev/null -w '%{http_code} in %{time_total}s\n' -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{"customerId":"c0000000-0000-0000-0000-000000000001","shippingAddress":{"recipient":"Ada Lovelace","line1":"1 Canal St","city":"Newark","state":"NJ","country":"US"},"items":[{"productId":"b0000000-0000-0000-0000-000000000001","quantity":1}],"payment":{"cardNumber":"4242424242424242"}}'
# 502, ~7s (3 retried attempts)

curl -s -o /dev/null -w '%{http_code} in %{time_total}s\n' -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{"customerId":"c0000000-0000-0000-0000-000000000001","shippingAddress":{"recipient":"Ada Lovelace","line1":"1 Canal St","city":"Newark","state":"NJ","country":"US"},"items":[{"productId":"b0000000-0000-0000-0000-000000000001","quantity":1}],"payment":{"cardNumber":"4242424242424242"}}'
# 502, near-instant — the breaker is already open (see P2's
# "breaker across repeated failures" above), record both orderIds.
```

**6 — restart, both orders expire, reaper cancels.**

```bash
docker compose start payments-mock
# ~5s healthcheck + the breaker's own 30s cooldown before getStatus()
# sees the real 404 instead of CIRCUIT_OPEN.

docker compose exec postgres psql -U canals -d canals -c \
  "UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id IN ('<order A>', '<order B>')"

# wait for the reaper's next tick(s), then:
curl http://localhost:3000/orders/<order A>
curl http://localhost:3000/orders/<order B>
# status: "CANCELLED" on both — payments-mock never recorded either
# charge (it was down), and stock is back to its pre-scenario-5 balance.
```

**7 — unsatisfiable order.**

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: '"$(uuidgen)" \
  -d '{"customerId":"c0000000-0000-0000-0000-000000000001","shippingAddress":{"recipient":"Ada Lovelace","line1":"1 Canal St","city":"Newark","state":"NJ","country":"US"},"items":[{"productId":"b0000000-0000-0000-0000-000000000001","quantity":999999}],"payment":{"cardNumber":"4242424242424242"}}'
# 422 no-fulfilment-possible — no warehouse anywhere has that much stock.
```

**8 — duplicate `Idempotency-Key`.**

```bash
KEY=$(uuidgen)
BODY='{"customerId":"c0000000-0000-0000-0000-000000000001","shippingAddress":{"recipient":"Ada Lovelace","line1":"1 Canal St","city":"Newark","state":"NJ","country":"US"},"items":[{"productId":"b0000000-0000-0000-0000-000000000001","quantity":1}],"payment":{"cardNumber":"4242424242424242"}}'

curl -s -X POST http://localhost:3000/orders -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" > first.json
curl -s -X POST http://localhost:3000/orders -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" > replay.json
diff <(jq -S . first.json) <(jq -S . replay.json)
# no output — field-for-field identical, and exactly one payments row
# exists for that order (the second POST never re-charged the card).
```

**9 — the concurrency proof, through HTTP.**

```bash
npm run concurrency-e2e
```

Same shape as P1's `concurrency-check`, but fired at `POST /orders` over
real HTTP against its own dedicated fixture (one product, exactly `N`
units, nowhere else) instead of calling the reservation code directly —
this is the proof that the guarantee survives the full stack: routing,
validation, the saga, the idempotency layer, all of it. Exactly `N`
orders reach `201 CONFIRMED`, the rest `422`/`409`, never `N + 1`.

**10 — the log grep.**

```bash
docker compose logs | grep -E '4242424242424242|4000000000000002|4000000000090003|4000000000080004'
docker compose logs | grep "$GEOAPIFY_API_KEY"   # only meaningful if GEOAPIFY_API_KEY is set
# both empty — Fix A's redaction (pino message hook + RedactingSpanExporter)
# is what this proves: every log line and every exported span attribute,
# including ones built from a raw string or a thrown Error, is masked.
```

All ten, automated, exiting `0` twice in a row on a fresh
`docker compose up`:

```bash
npm run demo
```

## Known limitations

Findings from the post-P5 audit that this phase deliberately did not
fix, and scope this phase deliberately left out — not silently dropped,
each has a reason:

- **A generic `500` is stored as `COMPLETED` in `idempotency_keys`,
  replayed forever.** Only `402`/`502` get the "pending confirmation"
  treatment (Fix C); any other failure mode is recorded and replayed
  as-is. Left to a future spec to decide what a non-terminal failure
  should mean for a replay.
- **Re-posting an expired `Idempotency-Key` returns `500`**, and a row
  left `IN_PROGRESS` by a crash blocks its key until it expires (24h).
  SPEC 05 handed the post-expiry semantics to this phase; this phase
  defers the decision again, explicitly, rather than inheriting it by
  accident — the reaper this phase adds only resolves *orders*, it does
  not purge expired `idempotency_keys` rows.
- **`GET /orders`'s cursor `500`s on a non-UUID id**, and its millisecond
  precision doesn't quite match `created_at`'s microsecond precision —
  a page boundary that lands exactly on a repeated timestamp can, in
  principle, skip or repeat a row.
- **`RESERVATION_TTL_MINUTES` is validated but nothing reads it** — the
  reaper's actual window is `reservation_expires_at`, set by the saga at
  order-creation time; the env var and the column are not wired together
  today.
- **`verify-ledger.sql` compares snapshots, not a full replay** of
  `inventory_movements` from an empty state — it catches divergence, not
  every way the ledger could have arrived somewhere wrong.
- **Application → infrastructure imports aren't lint-enforced**, and the
  HTTP-client lint barrier (`references/layering.md`) doesn't catch a
  bare global `fetch` or `node:http` call from the wrong layer.
- **No `healthcheck` on the `api` compose service** — `depends_on` gates
  on `seed`/`payments-mock`, not on the api's own readiness.
- **Expired `idempotency_keys` rows are never physically purged.**
- **No nginx / multi-instance run of the concurrency proof** — there is
  no nginx profile in `docker-compose.yml`; `concurrency-e2e` runs
  against a single api instance. Adding a second instance behind a
  reverse proxy is its own change.
- **Deployment is out of scope** (phases/06, explicitly dropped).
- **`POST /orders/bulk` (FR-10) is not built.** It's gated on FR-1
  through FR-9 being complete and hardened, and it's a materially bigger
  feature than it looks: every order in a batch does its own geocoding,
  warehouse selection, inventory locking and payment call, so even a
  capped batch of 25 can hold locks and burn provider quota for a real
  stretch.
- **`PATCH /orders/:id` (FR-11) is not built.** Same gate as FR-10. The
  fields it *could* safely edit (recipient name, address line 2,
  delivery notes) don't touch stock or money; anything that does
  (`items`, the shipping city) would mean re-running warehouse selection
  and re-reserving stock — a materially larger feature, deferred rather
  than half-built.

## `payments-mock` keeping charges only in memory

One demo-specific risk worth calling out on its own: `payments-mock`
keeps every charge in memory, so after a restart `getStatus()` answers
`404` for a charge it actually did make — the reaper would then release
stock for an order that *was* paid for. This is a mock-only problem (a
real provider persists charges); the demo above resolves scenario 3's
order (which really was charged, via `getStatus()`) *before* it ever
stops `payments-mock` in scenario 5. Run steps 5/6 before step 3/4 and
you will reproduce this exact false release — that's the mock's
limitation showing, not a bug in the reaper.
