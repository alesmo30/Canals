# P3 — Queue, Worker and Observability

| | |
|---|---|
| **Wave** | 2 |
| **Depends on** | P0 |
| **Parallel with** | P5 |
| **Risk** | medium |
| **Target** | Thursday AM |

## Objective

Make the worker real: pg-boss wired transactionally, the `EventPublisher` adapter
implemented, job handlers registered, and the whole system emitting traces, logs
and health so a single Grafana trace tells the story of one order.

Handlers can be thin here — P4 gives them something to react to.

---

## Requirements

### R3.1 — pg-boss setup (FR-9)

- pg-boss owns its schema in the same database; the connecting role needs `CREATE`.
- **Polling interval 15 s**, with `LISTEN`/`NOTIFY` enabled for fast delivery.
  Confirm the exact option names against the installed version rather than assuming.
- The listener needs a **dedicated session-level connection** (`Client`, not from the
  pool). Document the pool sizes chosen: api 10, worker 5, +1 listener.
- Graceful shutdown: stop fetching, let in-flight jobs finish, then exit.

### R3.2 — `PgBossEventPublisher` (FR-9, the critical one)

Implements P0's `EventPublisher`. When a `tx` is supplied, the job insert **must
join that transaction**:

```ts
await boss.send(event.type, event, {
  db: { executeSql: (text, values) => tx.query(text, values) },
});
```

**Write a check that proves it:** begin a transaction, publish an event, roll
back, and assert no row exists in the pg-boss job table. If that check fails, the
whole outbox argument in FR-9 is false and it must be fixed before P4 starts.

### R3.3 — Worker entrypoint

- `src/main.worker.ts` using `NestFactory.createApplicationContext(WorkerModule)`.
- **No `app.listen()`. No HTTP port.**
- `WorkerModule` imports `SharedModule` and must **not** import `ApiModule`.
- A `JobRunner` that registers every handler and starts consuming.

### R3.4 — Queues and handlers

Register these queues with thin but real handlers:

| Queue | Does |
|---|---|
| `shipment.create` | creates a `shipments` row for a confirmed order |
| `customer.notify` | logs a structured "notification sent" event |
| `analytics.record` | logs a structured domain event |

Fan-out: **one** `order.confirmed` event produces three independent jobs, each
with its own retry lifecycle. A single handler doing all three is wrong — if the
notification fails, the shipment must not be recreated.

### R3.5 — Retries and DLQ

- Exponential backoff with jitter, max 5 attempts per consumer.
- Exhausted jobs land in a dead-letter queue **with their failure history**, and are
  exposed as a metric. Never silently dropped.
- Demonstrate it: a handler that always throws must end up in the DLQ with its attempts visible.

### R3.6 — Handler idempotency

Queues are at-least-once. Every handler must tolerate running twice.
`shipments.order_id` is `UNIQUE`; the handler must treat the resulting conflict as
success, not as an error.

### R3.7 — Observability (NFR-4)

- **Tracing**: OpenTelemetry Node SDK with auto-instrumentation for HTTP and `pg`,
  exporting OTLP to the `lgtm` container. No hand-written spans in this phase.
- **Context propagation**: a `correlationId` generated at the HTTP edge, carried
  into job payloads, and attached to every log line and span — so the async work
  appears in the same trace as the request that caused it.
- **Logging**: structured JSON, one line per event, with the redaction rules from P2 applied globally.
- **Health**: `GET /health` (liveness) and `GET /health/ready` (readiness — database and queue reachable).
- Add the `lgtm` service to compose: `grafana/otel-lgtm`, `3001:3000` and `4318:4318`.

### R3.8 — Worker health

The worker has no HTTP port, so its compose healthcheck is a process/DB-connectivity
check. If a small `/health`-only listener turns out to be simpler, that is
acceptable — note the decision either way.

---

## Files owned by this phase

```
src/infrastructure/messaging/**
src/infrastructure/observability/**
src/modules/worker.module.ts
src/main.worker.ts
src/application/jobs/**
docker-compose.yml          ← ONLY to add the `lgtm` service
```

## Frozen contracts consumed

`EventPublisher`, `DomainEvent`, `TransactionContext` from P0.
`ShipmentService` is created here if it does not yet exist.

---

## Acceptance criteria

1. The rollback check in R3.2 passes: no job row survives a rolled-back transaction.
2. Publishing `order.confirmed` produces three jobs that run independently.
3. A deliberately failing handler retries with visible backoff and lands in the DLQ with its history.
4. Running the same job twice creates exactly one shipment.
5. Grafana at `localhost:3001` shows a trace spanning the HTTP request and the jobs that followed, linked by `correlationId`.
6. `/health/ready` returns 503 when postgres is stopped and 200 when it is back.
7. The worker shuts down gracefully on `docker compose stop` without abandoning an in-flight job.

## Out of scope

The reservation reaper and payment reconciliation (P6 — they need P4's saga to
exist first). Custom spans and business metrics (out of scope by decision).

## References

FR-9, NFR-3, NFR-4 · `infrastructure.md` §3, §7
