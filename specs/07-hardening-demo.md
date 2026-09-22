# SPEC 07 — P6 Hardening and Demo

> **Status:** Approved
> **Depends on:** SPEC 03 (`PaymentGateway.getStatus`, `redact()`), SPEC 04
> (pg-boss worker, `JobRunner`, tracing), SPEC 05 (the saga, the
> `idempotency_keys` dance, `problem-details.filter.ts`)
> **Date:** 2026-09-21
> **Objective:** Close the two failure paths that make the design honest —
> orphaned reservations and unknown payments — fix the three defects the
> post-P5 audit found on exactly those paths (log/span redaction,
> `getStatus()` classification, the `502` body), then make the whole thing
> provable and reviewable in under five minutes.

## Scope

**In:**

- **Pre-requisite fixes from the post-P5 audit** (they sit on the paths P6
  builds on, so they land first):
  - **Fix A — redaction holes (R2.3, SPEC 04 AC "no span attribute").**
    `pinoOptions.formatters.log` only sees the merge object; the message
    string (`logger.info('… 4242424242424242 …')`, every Nest
    `Logger.log('<string>')`, the `msg` of a logged `Error`) bypasses
    `redact()`. Spans have no redaction at all: `span.recordException(error)`
    in `job-runner.ts` stores the raw message and stack.
  - **Fix B — `getStatus()` classification (SPEC 03).**
    `mapStatusResponse` maps every non-`404` answer to `CAPTURED`: a `400`,
    `401`, `422`, `429` or a `200` with an unexpected body all read as "the
    customer was charged". Reconciliation (R6.2) trusts this function; as is,
    it would confirm orders nobody paid for. The key is also interpolated
    into the URL without encoding.
  - **Fix C — the `502` contract (SPEC 03 handoff to P4, never delivered).**
    The `502` body must carry the `orderId` and say the payment is pending
    confirmation, so the client polls `GET /orders/:id` instead of
    re-posting with a new `Idempotency-Key` (which could charge twice). The
    idempotency row is also completed with `order_id = null` on every error,
    so a replay cannot point the client at the order either.
- **R6.1 — reservation reaper.** Scheduled job over `PENDING_PAYMENT` orders
  past `reservation_expires_at`; resolves each one against
  `getStatus()` — confirm, fail, cancel, or leave and alert.
- **R6.2 — payment reconciliation.** Scheduled job over `payments` with
  `settled_at IS NULL` older than a grace interval; settles the row and the
  order when the provider gives a definitive answer.
- A shared **`OrderSettlementService`** used by the saga's Phase 3, the
  reaper and reconciliation — one implementation of "settle this order",
  guarded by a row lock so two settlers can never both win.
- **R6.3** — `scripts/concurrency-e2e.ts`: the concurrency proof through the
  full HTTP stack.
- **R6.4** — `scripts/demo/`: one command that walks every failure path with
  the expected output beside the actual one, and ends with the log grep
  (AC 7).
- **R6.5** — README rewrite: clone-to-order in under five minutes.
- **R6.6** — operational polish: helmet, explicit CORS, body size limit,
  rate limiting, OpenAPI at `/docs`, graceful shutdown verified.
- **R6.7** — clean-clone rehearsal, recorded in this spec.

**Out of scope (for future specs):**

- The remaining audit findings not selected for this spec — each is listed
  under *Known limitations* in the README (R6.5) instead of silently
  dropped:
  - generic `500`s stored as `COMPLETED` in `idempotency_keys` (replayed
    forever);
  - re-posting an expired `Idempotency-Key` returns `500`, and a row left
    `IN_PROGRESS` by a crash blocks its key until expiry — SPEC 05's Risks
    handed the post-expiry semantics to P6; this spec defers the decision
    again, explicitly, instead of inheriting it by accident;
  - `GET /orders` cursor with a non-UUID id → `500`, and millisecond cursor
    precision vs microsecond `created_at`;
  - `RESERVATION_TTL_MINUTES` env var validated but unused;
  - `verify-ledger.sql` compares snapshots, not a full replay;
  - application → infrastructure imports not lint-enforced; the HTTP-client
    lint barrier misses global `fetch` and `node:http`;
  - no `healthcheck` on the `api` compose service.
- Physical purge of expired `idempotency_keys` rows.
- Two api instances behind nginx (R6.3's optional NFR-7 run) — there is no
  nginx profile in `docker-compose.yml` today; adding one is its own change.
- Deployment (phases/06, explicitly dropped). Bulk and `PATCH` (P7).

## Data model

No new migration. `idx_orders_reaper (status, reservation_expires_at)` and
`idx_payments_reconciliation (status, created_at)` exist since SPEC 01.

### Fix A — redaction

```ts
// pino.config.ts — added beside formatters.log
hooks: {
  // Runs before pino builds the line: every positional argument — the
  // message string, printf-style interpolation values, an Error passed
  // first — goes through redact(). formatters.log still covers the merge
  // object; together they are the whole line.
  logMethod(args, method) {
    return method.apply(this, args.map((arg) => redact(arg)) as typeof args);
  },
},
```

`redactError()` keeps returning a plain object, so a logged `Error` loses its
prototype — it is serialised by pino's `err` serializer from that object;
the audit's "`type: Object`" cosmetic is accepted (see Risks).

```ts
// src/infrastructure/observability/redacting-span-exporter.ts
// Wraps the OTLP exporter: every span's attributes, and every event's
// attributes (recordException writes exception.message /
// exception.stacktrace there), pass through redact() before export. Same
// single-choke-point idea as the pino formatter.
export class RedactingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}
  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}
```

`job-runner.ts` also passes a redacted message to `span.setStatus()` —
the status message is not an attribute, so the exporter wrapper does not
cover it.

### Fix B — `getStatus()` classification

| Provider answer | `ChargeResult.status` | `failureCode` |
|---|---|---|
| `200`, body `status: 'approved'` | `CAPTURED` | `null` |
| `200`, body `status: 'declined'` | `DECLINED` | `CARD_DECLINED` |
| `404` | `FAILED` | `NOT_FOUND` |
| `5xx`, timeout, network, circuit open | `UNKNOWN` | as today (`buildUnknownResult`) |
| any other status, or a `200` whose `status` is neither value | `UNKNOWN` | `INVALID_REQUEST` |

`getCharge()` builds the URL with `encodeURIComponent(idempotencyKey)`.
No new failure code — `INVALID_REQUEST` already means "the provider answered
something we don't understand; a bug on one side, not a card outcome".

### Fix C — `502` body

```ts
// create-order.errors.ts
export class PaymentProviderUnavailableError extends Error {
  constructor(params: { orderId: string; failureCode: string | null })
}
export class PaymentDeclinedError extends Error {
  constructor(params: { orderId: string; failureCode: string | null })
}
```

Both errors are only ever raised after the order row exists, so both carry
its id. `ProblemShape`/`ProblemDetails` gain an optional RFC 9457
extension member `orderId`, set **only** for the `502`:

```json
{
  "type": "urn:problem-type:payment-provider-unavailable",
  "title": "Payment provider unavailable",
  "status": 502,
  "detail": "Payment outcome unknown (TIMEOUT). Order 7c9e… is pending confirmation — poll GET /orders/7c9e…; do not retry with a new Idempotency-Key.",
  "instance": "/orders",
  "correlationId": "…",
  "orderId": "7c9e…"
}
```

`CreateOrderIdempotentService.runAndRecord` stores `orderId` in
`idempotency_keys.order_id` whenever the thrown error carries one (`402` and
`502`), and copies the `orderId` extension into the stored body, so a replay
is byte-identical to the first response.

### Saga — `payments.settled_at`

`chargeOrder()` sets `settled_at` only for a definitive outcome
(`CAPTURED`, `DECLINED`). `UNKNOWN` leaves it `NULL`. Today it is set for
every outcome, which would make R6.2's `settled_at IS NULL` query miss
exactly the rows it exists for.

### `OrderSettlementService` (`src/application/orders/order-settlement.service.ts`)

```ts
export type SettlementOutcome = 'SETTLED' | 'ALREADY_SETTLED';

export interface PaymentResolution {
  paymentId: string;
  chargeResult: ChargeResult;
}

@Injectable()
export class OrderSettlementService {
  // CAPTURED: commit reservation, PENDING_PAYMENT -> PAID -> CONFIRMED,
  // publish order.confirmed — one transaction.
  confirmCaptured(params: { orderId: string; payment?: PaymentResolution }):
    Promise<{ outcome: SettlementOutcome; order: Order }>

  // DECLINED: release reservation, PENDING_PAYMENT -> PAYMENT_FAILED.
  failDeclined(params: { orderId: string; payment?: PaymentResolution }):
    Promise<{ outcome: SettlementOutcome; order: Order }>

  // Never charged: release reservation, PENDING_PAYMENT -> CANCELLED(reason).
  cancelUnpaid(params: { orderId: string; reason: string; payment?: PaymentResolution }):
    Promise<{ outcome: SettlementOutcome; order: Order }>
}
```

Every method, inside one transaction:

1. `SELECT … FROM orders WHERE id = $1 FOR UPDATE` and rebuild the domain
   `Order` from the row — never trust a caller's in-memory copy.
2. If the status is no longer `PENDING_PAYMENT` → return `ALREADY_SETTLED`
   and change nothing.
3. If `payment` is given, update that `payments` row from the
   `ChargeResult` (`status`, `provider_payment_id`, `card_last4`,
   `failure_code`, `raw_response`, `settled_at = now()`), guarded by
   `WHERE status IN ('PENDING', 'UNKNOWN')`.
4. Inventory `commit`/`release` (already idempotent on the ledger), the
   domain transition, save, and — for `confirmCaptured` only — publish
   `order.confirmed` through the same transaction.

The saga's Phase 3 calls `confirmCaptured`/`failDeclined` without
`payment` (it already wrote the row in Phase 2); the jobs pass it.

### Scheduled jobs

```ts
// queue-setup.ts — beside QUEUE_TOPOLOGY
export const SCHEDULED_JOBS = [
  { queue: 'reservation.reap', cron: '* * * * *' },
  { queue: 'payment.reconcile', cron: '* * * * *' },
] as const;
```

- Created with `retryLimit: 0` and **no** DLQ: a failed run is simply the
  next minute's run; a dead-letter copy of an empty tick is noise.
- `boss.schedule(queue, cron, { payload: {} })` is called from the worker
  only (the api's instance has `schedule: false`). pg-boss's scheduler emits
  at most one job per cron tick across all worker instances, so two workers
  never reap in parallel from the scheduler's side; `FOR UPDATE SKIP LOCKED`
  below covers the rest.
- Handlers implement the existing `JobHandler` contract and join
  `JOB_HANDLERS`, so tracing, correlation and logging come from
  `JobRunner` for free. `JobRunner` generates a `correlationId` when a job
  has no `meta` (scheduled jobs are born without a request).

```ts
// src/application/jobs/reservation-reaper.handler.ts
export const REAPER_BATCH_SIZE = 50;
/** Past expiry by this much and still UNKNOWN → alert on every run. */
export const REAPER_ALERT_AFTER_MINUTES = 30;

// src/application/jobs/payment-reconciliation.handler.ts
export const RECONCILIATION_BATCH_SIZE = 50;
/** Grace before reconciling: longer than the gateway's worst case (3 × 2 s + backoff). */
export const RECONCILIATION_GRACE_MINUTES = 2;
```

**Reaper (R6.1)** — per run:

```sql
SELECT o.id, o.reservation_expires_at,
       p.id AS payment_id, p.idempotency_key
FROM orders o
LEFT JOIN LATERAL (
  SELECT id, idempotency_key FROM payments
  WHERE order_id = o.id ORDER BY attempt DESC LIMIT 1
) p ON true
WHERE o.status = 'PENDING_PAYMENT' AND o.reservation_expires_at < now()
ORDER BY o.reservation_expires_at
LIMIT $1
FOR UPDATE OF o SKIP LOCKED
```

(Selection only; the lock is released at the end of this statement's own
transaction and re-taken by `OrderSettlementService`, which re-checks the
status. `SKIP LOCKED` keeps two concurrent runs off the same rows.)

For each row:

| Situation | Action |
|---|---|
| No `payments` row (crash between Phase 1 and Phase 2) | `cancelUnpaid(reason: 'RESERVATION_EXPIRED_NO_PAYMENT')` |
| `getStatus(key)` → `CAPTURED` | `confirmCaptured({ payment })` |
| → `DECLINED` | `failDeclined({ payment })` |
| → `FAILED` / `NOT_FOUND` | `cancelUnpaid({ reason: 'RESERVATION_EXPIRED_NOT_CHARGED', payment })` |
| → `UNKNOWN` | leave it; `warn` log. Past `REAPER_ALERT_AFTER_MINUTES` → `error` log `reservation unresolved` with `orderId` (the alert) — still never released blindly |

One order's failure is logged and does not abort the batch.

**Reconciliation (R6.2)** — per run:

```sql
SELECT id, order_id, idempotency_key FROM payments
WHERE settled_at IS NULL AND status IN ('PENDING', 'UNKNOWN')
  AND created_at < now() - ($1 * interval '1 minute')
ORDER BY created_at
LIMIT $2
FOR UPDATE SKIP LOCKED
```

Acts **only on definitive answers**: `CAPTURED` → `confirmCaptured`,
`DECLINED` → `failDeclined`. `NOT_FOUND` and `UNKNOWN` are left to the
reaper — only the reaper, after the TTL, may conclude "never charged" (see
Decisions).

### R6.6 — HTTP hardening (`main.ts`)

```ts
app.use(helmet());
app.enableCors({ origin: corsOrigins, methods: ['GET', 'POST'] });
app.useBodyParser('json', { limit: BODY_LIMIT });          // '16kb'
// ThrottlerModule.forRoot([{ ttl: 60_000, limit: RATE_LIMIT_PER_MINUTE }])
// + APP_GUARD ThrottlerGuard in ApiModule; @SkipThrottle() on /health*.
SwaggerModule.setup('docs', app, document);
```

- `CORS_ORIGINS` — new env var (comma-separated, validated in
  `env.schema.ts`, default `http://localhost:3000`). An allowed origin is
  exactly the kind of value an operator changes per deployment, so it is an
  env var, not a constant (`references/coding-conventions.md`).
- `BODY_LIMIT = '16kb'`, `RATE_LIMIT_PER_MINUTE = 600` — named constants.
  600/min/IP comfortably covers R6.3's burst (N + 20 = 70 by default) — see
  Risks.
- OpenAPI via `@nestjs/swagger` with the CLI plugin in `nest-cli.json`
  (introspects the class-validator request DTOs). The response DTOs are
  interfaces, so they are described with `@ApiResponse` descriptions, not
  generated schemas.

## Implementation plan

Each step ends with `npm run lint`, `npm run build` and `npm run test:unit`
green; one commit per step (CLAUDE.md, `/spec-impl` loop).

1. **Fix A.1 — pino message redaction.** `hooks.logMethod` in
   `pino.config.ts`.
   *Verify:* unit tests over an in-memory stream — `info('card
   4242424242424242 failed')`, `info({ a: 1 }, 'key apiKey=abc')`, and
   `error(new Error('… 4242424242424242'))` all print masked values in
   `msg`; the existing object test still passes.

2. **Fix A.2 — span redaction.** `RedactingSpanExporter` wrapping
   `OTLPTraceExporter` in `tracing.ts`; `job-runner.ts` passes
   `redact(message)` to `setStatus`.
   *Verify:* unit test — wrap an `InMemorySpanExporter`, record a span with
   a PAN in an attribute and a `recordException(new Error('…PAN…'))`; the
   exported span's attributes and event attributes are masked, and the
   exported object still exposes `spanContext()` (prototype preserved).

3. **Fix B — `getStatus()` classification.** Table above;
   `encodeURIComponent` on the key.
   *Verify:* unit tests with a stubbed `fetch` — one per table row,
   including `200 { status: 'weird' }`, `400`, `401`, `429` → `UNKNOWN`
   `INVALID_REQUEST`; a key containing `:` reaches the URL encoded.

4. **Fix C — `502` body and idempotency `order_id`.** Error constructors
   take `{ orderId, failureCode }`; `buildProblem` adds `orderId` + the
   pending-confirmation `detail` for the `502`; `runAndRecord` stores
   `order_id` for `402`/`502`.
   *Verify:* filter unit test for the `502` shape; e2e (`orders.e2e-spec.ts`,
   card 0004 or stopped provider stub) asserts `body.orderId` exists, `GET
   /orders/:id` returns it as `PENDING_PAYMENT`, and a replay with the same
   key returns the identical body; integration test asserts
   `idempotency_keys.order_id` is set for a `402`.

5. **Saga — `settled_at` only on definitive outcomes.**
   *Verify:* integration test (`create-order.use-case.integration.spec.ts`)
   — an `UNKNOWN` charge leaves `payments.settled_at IS NULL`; `CAPTURED`
   and `DECLINED` set it.

6. **`OrderSettlementService` + saga Phase 3 on top of it.**
   *Verify:* integration tests — each method from `PENDING_PAYMENT` does
   the right transition, inventory movement and (confirm only) exactly one
   queued job set; calling any method on an order already `CANCELLED` or
   `CONFIRMED` returns `ALREADY_SETTLED` and writes nothing (no new
   `inventory_movements` row, no job); two concurrent `confirmCaptured` +
   `cancelUnpaid` on the same order → exactly one wins. The existing saga
   integration and e2e suites stay green unchanged.

7. **Scheduled-job plumbing.** `SCHEDULED_JOBS` created in `setupQueues`;
   worker calls `boss.schedule`; `JobRunner` tolerates a job without `meta`.
   *Verify:* integration test — after worker-side setup,
   `boss.getSchedules()` lists both queues; a job with `{ payload: {} }` and
   no `meta` runs its handler with a generated `correlationId`.

8. **R6.1 — `ReservationReaperHandler`.**
   *Verify:* integration tests with a fake `PaymentGateway` — one expired
   order per table row (no payment, `CAPTURED`, `DECLINED`, `NOT_FOUND`,
   `UNKNOWN`) reaches the expected state; inventory returns to its
   pre-order balances on release, `quantity_reserved` drops to 0 on commit;
   `UNKNOWN` past `REAPER_ALERT_AFTER_MINUTES` emits the `error` line;
   non-expired orders are untouched; one order whose settlement throws does
   not stop the others.

9. **R6.2 — `PaymentReconciliationHandler`.**
   *Verify:* integration tests — an `UNKNOWN` payment older than the grace
   with provider `CAPTURED` → payment `CAPTURED`/settled, order
   `CONFIRMED`; `DECLINED` → `PAYMENT_FAILED`, stock released; `NOT_FOUND`
   and `UNKNOWN` → nothing changes; a payment younger than the grace is not
   selected.

10. **R6.6 — helmet, CORS, body limit, throttler.** `CORS_ORIGINS` in
    `env.schema.ts` and `.env.example`.
    *Verify:* e2e — response carries helmet headers; a disallowed `Origin`
    gets no `Access-Control-Allow-Origin`; a 20 kB body → `413`; request
    601 within a minute → `429`; `/health` is never throttled.

11. **R6.6 — OpenAPI at `/docs`.**
    *Verify:* e2e — `GET /docs-json` returns a document listing
    `POST /orders`, `GET /orders`, `GET /orders/{id}` with the
    `Idempotency-Key` header documented; `GET /docs` → `200` HTML.

12. **R6.3 — `scripts/concurrency-e2e.ts`** + `npm run concurrency-e2e`
    (added to `verify`). Own fixture (reset each run, like
    `concurrency-check`): one product with exactly N units in one dedicated
    warehouse, nowhere else. Fires N + 20 concurrent `POST /orders`
    (approving card, distinct keys, shared start gate).
    *Verify:* the printed summary shows exactly N `201` `CONFIRMED`, 20
    `422`/`409`, `quantity_available = 0`, `quantity_reserved = 0`, ledger
    reconciles; 5 consecutive runs green, never N + 1.

13. **R6.4 — `scripts/demo/`** (`npm run demo`, TypeScript over `fetch` +
    `docker compose stop|start payments-mock`). Walks, printing expected vs
    actual per scenario:
    1. happy path → `201`, warehouse + distance;
    2. declined card (…0002) → `402`, stock back;
    3. provider timeout (…0004) → `502` with `orderId`, order
       `PENDING_PAYMENT`, reservation held;
    4. reaper resolves (3): the demo moves its `reservation_expires_at` into
       the past (a documented demo shortcut — the real TTL is 15 min) and
       waits ≤ 75 s for the next tick → `CONFIRMED` (the mock recorded the
       charge). Runs **before** any mock restart, which would wipe that
       record (Risks);
    5. provider down (`docker compose stop payments-mock`) → `502`, breaker
       opens (following calls fail fast);
    6. mock restarted, (5)'s order expired the same way → reaper →
       `CANCELLED`, stock back to its pre-order balance;
    7. unsatisfiable order → `422`;
    8. duplicate `Idempotency-Key` → identical body, one `payments` row;
    9. runs `concurrency-e2e`;
    10. greps `docker compose logs` for every test PAN and for
        `GEOAPIFY_API_KEY`'s value → must be empty.
    *Verify:* `npm run demo` exits `0` twice in a row on a fresh
    `docker compose up`.

14. **R6.5 — README.** Replace the Nest boilerplate: prerequisites,
    one-command start, port map, the design on ~1 page (why three phases and
    not one transaction, why warehouse selection is one statement, why the
    queue lives in PostgreSQL), a copy-pasteable `curl` per R6.4 scenario,
    the `GEOCODING_DRIVER=geoapify` switch and attribution, *Known
    limitations* (the out-of-scope list above + FR-10/FR-11 scoped out, with
    reasons). Fix the stale bits: `/internal/events/order-confirmed`
    walkthroughs, `docker stop payments-mock` →
    `docker compose stop payments-mock`, the `require('pg-boss')` note.
    *Verify:* every `curl` in the README pasted against a running stack
    gives the documented status.

15. **R6.6 + R6.7 — shutdown check and clean-clone rehearsal.** `docker
    compose stop` mid-`concurrency-e2e`: api and worker exit within the
    grace period, no stuck `IN_PROGRESS` job. Then a fresh `git clone` into
    a new directory, `docker compose down -v` beforehand, follow only the
    README to a `201`, then `npm run demo`. Record time-to-first-order and
    anything that had to be fixed in *Rehearsal notes* at the end of this
    spec.
    *Verify:* `npm run verify` green; rehearsal notes filled in.

## Acceptance criteria

- [ ] A log line built from a string containing a PAN, and an `Error` whose message contains one, both print it masked.
- [ ] No exported span attribute or span event contains a PAN.
- [ ] `getStatus()` returns `CAPTURED` only for a `200` with `status: 'approved'`; any unexpected answer is `UNKNOWN`.
- [ ] A `502` from `POST /orders` carries `orderId`, says the payment is pending confirmation, and replays byte-identically.
- [ ] An order left `PENDING_PAYMENT` past its TTL is resolved by the reaper — settled or released, never left hanging — unless the provider still answers `UNKNOWN`, in which case it is alerted on, not released.
- [ ] Two settlers racing on the same order: exactly one transition, one set of inventory movements, at most one `order.confirmed`.
- [ ] Killing `payments-mock` mid-flight and restarting it leads to a correct final state with no stock lost or leaked.
- [ ] The concurrency proof passes repeatedly, never N + 1.
- [ ] Every scenario in R6.4 produces its documented output.
- [ ] A clean clone reaches a successful order in under five minutes following only the README.
- [ ] `/docs` renders the OpenAPI spec.
- [ ] A `grep` for card numbers and secrets across the logs of a full demo run returns nothing.

## Decisions

- **Yes:** the three audit fixes (A, B, C) go first, inside this spec.
  B and C sit directly on the paths R6.1/R6.2 build on — reconciliation
  trusting a `getStatus()` that says `CAPTURED` for a `429` would turn a
  resilience feature into a correctness bug — and A is AC 7 of the phase
  itself.
- **No:** a separate "fixes" spec before P6. Same files, same reviewer
  pass, and the phase's own ACs cannot be ticked without them.
- **Yes:** pino `hooks.logMethod` for message redaction, in addition to
  `formatters.log`. It is pino's documented pre-serialisation hook for the
  positional arguments; `formatters.log` never sees `msg`.
- **No:** a custom `msg` serializer or a transport that regex-redacts the
  final JSON line. A transport runs after the line exists (a worker thread
  that could fail open), and redacting JSON text is fragile.
- **Yes:** redaction at the span **exporter**, one choke point for every
  span and event attribute, including auto-instrumented ones.
- **No:** a `SpanProcessor.onEnd` that mutates attributes. `ReadableSpan`
  is read-only by contract; mutating it depends on SDK internals.
- **Yes:** an unexpected `getStatus()` answer is `UNKNOWN`, never a guess.
  `UNKNOWN` is the one outcome both jobs are built to leave alone and
  retry; a wrong `CAPTURED` ships goods unpaid, a wrong `NOT_FOUND`
  releases stock that was paid for.
- **Yes:** `orderId` as an RFC 9457 extension member, only on the `502`.
  It is the one error where the client must act on the order rather than
  on the request; a `402` is terminal and the client re-posts a new order.
  The idempotency row still records `order_id` for both, because both
  created an order.
- **Yes:** one `OrderSettlementService`, used by the saga and both jobs,
  that locks the order row and re-reads its status before any transition.
  Without it, three code paths implement "settle", and the saga's in-memory
  `Order` could overwrite a `CANCELLED` written by the reaper (the saga's
  Phase 3 today saves without re-checking). The TTL (15 min) vs the saga's
  worst case (~13 s) makes that race unlikely, not impossible — a paused
  process or a GC stall is enough.
- **No:** a conditional `UPDATE … WHERE status = 'PENDING_PAYMENT'` alone.
  It guards the status but not the inventory movements and event publish
  that happen in the same transaction; the row lock guards all of it.
- **Yes:** this spec modifies SPEC 05-owned files (`create-order.use-case.ts`,
  `create-order.errors.ts`, `create-order-idempotent.service.ts`,
  `problem-details.filter.ts`) and SPEC 03/04-owned ones (`http-payment-gateway.ts`,
  `pino.config.ts`, `tracing.ts`, `job-runner.ts`, `queue-setup.ts`,
  `worker.module.ts`, `main.ts`). The phase file lists only new paths, but
  P6 is Wave 4 and runs alone — the "each phase owns files" rule exists to
  keep *parallel* sessions apart, and there is none. Every change is listed
  here so the reviewer sees the blast radius.
- **Yes:** only the reaper may conclude "never charged" (`NOT_FOUND` →
  release). Reconciliation acts only on `CAPTURED`/`DECLINED`. A `404` two
  minutes after a charge could, with a real provider, still be a request in
  flight; after the 15-minute TTL it cannot. The phase says the two jobs
  "overlap by design" — they do, on the definitive answers, and diverge on
  the ambiguous one.
- **Yes:** `DECLINED` from `getStatus()` → `PAYMENT_FAILED`, not
  `CANCELLED`. phases/06 says "not charged → CANCELLED", but a declined
  charge is exactly what the saga already maps to `PAYMENT_FAILED`; the
  same provider fact must not produce two states depending on who asked.
  `CANCELLED` is reserved for "the provider never saw this charge".
- **Yes:** "bounded attempts before alerting" is time-based
  (`REAPER_ALERT_AFTER_MINUTES` past expiry, i.e. ~30 one-minute runs), and
  the reaper keeps retrying after it alerts. No migration, no counter
  column. An `UNKNOWN` is never auto-released: releasing stock for a charge
  that did go through is worse than holding it until a human looks.
- **No:** a `reconcile_attempts` column. A migration for a counter whose
  only use is "log louder after N" — elapsed time already measures it.
- **Yes:** pg-boss `schedule()` on the worker for both jobs. The worker
  already runs the scheduler (`schedule: true`), pg-boss dedupes cron ticks
  across instances, and the jobs get tracing/correlation/logging from
  `JobRunner` with no new code.
- **No:** `@nestjs/schedule` / `setInterval`. Runs once per process, so two
  workers reap twice, and bypasses the observability `JobRunner` gives.
- **Yes:** the demo shortens the TTL by updating `reservation_expires_at`
  in the database, and says so in its output. Waiting 15 minutes is not a
  demo; lowering the constant would demo a different system.
- **Yes:** `CORS_ORIGINS` is an env var; body limit and rate limit are
  constants (`references/coding-conventions.md`).

## Risks

| Risk | Mitigation |
|---|---|
| `payments-mock` keeps charges in memory, so after a restart `getStatus()` answers `404` for charges it did make — the reaper would release stock for a paid order. | Mock-only: a real provider persists charges. The demo resolves the `0004` order (scenario 4) before it ever stops the mock (scenario 5). Stated in README *Known limitations*. |
| `RATE_LIMIT_PER_MINUTE` throttles `concurrency-e2e` / `demo` (all requests from one IP). | 600/min vs 70 requests by default; the script refuses an N whose burst exceeds the limit, with a message naming the constant. |
| `RedactingSpanExporter` copies spans; a plain spread loses `ReadableSpan` methods defined on the prototype (`spanContext()`), and the OTLP serializer calls them. | Copy with `Object.create(Object.getPrototypeOf(span))` + own properties, then override `attributes`/`events`. Step 2's test exports through the wrapper and calls `spanContext()` on the result. |
| Refactoring the saga's Phase 3 onto `OrderSettlementService` changes the most sensitive code path in the repo. | Step 6 lands alone, keeps every existing saga integration and e2e test unchanged and green, and adds the race test. |
| Reaper and reconciliation select the same order in the same minute. | Both go through `OrderSettlementService`'s row lock + status re-check; the loser gets `ALREADY_SETTLED`. `SKIP LOCKED` on selection keeps them from even waiting on each other. |
| `concurrency-check` (P1) leaves N + 20 `PENDING_PAYMENT` orders with no `payments` row; the reaper will cancel them after 15 min. | Correct behaviour, and a free real-data exercise of the "no payment row" branch. Noted in the README so it is not mistaken for a bug. |
| Helmet's default CSP blocks Swagger UI's inline assets on `/docs`. | Step 11 verifies `/docs` renders in a browser; if CSP blocks it, relax CSP for the `/docs` route only, not globally. |

## What is **not** in this spec

- The audit findings listed under *Out of scope* — documented as known
  limitations, not fixed.
- Purging expired `idempotency_keys` and deciding post-expiry key semantics.
- nginx / multi-instance run of the concurrency proof.
- Deployment. Bulk and `PATCH` (P7 — gated on this spec being green).

Each of these, if it lands, goes in its own spec.

## Rehearsal notes

*(Filled in at step 15.)*
