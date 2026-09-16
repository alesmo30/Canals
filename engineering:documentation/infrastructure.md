# Container Infrastructure

| | |
|---|---|
| **Status** | Draft for review |
| **Last updated** | 2026-09-15 |
| **Related** | [`architectural-requirements.md`](./architectural-requirements.md) · [`data-model.dbml`](./data-model.dbml) |

Everything below runs from a single `docker compose up`, with no cloud account
and no credentials (C-11). Five containers.

---

## 1. Topology

```
╔═══════════════════════════ docker compose ════════════════════════════╗
║                                                                        ║
║  APPLICATION                          STATE                            ║
║  ───────────                          ─────                            ║
║  ┌──────────────────┐                 ┌────────────────────────────┐   ║
║  │ api              │────── SQL ─────►│ postgres                   │   ║
║  │ :3000            │                 │ postgis/postgis:16-3.4     │   ║
║  │ NestJS · HTTP    │                 │ :5432                      │   ║
║  │ stateless        │                 │                            │   ║
║  └────────┬─────────┘                 │  ┌──────────────────────┐  │   ║
║           │                           │  │ business tables      │  │   ║
║  ┌────────┴─────────┐                 │  ├──────────────────────┤  │   ║
║  │ worker           │────── SQL ─────►│  │ pgboss.job  ← QUEUE  │  │   ║
║  │ no HTTP port     │                 │  └──────────────────────┘  │   ║
║  │ pg-boss consumer │                 └────────────────────────────┘   ║
║  └────────┬─────────┘                                                  ║
║           │                                                            ║
║  MOCKED EXTERNALS                     PLATFORM                         ║
║  ────────────────                     ────────                         ║
║  ┌──────────────────┐                 ┌────────────────────────────┐   ║
║  │ payments-mock    │◄── api ────────┐│ lgtm                       │   ║
║  │ :4000            │◄── worker ────┐││ grafana/otel-lgtm          │   ║
║  │ Fastify          │               │││ :4318  OTLP ingest         │   ║
║  │ deterministic    │               │││ :3001  Grafana UI          │   ║
║  └──────────────────┘               │││                            │   ║
║                                     ││└────────────▲───────────────┘   ║
║                                     ││             │                   ║
║                    api + worker ────┴┴── OTLP ─────┘                   ║
║                    traces · metrics · logs                             ║
╚════════════════════════════════════════════════════════════════════════╝
                              │
                              │  only when GEOCODING_DRIVER=geoapify
                              ▼
                    ┌──────────────────────┐
                    │  api.geoapify.com    │   outside Docker, real internet
                    └──────────────────────┘
```

```mermaid
flowchart TB
    client([curl / UI])

    subgraph compose["docker compose"]
        direction TB
        api["<b>api</b><br/>NestJS :3000<br/>stateless"]
        worker["<b>worker</b><br/>pg-boss consumer<br/>no HTTP port"]
        pg[("<b>postgres</b><br/>postgis/postgis:16-3.4 :5432<br/>business tables + pgboss.job")]
        pay["<b>payments-mock</b><br/>Fastify :4000"]
        lgtm["<b>lgtm</b><br/>grafana/otel-lgtm<br/>:4318 OTLP · :3001 UI"]
    end

    geo["api.geoapify.com<br/><i>opt-in</i>"]

    client -->|HTTP| api
    api -->|SQL| pg
    worker -->|SQL + poll| pg
    api -->|charge| pay
    worker -->|reconcile| pay
    api -.->|OTLP| lgtm
    worker -.->|OTLP| lgtm
    api -.->|GEOCODING_DRIVER=geoapify| geo
```

---

## 2. What each container is for

| Container | Image | Ports | Role |
|---|---|---|---|
| `api` | built from repo | `3000` | HTTP surface. `POST /orders`, `GET /orders`. Stateless, so it scales horizontally behind a load balancer. |
| `worker` | **same image**, different entrypoint | none | Drains `pgboss.job`: shipment creation, notifications, analytics, reservation reaper, payment reconciliation. Scales independently of `api`. |
| `postgres` | `postgis/postgis:16-3.4` | `5432` | Single source of truth. Business tables **and** the queue. PostGIS powers FR-2. |
| `payments-mock` | built from repo | `4000` | The "external payment API" as a **real HTTP service**. See §3. |
| `lgtm` | `grafana/otel-lgtm` | `4318`, `3001` | OpenTelemetry Collector + Prometheus + Tempo + Loki + Grafana in one container. Dev/demo only, by Grafana's own description — which is exactly our use case. |

`api` and `worker` are **the same build artifact**. Only the command differs.
That is what keeps domain logic shared and prevents drift between the two.

---

## 3. One repo, two entrypoints

The worker is not a second project. It is the same codebase booted differently,
which is what lets it reuse every service the API uses.

```
src/
├─ domain/                    pure logic, no Nest and no TypeORM imports
├─ application/               use cases: CreateOrder, CreateShipment, ReleaseReservation
├─ infrastructure/            adapters: TypeORM repos, pg-boss, payments, geocoding
├─ modules/
│  ├─ shared.module.ts        config, TypeORM, pg-boss, all ports  ← THE SHARED PART
│  ├─ api.module.ts           SharedModule + HTTP controllers
│  └─ worker.module.ts        SharedModule + job handlers
├─ main.ts                    API entrypoint
└─ main.worker.ts             worker entrypoint
```

### The one line that makes it work

```ts
// src/main.ts — API
const app = await NestFactory.create(ApiModule);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
await app.listen(3000);
```

```ts
// src/main.worker.ts — worker
const app = await NestFactory.createApplicationContext(WorkerModule);
await app.get(JobRunner).start();
// no app.listen() → no HTTP port
```

`createApplicationContext()` boots the **entire dependency-injection graph** —
every provider, repository and database connection — **without starting an HTTP
listener**. That is exactly "same services, no port".

### What actually gets reused

| Service | Used by `api` | Used by `worker` |
|---|---|---|
| `InventoryService` | reserves stock (TX1) | releases expired reservations (reaper) |
| `PaymentGateway` | charges the customer | reconciles UNKNOWN payments |
| `OrdersRepository` | creates and reads orders | transitions them after async work |
| `ShipmentService` | — | creates shipments on `order.confirmed` |
| domain entities, state machine, money types | ✅ | ✅ |

A job handler is an ordinary Nest provider with ordinary constructor injection:

```ts
@Injectable()
export class ShipmentCreateHandler {
  constructor(
    private readonly shipments: ShipmentService,   // the SAME service
    private readonly orders: OrdersRepository,     // the SAME repository
  ) {}

  async handle({ orderId }: OrderConfirmedPayload) {
    await this.shipments.createForOrder(orderId);
  }
}
```

### One image, two commands

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# no CMD: compose decides which entrypoint runs
```

```yaml
api:    { build: ., command: node dist/main.js }
worker: { build: ., command: node dist/main.worker.js }
```

Docker builds once and both services share the layer.

### Two things this forces us to get right

1. **`ApiModule` and `WorkerModule` must not import each other.** Both import
   `SharedModule`. If the worker imported the API module it would instantiate
   controllers it will never serve.
2. **Migrations must run from exactly one place.** If both containers ran them at
   boot they would race on a cold start. A one-shot `migrate` service in compose,
   or the API guarded by a PostgreSQL advisory lock.

### The trade-off, stated honestly

Sharing one artifact means a change to worker-only code still rebuilds the image
the API runs. At a scale where those deploy on different cadences you split them
into separate services. For a modular monolith with one worker, shared-artifact
is the right call: zero drift on the domain model, one test suite, one CI
pipeline, one set of types.

---
## 4. Why `payments-mock` is its own container

The assessment says to mock the payment API. A mock can be an in-process class
or a real HTTP service, and the choice decides how much of the design is
actually exercised.

| | In-process fake | Separate container |
|---|---|---|
| Timeouts | simulated with `setTimeout` | **real** socket timeouts |
| Provider down | a boolean flag | `docker stop payments-mock` |
| Retry + backoff | tested against a lie | tested against a real failure |
| Circuit breaker | never really opens | opens for real |
| HTTP client config | untested | exercised |

FR-4 promises timeouts, retries with backoff and a circuit breaker. With an
in-process fake, none of that code ever meets a real network, and the
reservation-release path on provider failure is never truly proven.

With a container, the demo becomes:

```bash
docker stop payments-mock
curl -X POST localhost:3000/orders -d @order.json
# → 502, order held PENDING_PAYMENT, reservation intact
# → circuit breaker opens, visible in Grafana
docker start payments-mock
# → reconciliation job settles or releases it
```

Cost: roughly 50 lines of Fastify. It returns deterministic outcomes keyed on
the card number (approved / declined / 500 / timeout), honours the
`Idempotency-Key` header, and is the only place in the system that ever sees a
full card number.

Geocoding does **not** get the same treatment: its "real network" path already
exists via the Geoapify adapter (FR-3), so the static provider stays in-process.

---

## 5. `docker-compose.yml` skeleton

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: canals
      POSTGRES_USER: canals
      POSTGRES_PASSWORD: canals
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U canals']
      interval: 5s
      retries: 10

  payments-mock:
    build: { context: ., dockerfile: docker/payments-mock.Dockerfile }
    ports: ['4000:4000']
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:4000/health']
      interval: 5s
      retries: 10

  lgtm:
    image: grafana/otel-lgtm
    ports:
      - '3001:3000'   # Grafana UI  (3000 is taken by the api)
      - '4318:4318'   # OTLP/HTTP ingest

  api:
    build: .
    command: node dist/main.js
    ports: ['3000:3000']
    environment:
      DATABASE_URL: postgres://canals:canals@postgres:5432/canals
      PAYMENTS_URL: http://payments-mock:4000
      OTEL_EXPORTER_OTLP_ENDPOINT: http://lgtm:4318
      GEOCODING_DRIVER: static        # set to `geoapify` + GEOAPIFY_API_KEY for the real one
    depends_on:
      postgres: { condition: service_healthy }
      payments-mock: { condition: service_healthy }

  worker:
    build: .
    command: node dist/main.worker.js
    environment:
      DATABASE_URL: postgres://canals:canals@postgres:5432/canals
      PAYMENTS_URL: http://payments-mock:4000
      OTEL_EXPORTER_OTLP_ENDPOINT: http://lgtm:4318
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  pgdata:
```

`depends_on: condition: service_healthy` matters: without it, `api` starts before
PostgreSQL accepts connections and the first migration run fails on a cold clone
— the single most common reason a reviewer's first `docker compose up` fails.

---

## 6. One order, across the containers

```
 ┌────────┐        ┌─────┐      ┌──────────┐   ┌───────────────┐   ┌────────┐
 │ client │        │ api │      │ postgres │   │ payments-mock │   │ worker │
 └───┬────┘        └──┬──┘      └────┬─────┘   └───────┬───────┘   └───┬────┘
     │ POST /orders   │              │                 │               │
     ├───────────────►│              │                 │               │
     │                │ INSERT idempotency_key         │               │
     │                ├─────────────►│                 │               │
     │                │                                │               │
     │                │ geocode (in-process, or Geoapify over internet) │
     │                │                                │               │
     │                │ ╔══ TX1 ═══════════════╗       │               │
     │                │ ║ SELECT warehouses     ║      │               │
     │                │ ║   ORDER BY <-> point  ║      │               │
     │                │ ║ SELECT inventory      ║      │               │
     │                │ ║   FOR UPDATE          ║      │               │
     │                │ ║ INSERT orders / items ║      │               │
     │                │ ╚══ COMMIT ════════════╝       │               │
     │                ├─────────────►│                 │               │
     │                │              │                 │               │
     │                │ POST /charge  (real HTTP, real timeout)        │
     │                ├───────────────────────────────►│               │
     │                │◄───────────────────────────────┤               │
     │                │              │                 │               │
     │                │ ╔══ TX2 ═══════════════╗       │               │
     │                │ ║ INSERT payments       ║      │               │
     │                │ ║ commit reservation    ║      │               │
     │                │ ║ orders → CONFIRMED    ║      │               │
     │                │ ║ INSERT pgboss.job ◄── outbox ║               │
     │                │ ╚══ COMMIT ════════════╝       │               │
     │                ├─────────────►│                 │               │
     │ 201 Created    │              │                 │               │
     │◄───────────────┤              │                 │               │
     │                │              │                 │               │
     │                │              │  poll pgboss.job                │
     │                │              │◄────────────────────────────────┤
     │                │              │  shipment.create                │
     │                │              │  customer.notify                │
     │                │              │  analytics.record               │
     │                │              │◄────────────────────────────────┤
```

Every step above emits a span to `lgtm` carrying the same `correlationId`, so one
Grafana trace shows the whole thing — including the jobs that run after the
client already got its `201`.

---

## 7. How the worker picks up work

### Pull, not push

**The database does not publish anything and the worker does not subscribe to
anything.** `pgboss.job` is an ordinary table. Inserting a row into it notifies
nobody. The worker asks, on a loop:

```
   ┌──────────┐   "any work for me?"    ┌──────────┐
   │  worker  │ ──────────────────────► │ postgres │
   │          │ ◄────────────────────── │          │
   └──────────┘   "no"  /  "these 10"   └──────────┘
        │
        └── sleep(interval), repeat
```

The worker holds an open connection pool to PostgreSQL, but **holding a
connection is not the same as receiving pushes**. That pool exists so the worker
can *send* queries.

The `worker` container exposes no HTTP port because **nothing calls it**. It is
not a server waiting for requests; it is a consumer that goes looking for work.

```
   api                              worker
   ───                              ──────
   reactive                         proactive
   binds :3000, waits               binds nothing
   someone calls  → responds        asks the DB  → works
```

### Polling with SKIP LOCKED

`pg-boss` fetches jobs by **polling**, using the PostgreSQL feature built
specifically for queue workloads:

```sql
SELECT id
  FROM pgboss.job
 WHERE name = 'shipment.create'
   AND state = 'created'
 ORDER BY priority DESC, created_at
   FOR UPDATE SKIP LOCKED      -- the important part
 LIMIT 10;
```

- `FOR UPDATE` locks the rows it returns.
- `SKIP LOCKED` tells PostgreSQL: if a row is already locked by another
  transaction, **do not wait for it — skip it and take the next one**.

That is what lets several workers drain the same queue with no coordination and
no blocking:

```
   worker A  ──►  [1][2][3] 🔒
   worker B  ──────────────►  [4][5][6] 🔒     (skipped A's rows, took the next)
```

Without `SKIP LOCKED`, worker B would either block waiting for A's rows or read
the same rows and run the jobs twice.

### LISTEN/NOTIFY is an accelerator, not the mechanism

`pg-boss` can additionally use PostgreSQL's `LISTEN`/`NOTIFY` for lower-latency
delivery. Even then the model stays pull-based: the notification carries **no
work**. It is a tap on the shoulder saying *"stop sleeping, run your query now"*,
and the worker still executes the same `FOR UPDATE SKIP LOCKED` fetch. It
shortens the wait; it never delivers a job.

It is deliberately **not** the primary mechanism, and the reason is a useful
principle:

> `NOTIFY` is fire-and-forget and in-memory. If the worker is down, restarting or
> deploying at the moment the notification fires, that notification is gone
> forever — and the job would sit in the table untouched.

Polling is the durable floor: the job row is in the table, so it will be picked
up on the next tick no matter what happened. `NOTIFY` only shortens the wait.
**The durable mechanism is the primary one; the fast one is the optimisation.**

### Latency, and why it is fine here

Polling costs a worst-case delay of one polling interval (configurable, on the
order of seconds). Every job we run is post-confirmation work:

| Job | Acceptable delay |
|---|---|
| `shipment.create` | seconds — the customer already has their `201` |
| `customer.notify` | seconds |
| `analytics.record` | seconds |
| reservation reaper | runs on a schedule anyway |
| payment reconciliation | runs on a schedule anyway |

A Redis-backed queue like BullMQ uses a blocking pop and delivers in
milliseconds. That is a real advantage, and it buys us nothing: no job here is
on a latency budget. We traded it for transactional enqueue (FR-9).

### What polling actually costs

The obvious objection is that polling burns resources for nothing. Worth putting
numbers on it rather than hand-waving.

The idle cost is **independent of traffic** and equals:

```
    queries/sec  =  queues × workers ÷ polling interval
```

For this system: 5 queues × 2 workers ÷ 2 s = **5 queries/sec**.

Each one is an index scan on `(name, state, ...)` that returns zero rows, served
from shared buffers with no disk I/O — roughly 0.2 ms.

| | |
|---|---|
| Idle load | ~5 queries/sec, ~1 ms CPU/sec ≈ **0.1% of one core** |
| For comparison, one `POST /orders` | ~10 queries |
| So all polling ≈ | **one order every two seconds** of database load |

A modest PostgreSQL instance serves tens of thousands of simple queries per
second. This is noise.

### Where the objection becomes correct

The formula above is the whole story: cost scales with **queues × workers**, not
with the amount of work. That is genuinely bad at a certain size.

| Scenario | Idle queries/sec |
|---|---|
| This system (5 queues, 2 workers, 2 s) | 5 |
| 20 queues, 20 workers, 1 s | 400 |
| 50 queues, 100 workers, 1 s | **5,000** |

At the bottom row, polling overhead competes with real transactional work on the
same database. That is the real reason to move the queue out of PostgreSQL — not
latency, and not "push vs pull". See §7 of the architectural requirements.

Two mitigations exist long before that point:

1. **Raise the interval and enable `LISTEN`/`NOTIFY`** — the configuration we adopt, see below.
2. **Fewer queues.** Each queue name is polled separately; consolidating related
   jobs behind one queue with a discriminator divides the cost directly.

### Decided configuration: 15 s poll + LISTEN/NOTIFY

| | Poll 2 s alone | **Poll 15 s + NOTIFY** |
|---|---|---|
| Idle load | 5 q/s | **0.67 q/s** |
| Latency, new job | up to 2 s | **~milliseconds** |
| Latency, retry or scheduled job | up to 2 s | up to 15 s |
| Extra connections | 0 | 1 per worker |

`NOTIFY` is issued by pg-boss in the same statement batch that inserts the job,
and **PostgreSQL delivers notifications only when the issuing transaction
commits**. If TX2 rolls back, no worker is ever woken for a job that does not
exist. The atomicity guarantee of FR-9 therefore extends to the wake-up signal
for free.

**Why 15 s and not higher.** `NOTIFY` fires only on *insert*. Retries, delayed
jobs and scheduled jobs (the reservation reaper, payment reconciliation) are
rescheduled for a future timestamp, and nothing notifies at that time — they are
picked up by the poll. **The polling interval is therefore the granularity of
retry scheduling**: at 15 s, a retry scheduled for t+30 s may run at t+45 s. That
is acceptable; at a 5-minute interval it would not be.

**Why `LISTEN` constrains the connection path.** `LISTEN` holds one dedicated
session-level connection per worker, idle, waiting on the socket. It therefore
cannot work through a transaction-mode pooler (PgBouncer transaction mode,
Supabase port 6543), which hands the connection back between statements. Options
at scale: route the listener over a direct/session connection while the query
pool goes through the transaction pooler, or drop `NOTIFY` and let polling carry
everything. **Polling remains the durable floor, so disabling `NOTIFY` is always
a safe fallback** — it costs latency, never correctness.

The listener connection is one per worker. In any connection-budget problem the
query pools dominate it by an order of magnitude; see NFR-7.

### Note: SQS is also pull

It is worth stating plainly because it is a common misconception. SQS consumers
call `ReceiveMessage` in a loop; AWS's recommended configuration is *long
polling* (`WaitTimeSeconds: 20`). Adopting SQS would not replace polling with
push — it would move the polling to a different system, and bill per empty
receive instead of spending a fraction of a core.

Genuine push means SNS → Lambda or SNS → an HTTPS endpoint, which replaces the
long-running worker entirely and is a different deployment model, not a queue
swap.

---

## 8. Optional: the load-balancer demo

Not part of the default stack. Enabled with a compose profile when demonstrating
NFR-7 (horizontal scalability) and NFR-1 (no overselling under concurrency):

```
        nginx :8080
         ├──► api-1 ─┐
         └──► api-2 ─┴──► postgres
```

Because `api` holds no state, adding instances needs no code change. This is the
setup for the concurrency proof in NFR-1: N concurrent orders across two
instances against a warehouse with N-k units must yield exactly N-k successes.

---

## 9. Port map

| Port | Container | What |
|---|---|---|
| `3000` | api | the API under test |
| `3001` | lgtm | Grafana UI (`admin` / `admin`) |
| `4000` | payments-mock | mocked payment provider |
| `4318` | lgtm | OTLP/HTTP ingest |
| `5432` | postgres | database, for `psql` inspection |
| `8080` | nginx | load balancer, `--profile loadbalancer` only |
