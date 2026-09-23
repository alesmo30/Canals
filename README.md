# Canals

[![Tests](https://github.com/alesmo30/Canals/actions/workflows/tests.yml/badge.svg)](https://github.com/alesmo30/Canals/actions/workflows/tests.yml)
![Node.js 22](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![PostgreSQL 16 + PostGIS](https://img.shields.io/badge/PostgreSQL-16%20%2B%20PostGIS%203.4-4169E1?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)

Order management API for an online store that sells Apple products. It creates orders, picks the closest warehouse that can ship every item, reserves stock without overselling, charges the card through an external payment provider and hands the follow-up work (shipment, notification, analytics) to a background worker.

> **Technical documentation**
>
> The **Canals Technical Guide** (architecture, the full execution path of an order, and every design decision with its trade-offs) is available as **HTML and PDF** here:
> **[Google Drive: Canals technical guide](https://drive.google.com/drive/folders/1Oszyk632ON4OGZTx8MmNBXFyeSnCCUvi?usp=sharing)** (**Must take a look**)
>
> The same Drive folder also has a **Postman collection (JSON)**: import it into Postman to run every endpoint and failure scenario without writing `curl` by hand.
>
> The live ER diagram is on [dbdiagram.io](https://dbdiagram.io/d/Canalspregunta-6aa9a81baf7c3b0bd1e7b378).

> **Beta: Canals Console (web UI)**
>
> A browser console for the API is implemented as a **beta** on the [`feat/console`](https://github.com/alesmo30/Canals/tree/feat/console) branch. It is a small React app (Vite + MUI) for reviewers who would rather click than `curl`:
>
> - **Try endpoints in a few clicks.** Guided forms for `POST /orders`, `GET /orders` and `GET /orders/:id`, pre-filled with the seeded customer. Pick a test card to choose the outcome (`4242` → `201`, `0002` → `402`, `0003`/`0004` → `502`); products and cities carry hints for the `422` scenarios. The `Idempotency-Key` is generated for you (or reused, to replay a request).
> - **Every execution logged.** Status, duration, order id and `X-Correlation-Id` of each request, with the full request and response.
> - **Request timeline.** A visual lifecycle of each order from the new `GET /orders/:id/timeline` endpoint: Idempotency → Reserve → Charge → Settle → Fan-out jobs → Fulfilment, plus every event in order. It refreshes while anything is pending, so a `0004` order visibly settles when the reconciliation job runs. "View trace in Grafana" opens Tempo filtered by the correlation id.
>
> To run it: `git checkout feat/console && docker compose up -d --build`, then open **http://localhost:5173** (the api stays on `:3000`). Details are in that branch's README and in the **[step by step guide here](https://drive.google.com/file/d/1Rw99X7RFs4mq82m0yGZiD_hj6g7FNTDv/view?usp=sharing)**, section "Canals Console".

Built by **Alejandro Estrada Moscoso** ([alejandro.estradam@udea.edu.co](mailto:alejandro.estradam@udea.edu.co)) as the Canals backend assessment.

## Table of contents

- [Features](#features)
- [Quickstart](#quickstart)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [API](#api)
- [Seed data and test cards](#seed-data-and-test-cards)
- [Configuration](#configuration)
- [Development and testing](#development-and-testing)
- [CI and contributing](#ci-and-contributing)
- [Design decisions](#design-decisions)
- [Further reading](#further-reading)
- [Known limitations](#known-limitations)

## Features

- **`POST /orders`** with a required `Idempotency-Key`: a retried request never creates a second order or a second charge.
- **Single-warehouse fulfilment, closest first.** One SQL statement finds the warehouses that can ship *every* line and ranks them by geodesic distance (PostGIS).
- **No overselling under concurrency.** Row locks in a fixed order, a re-check under the lock and an append-only inventory ledger, proven by a concurrency test (N units, N + 20 simultaneous orders, never N + 1).
- **Three-phase saga.** Reserve, charge (with no transaction open) and settle, so a slow payment provider never holds a database lock.
- **Resilient payment calls.** 2 s timeout per attempt, 3 attempts with full-jitter backoff, and a circuit breaker per provider.
- **Self-healing background jobs.** A reservation reaper and a payment reconciliation job settle orders whose payment outcome was unknown.
- **Transactional events.** `order.confirmed` jobs are inserted in the same commit as the order, using a Postgres-backed queue (pg-boss) with retries and dead-letter queues.
- **Observability.** `X-Correlation-Id` on every log line and job, OpenTelemetry traces in Grafana Tempo, card numbers redacted everywhere.
- **Read side.** `GET /orders` with keyset pagination and `GET /orders/:id` with payments and shipment.

## Quickstart

**Prerequisites:** Docker with Docker Compose. Node.js `22.x` and npm are only needed to run the verification scripts from your machine.

```bash
git clone https://github.com/alesmo30/Canals.git
cd Canals
docker compose up -d --build
curl http://localhost:3000/health     # {"status":"ok","info":{},"error":{},"details":{}}
```

Compose starts Postgres, runs the migrations and the seed as one-shot containers, then starts the api, the worker and the payments mock. The first boot takes 30 to 60 seconds. Use `--build` after every pull: `docker compose up` alone reuses the old image.

| Port | Service | What is there |
|---|---|---|
| `3000` | `api` | the HTTP API and the OpenAPI UI at [`/docs`](http://localhost:3000/docs) |
| `4000` | `payments-mock` | the fake payment provider |
| `5432` | `postgres` | PostgreSQL 16 + PostGIS 3.4 |
| `3001` | `lgtm` | Grafana (Tempo traces), no login |
| `4318` | `lgtm` | OTLP ingest (internal) |

### Your first order

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "customerId": "c0000000-0000-0000-0000-000000000001",
    "shippingAddress": {
      "recipient": "Ada Lovelace",
      "line1": "600 Harbor Dr",
      "city": "San Diego",
      "state": "CA",
      "country": "US"
    },
    "items": [{ "productId": "b0000000-0000-0000-0000-000000000004", "quantity": 1 }],
    "payment": { "cardNumber": "4242424242424242" }
  }'
```

You get `201` with `status: "CONFIRMED"` and a `warehouse` object: the iPhone 17 is stocked in Newark, Los Angeles and Miami, and **Los Angeles DC** wins because it is about 180 km from San Diego. Send the same body with the same `Idempotency-Key` again and you get the identical response back, with no second order and no second charge.

To walk through every failure path (declined card, provider timeout, provider down, reaper, duplicates, concurrency), run `npm run demo`.

## Tech stack

| Concern | Choice |
|---|---|
| Language and runtime | TypeScript 5.7, Node.js 22 |
| Framework | NestJS 11 |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| Data access | TypeORM for simple reads and writes, raw SQL for concurrency-critical paths |
| Job queue | pg-boss 12 (jobs stored in the same Postgres) |
| Validation | class-validator (request DTOs), zod (environment) |
| HTTP | Helmet, @nestjs/throttler (600 req/min/IP), 16 kB body limit, RFC 9457 errors |
| API docs | @nestjs/swagger at `/docs` |
| Observability | OpenTelemetry, pino (JSON logs), Grafana `otel-lgtm` |
| Mocks | `payments-mock` (Fastify), static geocoder (32 US cities), Geoapify opt-in |
| Tests | Jest, supertest |
| Local infra and CI | Docker Compose, GitHub Actions |

## Architecture

A modular monolith: two application processes built from the same code (`api` and `worker`), one PostgreSQL database, two mocked third parties and a telemetry sink. No Redis, no RabbitMQ, no SQS.

```mermaid
flowchart LR
    client([Client / storefront]) -->|HTTP| api
    subgraph app[Application]
        api[api<br/>src/main.ts :3000]
        worker[worker<br/>src/main.worker.ts]
    end
    api -->|geocode| geo[Geocoding mock<br/>static or Geoapify]
    api -->|charge| pay[payments-mock :4000]
    worker -->|getStatus| pay
    api --> db[(PostgreSQL + PostGIS<br/>business tables + pgboss schema)]
    worker -->|LISTEN/NOTIFY + poll| db
    seed[migrate → seed<br/>one-shot] --> db
    api -. OTLP .-> lgtm[Grafana otel-lgtm]
    worker -. OTLP .-> lgtm
```

| Component | Responsibility | Never does |
|---|---|---|
| `api` | Serves HTTP, runs the order saga, publishes events inside the settling transaction. | Consume jobs, run migrations. |
| `worker` | Consumes `shipment.create`, `customer.notify`, `analytics.record`; runs the reservation reaper and the payment reconciliation every minute. Only `shipment.create` does real work (creates the shipment row); the other two are placeholders that just log. | Serve HTTP (it has no port). |
| `migrate` / `seed` | Apply migrations, then load the mocked demo data, and exit. | Run again once done; api and worker wait for them. |
| `payments-mock` | Fake provider keyed on the card's last four digits; honors the provider idempotency key. | Persist charges (memory only). |
| `postgres` | The single source of truth, including the job queue. | Share state with any other datastore. |
| `lgtm` | Receives traces and metrics. | Sit on the request path. |

**How an order is created.** `POST /orders` runs three short steps instead of one long transaction:

1. **Reserve.** Geocode the address, find up to 3 candidate warehouses, then in a short transaction insert the order and reserve the stock (`FOR UPDATE`, re-checked under the lock, one ledger movement per line).
2. **Charge.** Write a `payments` row first, then call the provider with no transaction open.
3. **Settle.** In one transaction: lock the order, commit or release the stock, move the status, and insert the three `order.confirmed` jobs in the same commit.

If the charge outcome is unknown (timeout, provider down), the client gets `502` with the `orderId`, the order stays `PENDING_PAYMENT`, and the reconciliation (after 2 minutes) or the reaper (after the 15 minute reservation) settles it. The technical guide walks through every step with diagrams.

## Project structure

```
src/
  domain/           entities, value objects, order state machine, ports (no framework code)
  application/      use cases: saga, allocation, settlement, idempotency, job handlers
  infrastructure/   HTTP, TypeORM + raw SQL, pg-boss, payment/geocoding clients, OTel, pino
  modules/          NestJS wiring (SharedModule, ApiModule, WorkerModule)
  main.ts           api entrypoint
  main.worker.ts    worker entrypoint
payments-mock/      standalone fake payment provider (own package)
scripts/            concurrency proofs, payments/events checks, the demo runner
test/               e2e suites
knowledge/          rationale and invariants behind the code, indexed by file
specs/, phases/     the phase plan and the approved spec for each phase
references/         conventions: layering, data integrity, coding, testing
```

Dependencies only point inwards: `infrastructure → application → domain`.

## API

Full OpenAPI description at [`http://localhost:3000/docs`](http://localhost:3000/docs). Every error is an RFC 9457 `application/problem+json` body with `type`, `title`, `status`, `detail`, `instance` and the request's `correlationId`.

| Method | Route | Description |
|---|---|---|
| `POST` | `/orders` | Create an order. Requires `Idempotency-Key: <uuid>`; accepts `X-Correlation-Id`. |
| `GET` | `/orders` | List orders, newest first. Filters: `customerId`, `status`, `warehouseId`, `createdAtFrom`, `createdAtTo`. Keyset pagination with `cursor` and `pageSize` (1 to 100, default 20). |
| `GET` | `/orders/:id` | One order with its items, every payment attempt and the shipment. |
| `GET` | `/health` | Liveness (no dependencies checked, on purpose). |
| `GET` | `/health/ready` | Readiness: database and queue ping, `503` if either fails. |

`POST /orders` responses:

| Status | When |
|---|---|
| `201` | Payment captured, order `CONFIRMED`. Replaying the same key and body returns the same response. |
| `400` | Invalid body (with a per-field `errors` list), unknown field, or a missing or non-UUID `Idempotency-Key`. |
| `402` | Card declined. Order `PAYMENT_FAILED`, stock released. |
| `404` | Customer or product not found (inactive products count as not found). |
| `409` | Lost the stock race on all candidate warehouses, or the same key is still in progress. |
| `413` | Body larger than 16 kB. |
| `422` | No single warehouse can fill the order, the address can't be geocoded, or the key was reused with a different body. |
| `429` | More than 600 requests per minute from one IP. |
| `502` | Payment outcome unknown. The body includes `orderId`: poll `GET /orders/:id` instead of retrying with a new key. |

**Why the `Idempotency-Key` is required.** When a checkout request times out, the client can't tell whether the order was created. The key lets the server recognise the retry and return the original answer instead of charging twice. Use one UUID per checkout attempt and reuse it on every retry of that attempt.

## Seed data and test cards

> **All seed data is mocked.** The customer, the five warehouses, the 15 products and every stock level are fake data created by `src/infrastructure/database/seed.ts` for the demo. Product names and prices look like an Apple catalogue so responses read naturally; there is no real customer, inventory or card data anywhere.

- Customer: `c0000000-0000-0000-0000-000000000001`
- Warehouses: `a0000000-0000-0000-0000-00000000000{1..5}` (Newark, Los Angeles, Dallas, Chicago, Miami)
- Products: `b0000000-0000-0000-0000-0000000000{01..15}`

| Scenario | Product | Stock | What it tests |
|---|---|---|---|
| Single warehouse | AirPods Pro 3 (`…014`) | 50, Newark only | Newark always wins. |
| Real choice | iPhone 17 (`…004`) | Newark 30, LA 25, Miami 20 | The closest warehouse wins. |
| Nobody can | MacBook Pro 16" (`…010`) | 2 in each of the 5 | Asking for 3 returns `422`: orders are never split. |
| Exact limit | iPad Pro 11" (`…013`) | exactly 5, Newark only | The concurrency boundary case. |

| Test card | payments-mock | API result |
|---|---|---|
| `4242424242424242` | `200` approved (200 to 600 ms) | `201 CONFIRMED` |
| `4000000000000002` | `402` declined | `402`, stock released |
| `4000000000090003` | `500` provider error | `502`, settled later by the background jobs |
| `4000000000080004` | records the charge, then hangs 30 s | `502` after about 7 s; the reconciliation later confirms it |

The static geocoder knows 32 US cities (the five warehouse cities, New York, Philadelphia, San Diego, Houston, Orlando, Seattle, Denver, Boston and more; the full list is in [`static-geocoding.provider.ts`](src/infrastructure/geocoding/static-geocoding.provider.ts)). `Portland` needs a state because both `OR` and `ME` exist.

## Configuration

Compose injects everything it needs; `.env` is only for running the app or the scripts outside Docker (`cp .env.example .env`). The app validates every variable with zod at boot and refuses to start on a bad value.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://canals:canals@localhost:5432/canals` | Postgres connection string |
| `PORT` | `3000` | api HTTP port |
| `PAYMENTS_URL` | `http://localhost:4000` | payments-mock base URL |
| `GEOCODING_DRIVER` | `static` | `static` or `geoapify` |
| `GEOAPIFY_API_KEY` | (empty) | Required only with `geoapify` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Trace and metric export |
| `PGBOSS_POLL_INTERVAL_SECONDS` | `15` | Worker polling fallback behind `LISTEN/NOTIFY` |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins |
| `LOG_PRETTY` | `false` | Pretty logs for local development |

To use real geocoding, set `GEOCODING_DRIVER=geoapify` and `GEOAPIFY_API_KEY` in a git-ignored `.env`; `docker compose up` picks them up. Geocoding powered by [Geoapify](https://www.geoapify.com/).

## Development and testing

```bash
npm install
cp .env.example .env && set -a && source .env && set +a   # scripts talk to the dockerized stack
export LOG_PRETTY=false           # pino-pretty's transport hijacks stdout from Jest's log-capture tests; .env.example ships LOG_PRETTY=true for local `node dist/main.js` runs, not for the test suite

npm run lint && npm run build
npm run test:unit                 # no database needed
npm run test:integration          # needs a migrated Postgres (docker compose up -d postgres)
npm run test:e2e                  # needs the full stack
npm run concurrency-check         # in-process ledger proof (-- 50 for N = 50)
npm run concurrency-e2e           # the same proof through real POST /orders requests
npm run payments-check            # the four test cards through the real HTTP adapter
npm run events-check              # order.confirmed → 3 jobs → 1 shipment
npm run demo                      # ten end-to-end scenarios, exits 0 when all pass
npm run verify                    # everything above, in the order CI expects
```

Useful while the stack is running:

```bash
docker compose logs -f api worker                  # structured logs
docker compose logs api worker | grep <correlationId>
docker compose down -v                             # tear down, including the database volume
```

## CI and contributing

`main` is protected: nothing is pushed to it directly. Every change goes through a pull request, and each development phase (P0 to P6) landed as its own PR with an approved spec in [`specs/`](specs).

Opening a PR against `main` starts three jobs:

| Job | Workflow | What it does |
|---|---|---|
| **Unit tests** (required) | [`tests.yml`](.github/workflows/tests.yml) | Clean install, lint, build, unit tests and the `payments-mock` package tests. If it fails, the PR can't be merged. |
| **Integration + e2e tests** | [`tests.yml`](.github/workflows/tests.yml) | Real `postgis/postgis:16-3.4` service and `payments-mock` container, migrations, then the integration and e2e suites (no database mocks). |
| **Claude Code Review** | [`claude-code-review.yml`](.github/workflows/claude-code-review.yml) | Automated review that posts inline comments on the diff. |

Before opening a PR, run `npm run verify` locally. Mentioning `@claude` in a PR or issue also triggers an on-demand assistant ([`claude.yml`](.github/workflows/claude.yml)).

## Design decisions

Short version; the technical guide explains each one with diagrams and trade-offs.

- **PostgreSQL + PostGIS** because the two hard parts (concurrency and "closest") are solved by one engine: row locks and constraints, plus `geography` distances in meters and a GiST index.
- **Warehouse selection is one SQL statement** ([`select-warehouse.sql`](src/infrastructure/database/sql/select-warehouse.sql)): filter to warehouses that can fill every line, then sort that small set by distance.
- **Queue inside Postgres (pg-boss)** instead of an external broker: jobs commit with the order, so there is no dual-write problem and no outbox relay. The cost is a polling worker, fine for one service at this scale.
- **Retries with full jitter plus a circuit breaker** around every provider call; a declined card is an answer, not a failure.
- **Two levels of idempotency:** the client's `Idempotency-Key` protects the request, a derived key protects the charge at the provider.
- **Append-only inventory ledger:** release and commit read the reserved quantity from the ledger, so the reaper can undo a reservation that never finished, knowing only the order id. [`verify-ledger.sql`](src/infrastructure/database/sql/verify-ledger.sql) checks that ledger and stock agree.
- **A payment with an unknown outcome is never released automatically.** Holding stock is better than selling something already paid for.
- **Correlation id plus linked traces:** one id finds every log line of a request and its jobs; each job is its own trace, linked to the request by a span link.

## Further reading

| Where | What |
|---|---|
| [Technical guide (Drive)](https://drive.google.com/drive/folders/1Oszyk632ON4OGZTx8MmNBXFyeSnCCUvi?usp=sharing) | HTML and PDF: architecture, execution path, decisions |
| [`knowledge/`](knowledge/README.md) | Rationale and invariants behind the code, indexed by file and symbol |
| [`specs/`](specs) and [`phases/`](phases) | The phase plan and each phase's approved spec, with its decisions |
| [`engineering:documentation/`](engineering:documentation) | Requirements, data model (DBML) and infrastructure notes |
| [dbdiagram.io](https://dbdiagram.io/d/Canalspregunta-6aa9a81baf7c3b0bd1e7b378) | Live ER diagram |

## Known limitations

Deliberately left out of scope or not fixed yet, each for a reason:

- **payments-mock keeps charges in memory.** After a restart it answers `404` for a charge it did make, and the reaper could release stock for an order that was paid. A real provider persists charges; the demo resolves the timeout scenario before stopping the mock for this reason.
- **Idempotency edge cases.** A generic `500` is stored as `COMPLETED` and replayed; re-posting an expired key returns `500`; a key left `IN_PROGRESS` by a crash blocks until it expires (24 h); expired rows are never purged.
- **`GET /orders` cursor** returns `500` if the id inside a hand-edited cursor isn't a UUID. (The millisecond-precision bug that could skip rows was fixed in #12.)
- **The payment call is not traced**: native `fetch` (undici) isn't covered by the HTTP auto-instrumentation.
- **`RESERVATION_TTL_MINUTES` is validated but unused**: the reservation window comes from the code constant.
- **`verify-ledger.sql` compares snapshots**, not a full replay from zero.
- **No compose healthcheck on `api`**, and the concurrency e2e proof runs against a single api instance.
- **Only the `shipment.create` queue is functional.** `customer.notify` and `analytics.record` are placeholders: their handlers only write a structured log line, with no email provider or analytics sink behind them. They exist to show the fan-out, retries and DLQ wiring.
- **Not built:** management APIs for customers, products and warehouses, authentication, bulk orders, order edits and deployment.
