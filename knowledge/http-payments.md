# HTTP adapters and payments

The payment port, its HTTP adapter (`HttpPaymentGateway`), the resilience
primitives shared with Geoapify (retry, circuit breaker, fetch error
classification), and the standalone `payments-mock` service.

Main sources: [spec 03, Data model and Decisions](../specs/03-external-adapters.md#decisions)
(outcome mapping, resilience, card description, mock semantics),
[spec 07, “Fix B — getStatus() classification”](../specs/07-hardening-demo.md#fix-b--getstatus-classification),
[infrastructure.md, section 4](../engineering:documentation/infrastructure.md#4-why-payments-mock-is-its-own-container),
and the README section "`payments-mock` — the four test cards".

## Port

Code: `src/domain/ports/payment-gateway.ts` → `PaymentGateway`, `ChargeCommand`, `ChargeCommand.idempotencyKey`, `ChargeResult`, `ChargeResult.rawResponse`

`PaymentGateway` has two methods: `charge(command)` and
`getStatus(idempotencyKey)`. It is implemented by `HttpPaymentGateway`.
Callers:
- the saga's charge phase calls `charge()`
  ([orders-saga.md#saga-phases](orders-saga.md#saga-phases));
- the reservation reaper and payment reconciliation call `getStatus()`
  ([messaging-jobs.md#reservation-reaper](messaging-jobs.md#reservation-reaper),
  [messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation)).

(An older version of the port's doc comment named a `MockPaymentGateway`;
no such class exists. The adapter is `HttpPaymentGateway`, talking to the
separate `payments-mock` service.)

- `ChargeCommand` is `{ cardNumber, amountMinor, currency, description,
  idempotencyKey }`: flat primitives, not a `Money` value object, because it
  crosses to an external HTTP provider that expects wire-format JSON.
- `ChargeCommand.idempotencyKey` is derived from the order id plus the
  attempt number, so a retry can never double-charge
  ([orders-saga.md#charge-idempotency-key](orders-saga.md#charge-idempotency-key)).
- `ChargeResult` carries enough to persist a `payments` row and choose the
  order's next transition. `status` reuses the domain's `PaymentStatus`,
  including `UNKNOWN` (for example a timeout), which reconciliation
  resolves later.
- `ChargeResult.rawResponse` is the **redacted** gateway payload, opaque to
  the domain. It never contains the full card number.

Source: [spec 01, “Port interfaces, frozen”](../specs/01-foundation.md#port-interfaces-frozen);
payment requirements in [architectural-requirements.md](../engineering:documentation/architectural-requirements.md).

## Failure codes

Code: `src/domain/ports/payment-failure-codes.ts` → `PAYMENT_FAILURE_CODES`

Pins the allowed values of `ChargeResult.failureCode`:

| Code | Meaning |
|---|---|
| `CARD_DECLINED` | 402, declined |
| `TIMEOUT` | the per-attempt timeout fired on the last attempt |
| `PROVIDER_ERROR` | 5xx on the last attempt |
| `CONNECTION_REFUSED` | `ECONNREFUSED`: provably never reached the provider |
| `NETWORK_ERROR` | `ECONNRESET`, DNS failure, …: may have reached it |
| `CIRCUIT_OPEN` | rejected by the breaker, never sent |
| `INVALID_REQUEST` | 400 / 422 from the provider (a bug on our side) |
| `NOT_FOUND` | `getStatus` only: the provider never stored this key |

It lives in the domain, beside the port, so the application layer imports
it without importing infrastructure
([references/layering.md](../references/layering.md)).

Source: [spec 03, Payment outcome mapping and Decisions › “Payment outcome classification”](../specs/03-external-adapters.md#payment-outcome-mapping).

## HTTP payment gateway

Code: `src/infrastructure/payments/http-payment-gateway.ts` → `HttpPaymentGateway`, `mapStatusResponse`

`HttpPaymentGateway` implements the port against `payments-mock` (or any
provider speaking the same wire contract) using native `fetch`.

- **It never throws on a provider failure.** Every branch resolves to a
  `ChargeResult`; classification is total. Callers can switch on `status`
  without a `try/catch` that might also swallow a programming error.
- `charge()` and `getStatus()` **share one circuit breaker and one retry
  policy**: they hit the same host, and because failures are counted per
  attempt, five failed attempts can come from as few as two orders
  ([Circuit breaker](#circuit-breaker)). One consequence: a `getStatus()`
  from the reaper can read `CIRCUIT_OPEN` for up to 30 s after `charge()`
  calls tripped the breaker ([scripts.md#demo](scripts.md#demo)).
- `mapStatusResponse` classifies `getStatus()` answers. Only recognised
  answers map to `CAPTURED` / `DECLINED`; a 404 is `FAILED` / `NOT_FOUND`;
  **anything unexpected is `UNKNOWN`, never a guess**. Previously every
  non-404 answer mapped to `CAPTURED`, so a 400, 401, 422, 429 or a 200 with
  an unexpected body all read as "the customer was charged".
  Reconciliation trusts this function, so it must not guess.

Source: [spec 03, Decisions › “Payment outcome classification” and “Circuit breaker”](../specs/03-external-adapters.md#decisions);
[spec 07, “Fix B — getStatus() classification”](../specs/07-hardening-demo.md#fix-b--getstatus-classification).

## Resilience

Code:
- `src/infrastructure/http/retry.ts` → `MAX_ATTEMPTS`, `withRetry`
- `src/infrastructure/payments/http-payment-gateway.ts` → `ATTEMPT_TIMEOUT_MS`, `RetryableProviderError`
- `src/infrastructure/geocoding/geoapify-geocoding.provider.ts` → `ATTEMPT_TIMEOUT_MS`

- **Timeout**: each attempt gets its own `AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)`
  (2000 ms), in both the payments and the Geoapify adapter.
- **Retry** (`withRetry`): up to `MAX_ATTEMPTS = 3`, with full-jitter
  exponential backoff (`BACKOFF_BASE_MS = 200`), retrying only what the
  caller's `isTransient` predicate marks as transient. Payments and
  Geoapify each pass their own predicate and use their own breaker.
- The **last attempt always returns its own outcome**: a resolved value is
  returned, a thrown error is rethrown. There is no wrapping "gave up after
  N attempts" error; the caller gets exactly what its classification
  produced.
- `RetryableProviderError` is the base class for every failure `fetch`
  itself can produce; it is the marker `isTransient` recognises.
  `CircuitOpenError` is deliberately **not** one: retrying it is pointless.
  No special case is needed in `withRetry`: "not transient" already means
  "return now, no delay", which is exactly the early exit the breaker
  needs.
- Worst case for one charge: 3 attempts × 2 s plus backoff (about 6.6 s),
  which is why reconciliation waits a 2-minute grace period
  ([messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation)).

Source: [spec 03, Resilience primitives and Decisions › “Retries and timeouts”](../specs/03-external-adapters.md#resilience-primitives).

## Circuit breaker

Code: `src/infrastructure/http/circuit-breaker.ts` → `CircuitBreaker`, `CircuitBreaker.execute`, `CircuitOpenError`, `BREAKER_FAILURE_THRESHOLD`, `BREAKER_OPEN_MS`

A hand-written, three-state breaker (closed, open, half-open), one per
provider: `HttpPaymentGateway`'s `charge()` and `getStatus()` share one,
Geoapify has its own.

- It counts each failed **attempt**, not each exhausted retry loop:
  `withRetry` calls `execute()` once per attempt. It opens after
  `BREAKER_FAILURE_THRESHOLD = 5` failures and stays open for
  `BREAKER_OPEN_MS = 30_000`.
- `execute()` takes no failure classifier. Whatever the operation throws is
  a failure; whatever it resolves is a success. The adapter decides what
  that means: a 402, or a 404 from `getStatus`, resolves normally and never
  counts. Only a 5xx, a network error or a timeout reaches the breaker as a
  failure. (Geoapify resolves 401/403 the same way; see
  [geocoding.md#geoapify](geocoding.md#geoapify).)
- Half-open lets **exactly one probe** through. A concurrent second call is
  rejected outright. The "probe in flight" flag is set synchronously, before
  the first `await`, so two back-to-back calls can never both see it unset.
- `CircuitOpenError` is thrown by `execute()` when the breaker rejects a
  call. It is infrastructure-internal and never crosses a port; the adapter
  turns it into `UNKNOWN` / `CIRCUIT_OPEN`.

Source: [spec 03, Decisions › “Circuit breaker”](../specs/03-external-adapters.md#decisions).

## Fetch errors

Code: `src/infrastructure/http/fetch-errors.ts` → `classifyFetchError`

`classifyFetchError` classifies whatever `fetch` or `AbortSignal.timeout`
throws (timeout, connection refused, other network error). It is shared by
`HttpPaymentGateway` and `GeoapifyGeocodingProvider`, the two adapters that
call `fetch` directly.

- It is **duck-typed** (`.name`, `.cause.code`) instead of using
  `instanceof DOMException` / `instanceof Error`. Node's native `fetch`
  (undici) and Jest's per-file sandbox (`jest-environment-node` gives each
  test file its own realm) can disagree on which `Error` / `DOMException`
  constructor built an error, which makes `instanceof` unreliable across
  that boundary. Property reads are not.
- Unknown shapes fall back to `network_error`. The caller maps that to its
  own `UNKNOWN`-style outcome, so the fallback is safe.

Source: [spec 03, Risks](../specs/03-external-adapters.md#risks).

## Card description

Code: `src/infrastructure/payments/card.ts` → `describeCard`

`cardLast4` and `cardBrand` are derived **locally from the card number**,
not read from the provider's response. Otherwise they would be `null` on
exactly the rows reconciliation needs (a timeout, a 500, an open breaker),
where no response ever arrived.

Brand by prefix:

| Brand | Prefixes |
|---|---|
| Visa | `4` |
| Mastercard | `51`–`55`, `2221`–`2720` |
| Amex | `34`, `37` |
| Discover | `6011`, `644`–`649`, `65` |
| anything else | `'unknown'` |

Source: [spec 03, Card description and Decisions › “Card data and the idempotency key”](../specs/03-external-adapters.md#card-description).

## payments-mock

Code:
- `payments-mock/src/charge.service.ts` → `ChargeService`, `ChargeService.process`, `IDEMPOTENCY_KEY_REUSED`
- `payments-mock/src/constants.ts` → `CARD_DECLINED_LAST4`, `APPROVED_DELAY_MIN_MS`
- `payments-mock/src/card.ts` → `cardLast4`
- `payments-mock/src/hash.ts` → `computeRequestHash`
- `payments-mock/src/server.ts` → `buildServer`
- `payments-mock/src/types.ts` → `ChargeRecord`, `ChargeResponseBody`, `ChargeStatusResponseBody`
- `payments-mock/src/main.ts`

A separate Fastify service in its own container, standing in for an external
payment provider. It never imports from the main app's `src/`; its
constants are its own literals, distinct from `PAYMENT_FAILURE_CODES`
([infrastructure.md, section 4](../engineering:documentation/infrastructure.md#4-why-payments-mock-is-its-own-container)).

**Endpoints:** `POST /charge` (200 approved / 402 declined body:
`ChargeResponseBody`) and `GET /charge/:idempotencyKey` (200:
`ChargeStatusResponseBody`, 404 if unknown), plus `/health`.

**Outcomes are keyed on the card's last four digits:**

| Card | Outcome |
|---|---|
| `…4242` (e.g. `4242424242424242`) | 200 approved after 200–600 ms (`APPROVED_DELAY_MIN_MS`/`_MAX_MS`) |
| `…0002` (`CARD_DECLINED_LAST4`) | 402 declined |
| `…0003` | 500 provider error |
| `…0004` | hangs 30 s, recorded as approved ([Card 0004](#card-0004)) |

**`ChargeService`** holds the mock's whole state machine: an in-memory `Map`
of stored charges (`ChargeRecord`, never a 500), a second `Map` of in-flight
promises (a second request with the same key awaits the first one's
result), and the card outcome table. One instance per process; **state is
lost on restart**, an accepted mock limitation (the demo restarts it on
purpose, see [scripts.md#demo](scripts.md#demo)).

**Idempotency:** for every card except `0004`, a repeated key replays the
stored response instantly (no new delay, no reprocessing). A **different
body** under the same key is a reuse, not a replay:
`422 idempotency_key_reused` (`IDEMPOTENCY_KEY_REUSED`). The body
fingerprint (`computeRequestHash`) is `sha256(last4|amountCents|currency|description)`.
The full card number is never part of it and never stored anywhere in the
service; only the last four digits (`cardLast4`) are stored or returned.

**`buildServer`** is the app builder: tests build a fresh instance per test
with injectable delays and call it through `fastify.inject()` (no socket);
`main.ts` builds the one instance that listens. `main.ts` logs with
`console` because the mock has no redacting logger of its own and no card
data reaches that line.

Source: [spec 03, “payments-mock wire contract” and Decisions › “payments-mock semantics”, “Packaging, tests and CI”](../specs/03-external-adapters.md#payments-mock-wire-contract).

## Card 0004

Code:
- `payments-mock/src/charge.service.ts` → `ChargeService.processCard0004`
- `payments-mock/src/constants.ts` → `CARD_0004_DELAY_MS`

Card `0004` simulates a provider that times out but did actually charge:

1. The delay check happens **before** the idempotency lookup.
2. The charge is recorded as **approved the moment it arrives**, before the
   delay, so a concurrent `GET /charge/:key` already sees it while the
   `POST` is still hanging.
3. The delay (`CARD_0004_DELAY_MS = 30_000`) then runs on **every** request
   for this key, replays included. The normal "already stored, replay
   instantly" shortcut never applies to this card.
4. Only after the delay does it check whether the body still matches what
   was recorded: a same-key, different-body request still ends in 422, just
   after paying the delay.

The delay is overridable per `buildServer()` call so tests do not wait 30 s.
Through `HttpPaymentGateway` this card ends as `UNKNOWN` / `TIMEOUT` (every
2 s attempt times out). The order stays `PENDING_PAYMENT`, and later
`getStatus()` returns `CAPTURED`, which is what reconciliation uses to
confirm it.

Source: [spec 03, Decisions › “payments-mock semantics”](../specs/03-external-adapters.md#decisions).
