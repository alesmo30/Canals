# Messaging and jobs

Domain events go out through a transactional outbox built on pg-boss; the
worker process consumes them and also runs two scheduled jobs (the
reservation reaper and payment reconciliation).

Main sources: [spec 04, Data model and Decisions](../specs/04-queue-worker-observability.md#decisions)
(queue topology, outbox, retries, worker lifecycle),
[spec 07, Scheduled jobs and Decisions](../specs/07-hardening-demo.md#scheduled-jobs),
[infrastructure.md, sections 3 and 7](../engineering:documentation/infrastructure.md#7-how-the-worker-picks-up-work),
and the README's queue, worker and observability section for the
operator's view (DLQ inspection, reprocessing).

## Transactional outbox

Code:
- `src/domain/ports/event-publisher.ts` → `EventPublisher`, `DomainEvent`, `TransactionContext`
- `src/infrastructure/messaging/pg-boss-event-publisher.ts` → `PgBossEventPublisher`, `PgBossEventPublisher.publish`

**Problem:** the order update and the "order confirmed" event must be saved
together or not at all. **Solution:** the pg-boss job insert joins the
*same* database transaction as the order update.

- `DomainEvent` is an event name plus payload, mirroring what
  `boss.send(name, data, options)` needs, folded into one argument. `type`
  stays a plain `string`; concrete events (`order.confirmed`) are named by
  the publisher's callers.
- `TransactionContext` is a raw SQL executor bound to the caller's
  in-flight transaction. It is a plain function, not a TypeORM
  `QueryRunner`, so the port stays framework-free:

  ```ts
  await dataSource.transaction(async (trx) => {
    await trx.update(Order, orderId, { status: 'CONFIRMED' });
    await eventPublisher.publish(event, {
      executeSql: (sql, values) => trx.query(sql, values),
    });
  }); // one COMMIT: the order and the job are saved together, or neither is
  ```

- `EventPublisher.publish(event, tx?)`: with `tx`, the jobs are inserted
  inside the caller's transaction; without it (a caller outside any
  transaction), they are sent on their own.
- `PgBossEventPublisher.publish` looks the event type up in `EVENT_ROUTING`
  and sends one job per target queue, all through the same
  `db.executeSql` when `tx` is given, so every job insert commits or rolls
  back with the caller's transaction. It also attaches the job envelope
  `meta` ([Job envelope](#job-envelope)).
- Shape bridge: pg-boss's `Db.executeSql` must resolve `{ rows }`, but
  TypeORM's `EntityManager.query()` resolves the bare rows array
  (`useStructuredResult: false`). `publish` is the one place that wraps it.

The outbox guarantee is proven by an integration test that rolls back the
transaction and checks that no job exists
([testing.md#pgboss-esm-jest](testing.md#pgboss-esm-jest)).

Source: [spec 04, Decisions › “The transactional outbox”](../specs/04-queue-worker-observability.md#decisions);
[spec 01, “Port interfaces, frozen”](../specs/01-foundation.md#port-interfaces-frozen);
transactional outbox section of [architectural-requirements.md](../engineering:documentation/architectural-requirements.md).

## Event contract

Code: `src/infrastructure/messaging/event-routing.ts` → `OrderConfirmedPayload`

`order.confirmed` is the only event. It is published by the settlement step
of the order saga ([orders-saga.md#settlement](orders-saga.md#settlement))
and consumed by the worker.

The payload is deliberately minimal (the order id). Handlers read whatever
else they need from the database, so a job that runs a minute late sees
current state instead of a stale copy.

Source: [spec 04, “Event contract” and Decisions › “The event contract”](../specs/04-queue-worker-observability.md#event-contract).

## Event routing

Code: `src/infrastructure/messaging/event-routing.ts` → `EVENT_ROUTING`, `UnroutedEventError`

```
order.confirmed -> shipment.create, customer.notify, analytics.record
```

Routing lives in code, not in pg-boss's own `publish`/`subscribe` table.
With pg-boss subscriptions, a `subscribe()` that a fresh worker never called
would make `publish` enqueue nothing and still report success: a silent
drop, which is exactly what the outbox exists to prevent.

`UnroutedEventError`: a typo in an event type must fail loudly at publish
time, not vanish.

There is no job literally named `order.confirmed`; the event fans out into
the three routed queues.

Source: [spec 04, Decisions › “Queue topology and fan-out”](../specs/04-queue-worker-observability.md#decisions).

## Queue topology

Code: `src/infrastructure/messaging/queue-setup.ts` → `QUEUE_TOPOLOGY`, `setupQueues`

| Queue | Dead-letter queue |
|---|---|
| `shipment.create` | `shipment.create.dlq` |
| `customer.notify` | `customer.notify.dlq` |
| `analytics.record` | `analytics.record.dlq` |

`QUEUE_TOPOLOGY` is the single source of truth; `JobRunner` and the DLQ
gauge read it too.

`setupQueues` runs at boot in **both** processes (api and worker). It is
idempotent: `createQueue` is a no-op for an existing queue (verified when
pg-boss 12 was adopted), so a restart creates nothing new. Each DLQ is
created **before** the queue that references it, because pg-boss rejects a
`deadLetter` pointing at a queue that does not exist yet.

Source: [spec 04, Queue topology](../specs/04-queue-worker-observability.md#queue-topology).

<a id="retries-dlq"></a>

## Retries and DLQ

Code: `src/infrastructure/messaging/queue-setup.ts` → `QUEUE_RETRY_LIMIT`, `DLQ_RETENTION_DAYS`

- At most **5 attempts** per job. pg-boss counts retries *after* the first
  attempt, so `QUEUE_RETRY_LIMIT = 4` means 5 attempts in total. Backoff
  starts at `QUEUE_RETRY_DELAY_SECONDS = 1` and is capped at
  `QUEUE_RETRY_DELAY_MAX_SECONDS = 60`.
- After the last attempt the job is dead-lettered
  ([Dead letter](#dead-letter)).
- DLQ jobs have no consumer, so pg-boss's ordinary maintenance would
  eventually delete them. `DLQ_RETENTION_DAYS = 30` is set as the **DLQ
  queue's own** `retentionSeconds`: a dead-lettered job takes its retention
  (and retry) settings from the DLQ it lands in, not from the queue it
  failed out of (confirmed against the `insertDeadLetterJob` SQL in
  pg-boss 12.33.2).
- `JobRunner` logs every failed attempt, because pg-boss itself does not
  keep a per-attempt failure history ([Job runner](#job-runner)).

Source: [spec 04, Decisions › “Retries and dead-letter queues” and “pg-boss@12 API” findings](../specs/04-queue-worker-observability.md#decisions).

## Dead letter

Code: `src/infrastructure/messaging/job-runner.integration.spec.ts` → the "realistic: order.confirmed for a non-existent order" test

When a job exhausts its attempts, pg-boss (`failJobsBody`) keeps the
original row, re-inserted with the terminal state `failed` (it is not
deleted), and inserts a **separate copy** into `<queue>.dlq`
(`insertDeadLetterJob`). The copy carries the same `data` as the original
(so the order id is still there, which the tests use to scope their
queries). In the copy, `source_retry_count` is the 0-indexed retry count at
the last attempt; add 1 to get the number of attempts.

A missing order makes `shipment.create` fail with a `NOT NULL` violation,
not a foreign-key violation; see
[investigations.md#not-null-before-fk](investigations.md#not-null-before-fk).

## Handler contract

Code:
- `src/application/jobs/job-handler.ts` → `JobHandler`, `JOB_HANDLERS`

A handler receives the job's `payload` **only**. `meta` (correlation id,
trace context) is consumed by `JobRunner` before the handler runs: the
correlation id is already in the logging context and the job span is
already open, so a handler never reads, forwards or knows about them.

`JOB_HANDLERS` is the DI token for the multi-provider array of every
registered handler, which `JobRunner` consumes
([architecture.md#worker-module](architecture.md#worker-module)).

Source: [spec 04, Handler contract](../specs/04-queue-worker-observability.md#handler-contract).

## Job envelope

Code: `src/infrastructure/messaging/job-envelope.ts` → `JobMeta`, `JobMeta.traceparent`

Every published job body is `{ payload, meta }`. `meta` carries
`correlationId`, `traceparent` and `publishedAt`; the first two are captured by `PgBossEventPublisher` at
publish time and restored by `JobRunner`. Handlers never see `meta`.

`traceparent` is the W3C trace context of the publishing span, or `null`
when no span is active at publish time (for example, a publish from a
script). How it is captured:
[observability.md#trace-propagation](observability.md#trace-propagation).

Scheduled jobs have no `meta` at all ([Scheduled jobs](#scheduled-jobs)).

Source: [spec 04, Job body and routing](../specs/04-queue-worker-observability.md#job-body-and-routing).

## Job runner

Code: `src/infrastructure/messaging/job-runner.ts` → `JobRunner`, `JobRunner.start`

Started from `main.worker.ts` with `await app.get(JobRunner).start()`.
`start()` registers one `boss.work()` per handler in `JOB_HANDLERS`, with
both poll intervals set from `PGBOSS_POLL_INTERVAL_SECONDS`
([investigations.md#pgboss-notify-polling](investigations.md#pgboss-notify-polling)).

For each job:

1. Restore `correlationId` into `correlationStorage`. The pino `mixin` reads
   it, and so does `PgBossEventPublisher` if the handler itself publishes.
2. Open one hand-written `job <queue>` span as a **new root** (`root: true`),
   so it is never accidentally nested under whatever context pg-boss's
   fetch loop is running in. It is **linked** to the publishing span via the
   envelope's `traceparent`.
3. Run the handler with that span active, so any `pg` spans the handler
   produces nest under it instead of appearing as orphans. The handler gets
   `payload` only.
4. On error: record it on the span (status message redacted first, see
   [observability.md#redaction](observability.md#redaction)), log a warning
   with `queue`, `jobId`, `attempt`, `retryLimit`, `error`, `correlationId`,
   and **rethrow** so pg-boss's retry / dead-letter transition still runs.
   That warning line is the per-attempt failure history pg-boss does not
   keep.

`start()` also registers the DLQ gauge (the worker is the only process with
a `PgBoss` instance worth sampling,
[observability.md#dlq-gauge](observability.md#dlq-gauge)), schedules the
cron jobs ([Scheduled jobs](#scheduled-jobs)), and finally writes the
readiness file ([observability.md#health-endpoints](observability.md#health-endpoints)).

Source: [spec 04, Decisions › “Correlation and tracing” and “Retries and dead-letter queues”](../specs/04-queue-worker-observability.md#decisions).

## Scheduled jobs

Code:
- `src/infrastructure/messaging/queue-setup.ts` → `SCHEDULED_JOBS`
- `src/infrastructure/messaging/job-runner.ts` → `JobRunner.start`

| Queue | Cron | Handler |
|---|---|---|
| `reservation.reap` | every minute | [Reservation reaper](#reservation-reaper) |
| `payment.reconcile` | every minute | [Payment reconciliation](#payment-reconciliation) |

- Scheduled from `JobRunner.start()`, so only in the worker (this code never
  runs in the api). pg-boss's own scheduler dedupes cron ticks across
  instances, so running more than one worker is safe.
- **No dead-letter queue**: a failed run is simply followed by the next
  minute's run. A dead-letter copy of an empty tick would be noise.
- Scheduled jobs are created by `boss.schedule()`, not by
  `PgBossEventPublisher`, so they arrive with **no `meta`**. There is no
  publishing request to restore a correlation id or trace from; `JobRunner`
  treats the job as having `correlationId` generated fresh and
  `traceparent: null`.

Source: [spec 07, Scheduled jobs and Decisions (pg-boss `schedule()`)](../specs/07-hardening-demo.md#scheduled-jobs).

## Settlement locking

Code:
- `src/application/jobs/reservation-reaper.handler.ts` → `selectExpiredReservations`
- `src/application/jobs/payment-reconciliation.handler.ts` → `selectUnsettledPayments`

Both jobs work in two steps:

1. **Selection only**: a short transaction runs
   `SELECT … FOR UPDATE … SKIP LOCKED LIMIT <batch>`. It commits, and the
   lock is released, as soon as the query returns.
2. **Resolution**: for each row, `OrderSettlementService` opens its own
   transaction, re-locks the order row and re-checks its status before
   changing anything ([orders-saga.md#settlement](orders-saga.md#settlement)).

So a job can never race the saga's phase 3 or the other job: whoever takes
the order row lock first wins, and the others get `ALREADY_SETTLED`.

Source: [spec 07, “OrderSettlementService”](../specs/07-hardening-demo.md#decisions).

## Reservation reaper

Code: `src/application/jobs/reservation-reaper.handler.ts` → `ReservationReaperHandler`, `REAPER_BATCH_SIZE`, `REAPER_ALERT_AFTER_MINUTES`, `resolveReservation`

Runs every minute. Resolves every `PENDING_PAYMENT` order whose
`reservation_expires_at` has passed
([allocation.md#reservation-ttl](allocation.md#reservation-ttl)), oldest
first, in batches of `REAPER_BATCH_SIZE = 50` (a bounded batch per run, not
the whole backlog). Each order is resolved through
`OrderSettlementService`. One order's failure is logged and does not abort
the batch; a crash mid-batch is simply picked up by the next run.

`resolveReservation` per order:

| Situation | Action |
|---|---|
| No payment row (crash between reserve and charge) | `cancelUnpaid('RESERVATION_EXPIRED_NO_PAYMENT')` |
| Provider says `CAPTURED` | `confirmCaptured` |
| Provider says `DECLINED` | `failDeclined` |
| Provider says `FAILED` (its `getStatus` 404: it never saw the charge) | `cancelUnpaid('RESERVATION_EXPIRED_NOT_CHARGED')` |
| `UNKNOWN` | **never auto-released**; warn, and escalate to an error log once more than `REAPER_ALERT_AFTER_MINUTES = 30` past expiry. Retried every run. |

Why `UNKNOWN` is held: releasing stock for a charge that did go through is
worse than holding it until a human looks.

Only the reaper, after the reservation TTL, may conclude "never charged";
reconciliation never does ([Payment reconciliation](#payment-reconciliation)).

Source: [spec 07, Scheduled jobs and Decisions](../specs/07-hardening-demo.md#scheduled-jobs).

## Payment reconciliation

Code: `src/application/jobs/payment-reconciliation.handler.ts` → `PaymentReconciliationHandler`, `RECONCILIATION_BATCH_SIZE`, `RECONCILIATION_GRACE_MINUTES`, `resolvePayment`

Runs every minute. Resolves `payments` rows still unsettled
(`settled_at IS NULL`, status `PENDING` or `UNKNOWN`) and older than the
grace period, in batches of `RECONCILIATION_BATCH_SIZE = 50`, through
`OrderSettlementService`.

- `RECONCILIATION_GRACE_MINUTES = 2`: longer than the gateway's own worst
  case (3 attempts × 2 s plus backoff), so reconciliation never races a
  charge that is still being retried.
- It acts only on a **definitive** answer: `CAPTURED` → `confirmCaptured`,
  `DECLINED` → `failDeclined`.
- `FAILED` (the provider never saw the charge) and `UNKNOWN` are logged and
  left alone. Only the reaper, after the reservation TTL, may conclude
  "never charged". The two jobs overlap on purpose for the definitive
  answers and differ on the ambiguous one.
- One row's failure is logged and does not abort the batch.

Source: [spec 07, Scheduled jobs and Decisions](../specs/07-hardening-demo.md#scheduled-jobs).

## Event handlers

Code:
- `src/application/jobs/analytics-record.handler.ts` → `AnalyticsRecordHandler`
- `src/application/jobs/customer-notify.handler.ts` → `CustomerNotifyHandler`

`analytics.record` logs a structured domain event; `customer.notify` logs a
structured "notification sent" event. There is no real analytics or email
sink: nothing leaves the process (out of scope).

Source: [spec 04, Scope and Decisions › “The event contract”](../specs/04-queue-worker-observability.md#scope).

## Shipment create

Code:
- `src/application/jobs/shipment-create.handler.ts` → `ShipmentCreateHandler`
- `src/application/jobs/shipment.service.ts` → `ShipmentService`, `INSERT_SHIPMENT_SQL`
- `src/application/jobs/helpers/shipment-mock.helpers.ts` → `generateTrackingNumber`, `pickRandomCarrier`

`ShipmentCreateHandler` creates the shipment through `ShipmentService`. It
does not catch errors (order not found, null `warehouse_id`); a throw goes
to pg-boss's retry and dead-letter handling.

`ShipmentService.createForOrder` runs one statement:

```sql
INSERT INTO shipments (order_id, warehouse_id, status, carrier, tracking_number, dispatched_at)
VALUES ($1, (SELECT warehouse_id FROM orders WHERE id = $1), 'DISPATCHED', $2, $3, $4)
ON CONFLICT (order_id) DO NOTHING
```

- **Idempotency** comes from `UNIQUE(order_id)` plus
  `ON CONFLICT (order_id) DO NOTHING`: running it twice for one order
  inserts once and never errors. A pg-boss retry after a successful first
  insert simply discards its freshly generated carrier and tracking values
  instead of overwriting them.
- `warehouse_id` is read from the order through a subquery on the same
  `$1`, so a missing order still reaches the `INSERT` and fails on
  `warehouse_id NOT NULL`, with no partial row and no application branching
  ([investigations.md#not-null-before-fk](investigations.md#not-null-before-fk)).

> **Deliberate deviation from spec 04.** Spec 04 says the shipment is
> created with status `PENDING_DISPATCH`, null `carrier` /
> `tracking_number`, and that lifecycle transitions beyond
> `PENDING_DISPATCH` belong to a later spec
> ([spec 04, Scope and “What is not in this spec”](../specs/04-queue-worker-observability.md#scope)).
> The code instead creates the shipment already **`DISPATCHED`**, with a
> random but carrier-shaped `carrier` (UPS, FedEx, USPS or DHL), a
> `tracking_number` from `generateTrackingNumber`, and `dispatched_at = now`.
> `delivered_at` stays null: only dispatch is mocked. This was requested for
> local QA and demos, so a shipment can be inspected as dispatched
> immediately, without adding a delayed pg-boss job or a new queue. The
> tracking numbers are carrier-shaped, not carrier-verified: mock QA data,
> not a real format guarantee. This deviation is recorded here only; the
> spec was not changed.

Source: [spec 04, Scope](../specs/04-queue-worker-observability.md#scope);
[infrastructure.md, section 3](../engineering:documentation/infrastructure.md#3-one-repo-two-entrypoints)
(which uses this handler as its worked example).

<a id="pgboss-roles"></a>

## pg-boss roles

Code: `src/infrastructure/messaging/pg-boss.provider.ts` → `PG_BOSS`, `PgBossRole`, `PGBOSS_POOL_SIZE_API`, `pgBossProvider`

Each process gets exactly one `PgBoss` instance, keyed by the `PG_BOSS`
symbol (a third-party class, injected like the domain ports). The
`useFactory` is async: it starts the instance and runs `setupQueues` before
returning, and Nest awaits it before resolving any consumer, so nothing
ever sees a half-started instance.

Everything that differs between the two processes is decided by `role`:

| | api | worker |
|---|---|---|
| Purpose | publish, read queue state for readiness | supervise, maintain, schedule, consume |
| Pool (`max`) | `PGBOSS_POOL_SIZE_API = 2` | `PGBOSS_POOL_SIZE_WORKER = 5` |
| `supervise` / `schedule` | off | on |
| `useListenNotify` (dedicated LISTEN/NOTIFY connection) | off | on |

The api must never compete with the worker for maintenance or consume jobs.
These pools are pg-boss's own, separate from TypeORM's.

**Keep the `'error'` listener.** `PgBoss` is an `EventEmitter` and emits
`'error'` whenever its pool loses a connection (for example, Postgres
restarting). With no listener, Node throws and the whole process crashes.
This was found when `GET /health/ready` during `docker compose stop
postgres` killed the api outright, instead of the required behaviour
(`/health` keeps answering 200 while Postgres is down).

Source: [spec 04, Decisions › “The worker, its connections and shutdown” and “pg-boss@12 API” findings](../specs/04-queue-worker-observability.md#decisions).

## Graceful shutdown

Code:
- `src/infrastructure/messaging/job-runner.ts` → `GRACEFUL_SHUTDOWN_TIMEOUT_MS`, `JobRunner.onApplicationShutdown`
- `src/infrastructure/messaging/pg-boss-shutdown.hook.ts` → `PgBossShutdownHook`
- `src/main.worker.ts` → `bootstrap`

- **Worker**: on SIGTERM (`docker stop`), `JobRunner.onApplicationShutdown()`
  removes the readiness file and calls
  `boss.stop({ graceful: true, timeout: GRACEFUL_SHUTDOWN_TIMEOUT_MS })`,
  letting an in-flight job finish. `GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25_000`
  must stay under compose's 30 s `stop_grace_period`, so Docker never
  SIGKILLs mid-job. This only runs because `main.worker.ts` calls
  `app.enableShutdownHooks()`; without it an in-flight job is cut off
  mid-handler.
- **Api**: `PgBossShutdownHook` is registered only in `ApiModule`. The api's
  instance never consumes anything, so a plain `boss.stop()` is enough;
  there is nothing to drain, only a pool and pg-boss's internal timers that
  must not leak. Registering it in the worker too would call `boss.stop()`
  twice.
- Traces from the last job are flushed by the OpenTelemetry SDK shutdown
  handler ([observability.md#tracing-bootstrap](observability.md#tracing-bootstrap)).

Source: [spec 04, Decisions › “The worker, its connections and shutdown”](../specs/04-queue-worker-observability.md#decisions).
