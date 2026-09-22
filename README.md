<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
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

### The breaker across repeated failures — `docker stop payments-mock`

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

docker stop payments-mock
curl http://localhost:4000/charge -X POST \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-2' \
  -d '{"cardNumber":"4242424242424242","amountCents":9900,"currency":"USD","description":"Demo"}'
# curl: (7) Failed to connect — the port stopped accepting connections.
# Through HttpPaymentGateway this is CONNECTION_REFUSED, retried, and
# (per the ordering above) can open the breaker for every card for 30 s.

docker start payments-mock
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
`correlationId`. `POST /internal/events/order-confirmed` was a
development-only stand-in for P4's `POST /orders`, used to trigger this
flow before the saga existed; P4 deleted it — `POST /orders` (below)
publishes `order.confirmed` for real now.

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
curl -X POST localhost:3000/internal/events/order-confirmed \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"<an existing order id with a warehouse_id set>"}'
# 202, and an X-Correlation-Id response header
```

Open **http://localhost:3001** (Grafana, no login needed —
`grafana/otel-lgtm`'s default). Explore → data source **Tempo** → Search
tab → `Service Name` = `canals-api`, `Span Name` = `POST` finds the
request trace. Do the same with `Service Name` = `canals-worker` to find
the three `job shipment.create` / `job customer.notify` / `job
analytics.record` traces the same request produced.

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
curl -i -X POST localhost:3000/internal/events/order-confirmed \
  -H 'Content-Type: application/json' \
  -H 'X-Correlation-Id: demo-correlation-1' \
  -d '{"orderId":"<order id>"}'
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

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
