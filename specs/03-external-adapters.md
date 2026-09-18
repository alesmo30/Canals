# SPEC 03 — P2 External Adapters: payment gateway, geocoding and the payments mock

> **Status:** Implemented
> **Depends on:** SPEC 01
> **Date:** 2026-09-17
> **Objective:** Implement SPEC 01's `PaymentGateway` and `GeocodingProvider` ports — against a standalone `payments-mock` service, a deterministic static geocoder and an opt-in Geoapify adapter — so that every provider failure ends in a typed, reproducible outcome within a bounded time, and no card number ever reaches a log.

## Scope

**In:**

- **`payments-mock` service.** A standalone Fastify + TypeScript package in
  `payments-mock/`, with its own `package.json` and `tsconfig.json`, built by a
  multi-stage `docker/payments-mock.Dockerfile` and added to `docker-compose.yml`
  on port 4000 with a healthcheck. `api` waits for it on `condition: service_healthy`.
  - `POST /charge` takes `{ cardNumber, amountCents, currency, description }` plus
    an `Idempotency-Key` header. Outcomes are keyed on the card's last four digits:
    `0002` → `402` declined, `0003` → `500`, `0004` → approved but answered after
    ~30 s, anything else → approved after 200–600 ms.
  - A repeated key replays the stored response. `0004` is delayed on **every**
    request, replays included — the delay is checked before the idempotency
    lookup. A `500` is never stored. The same key with a different body →
    `422 idempotency_key_reused`. A second request arriving while the first is
    in flight awaits the same result.
  - `GET /charge/:idempotencyKey` answers immediately: `200` with `approved` or
    `declined`, `404` for a key it never stored.
  - `GET /health`. State is an in-memory `Map`, lost on restart.
  - Responses never contain the full card number — `last4` at most.
- **Resilience primitives** in `src/infrastructure/http/`:
  - `retry.ts` — up to 3 attempts, exponential backoff with jitter, retrying
    only what a caller-supplied predicate marks transient.
  - `circuit-breaker.ts` — hand-written, with an injectable clock. Counts each
    failed **attempt**. Opens after 5 consecutive failures, half-opens after
    30 s and lets exactly one probe through. Logs every state change at `warn`
    and exposes a `state` getter. An open breaker stops the retry loop at once.
- **`HttpPaymentGateway`** in `src/infrastructure/payments/`, implementing
  `PaymentGateway` with native `fetch` and a 2 s `AbortSignal.timeout` per attempt.
  - `charge()` retries on 5xx, network errors and timeouts — never on `402`.
  - It never throws on a provider failure. `2xx` → `CAPTURED`. `402` →
    `DECLINED`. Everything else → `UNKNOWN`, with `failureCode` set to
    `TIMEOUT`, `PROVIDER_ERROR`, `CONNECTION_REFUSED`, `NETWORK_ERROR`,
    `CIRCUIT_OPEN` or `INVALID_REQUEST`.
  - `getStatus()` shares the same breaker and the same retries. `approved` →
    `CAPTURED`, `declined` → `DECLINED`, `404` → `FAILED` with
    `failureCode: 'NOT_FOUND'`, a provider failure → `UNKNOWN`.
  - It forwards `command.idempotencyKey` unchanged on every attempt.
  - `cardLast4` and `cardBrand` are derived locally by `describeCard()` in
    `card.ts`, so they are present even on `UNKNOWN`. `rawResponse` is passed
    through `redact()`.
- **PAN and secret redaction.** A pure `redact()` in
  `src/infrastructure/http/redaction.ts`, plus `nestjs-pino` installed as the
  logger of both entrypoints with `redact()` applied to every log line, and an
  ESLint `no-console` rule so nothing in the app writes around it.
  - It redacts by key (`cardNumber`, `card_number`, `pan`, `apiKey`, at any
    depth).
  - It also redacts by value: any string containing a Luhn-valid run of 13–19
    digits, spaces and dashes allowed.
  - A PAN is masked as `************0004`. An API key becomes `[REDACTED]`,
    including when it sits in a URL query string.
- **`StaticGeocodingProvider`**, the default. A table of ~30 US cities, keyed
  by normalised `city|state`, plus a `sha256` jitter of up to ±0.05° computed
  from the normalised address without the `recipient`.
  - With no `state`, it matches on city alone only when the name is unique in
    the table.
  - It accepts `US`, `USA` and `United States` as the country.
  - An unknown city, an ambiguous city or a non-US country throws
    `GeocodingFailedError` with reason `UNKNOWN_ADDRESS` and a message pointing
    at the README.
  - It logs a boot `warn` saying it is for demo and test use only.
- **`GeoapifyGeocodingProvider`**, opt-in. It calls Geoapify's structured
  `/v1/geocode/search` with `filter=countrycode:us` and `limit=1`, under a
  2 s timeout, the same retry policy and its own breaker.
  - `429` is transient.
  - `401` and `403` are configuration errors: not retried, not counted by the
    breaker, logged at `error`.
  - Zero results → `UNKNOWN_ADDRESS`. Provider failure after retries →
    `PROVIDER_UNAVAILABLE`.
- **`GeocodingFailedError`** in a new, additive file,
  `src/domain/ports/geocoding-errors.ts`, so P4 can map it to `422` without
  importing infrastructure.
- **`CachingGeocodingProvider`**, a decorator around whichever driver is
  selected. An in-memory LRU of up to 10,000 entries with no TTL, keyed by
  `sha256` of the normalised address without the `recipient`. Failures are
  never cached.
- **Provider binding** in `SharedModule`. `PAYMENT_GATEWAY` →
  `HttpPaymentGateway` built from `PAYMENTS_URL`. `GEOCODING_PROVIDER` → a
  `useFactory` that reads `GEOCODING_DRIVER` once and constructs only the
  selected driver, wrapped in the cache.
- **Compose interpolation** for `api`: `GEOCODING_DRIVER: ${GEOCODING_DRIVER:-static}`
  and `GEOAPIFY_API_KEY: ${GEOAPIFY_API_KEY:-}`. Switching to Geoapify is two
  lines in a git-ignored `.env`.
- **Tests and tooling:**
  - Unit tests for the adapters, the retry policy and the breaker, run against
    a fake `node:http` server started inside each test, with no Docker and no
    database.
  - `payments-mock`'s own tests using `fastify.inject()`, added as a step to
    CI's `unit` job.
  - `scripts/payments-check.ts`, which runs the four card outcomes through
    `HttpPaymentGateway` against the compose `payments-mock`, wired into
    `npm run verify`.
- **README.** The "Powered by Geoapify" attribution. How to enable Geoapify.
  The static geocoder's limits and supported cities. The manual
  `docker stop payments-mock` demo, with a note that consecutive `0003`/`0004`
  orders can open the breaker for every card.

**Out of scope (for future specs):**

- Persisting `payments` rows, calling `charge()` from a use case, and building
  the charge idempotency key `order:<orderId>:attempt:<n>`. — P4 (recorded in
  `phases/04-order-creation-saga.md`, "Handoff from SPEC 03").
- The `502` problem body with the `orderId`, and any refinement that releases
  immediately on `CIRCUIT_OPEN` / `CONNECTION_REFUSED`. — P4.
- Card format and Luhn validation of the request. — P4's DTO.
- Payment reconciliation calling `getStatus()`. — P6.
- `correlationId`, OpenTelemetry, and applying `redact()` to span attributes.
  — P3.
- Applying `redact()` inside the RFC 9457 error filter. — P4.
- Breaker metrics and a Grafana panel. — Excluded, like P3's business metrics.
- A secrets manager (AWS Secrets Manager, Doppler, 1Password). — A deployment
  concern; locally it cannot hide a secret from the machine's operator.
- Persisting `payments-mock` state across restarts.
- A ZIP-code centroid table for the static geocoder.
- A second payment attempt (`attempt:2`) flow.
- Real Geoapify calls in CI, and an automated `docker stop` test.
- Geocoding warehouses. Their coordinates are seed data.

## Data model

**This spec introduces no new tables, columns, enum types, indexes or
environment variables.** The schema and `AppConfig` are frozen by SPEC 01, and
P2 compiles against both as-is. What follows is the shape of the code and wire
contracts P2 introduces.

### Named constants

Nobody tunes these per deployment, so they are constants in the module that
uses them, not env vars (`references/coding-conventions.md`).

| Constant | Value | Where |
|---|---|---|
| `ATTEMPT_TIMEOUT_MS` | `2000` | payments, geoapify |
| `MAX_ATTEMPTS` | `3` | `retry.ts` default |
| `BACKOFF_BASE_MS` | `200` | `retry.ts`, full jitter: the wait after failure *n* is `random(0, 200 · 2^(n-1))` |
| `BREAKER_FAILURE_THRESHOLD` | `5` | `circuit-breaker.ts` default |
| `BREAKER_OPEN_MS` | `30_000` | `circuit-breaker.ts` default |
| `GEOCODE_CACHE_MAX_ENTRIES` | `10_000` | `caching-geocoding.provider.ts` |
| `STATIC_JITTER_DEGREES` | `0.05` | `static-geocoding.provider.ts` |

Worst case for one `charge()`: 3 × 2 s plus at most 0.2 s + 0.4 s of backoff,
about 6.6 s.

### `payments-mock` wire contract

```
POST /charge
  Idempotency-Key: <string, required>
  { "cardNumber": "4000000000080004", "amountCents": 99900,
    "currency": "USD", "description": "Order 8f3c…" }

  200 { "id": "ch_<uuid>", "status": "approved", "amountCents": 99900,
        "currency": "USD", "cardLast4": "0004", "createdAt": "<iso>" }
  402 { "id": "ch_<uuid>", "status": "declined", "declineCode": "card_declined",
        "amountCents": 99900, "currency": "USD", "cardLast4": "0002", "createdAt": "<iso>" }
  500 { "error": "provider_error" }
  400 { "error": "invalid_request" }         — missing header or malformed body
  422 { "error": "idempotency_key_reused" }  — same key, different body

GET /charge/:idempotencyKey
  200 { "id", "idempotencyKey", "status": "approved" | "declined",
        "amountCents", "currency", "cardLast4", "createdAt" }
  404 { "error": "not_found" }

GET /health → 200 { "status": "ok" }
```

`requestHash`, the fingerprint behind `422`, is `sha256` of
`last4|amountCents|currency|description`. The full card number is never
stored, not even inside the mock.

### Payment outcome mapping

`ChargeResult.failureCode` stays `string | null` in the frozen port. Its values
are pinned by a new, additive file:

```ts
// src/domain/ports/payment-failure-codes.ts
export const PAYMENT_FAILURE_CODES = [
  'CARD_DECLINED',      // 402 — DECLINED
  'TIMEOUT',            // AbortSignal.timeout fired on the last attempt
  'PROVIDER_ERROR',     // 5xx on the last attempt
  'CONNECTION_REFUSED', // ECONNREFUSED — provably never reached the provider
  'NETWORK_ERROR',      // ECONNRESET, DNS failure… — may have reached it
  'CIRCUIT_OPEN',       // rejected by the breaker, never sent
  'INVALID_REQUEST',    // 400 / 422 from the provider — a bug on our side
  'NOT_FOUND',          // getStatus only: the provider never stored this key
] as const;
export type PaymentFailureCode = (typeof PAYMENT_FAILURE_CODES)[number];
```

| Provider answer (last attempt) | `status` | `failureCode` | Retried | Counted by breaker |
|---|---|---|---|---|
| `200 approved` | `CAPTURED` | `null` | — | success |
| `402` | `DECLINED` | `CARD_DECLINED` | no | success |
| `400` / `422` | `UNKNOWN` | `INVALID_REQUEST` | no | success |
| `5xx` | `UNKNOWN` | `PROVIDER_ERROR` | yes | failure |
| timeout | `UNKNOWN` | `TIMEOUT` | yes | failure |
| `ECONNREFUSED` | `UNKNOWN` | `CONNECTION_REFUSED` | yes | failure |
| other network error | `UNKNOWN` | `NETWORK_ERROR` | yes | failure |
| breaker open | `UNKNOWN` | `CIRCUIT_OPEN` | stops the loop | — |
| `getStatus`: `404` | `FAILED` | `NOT_FOUND` | no | success |

`providerPaymentId` is the mock's `id`, or `null` when no response arrived.
`rawResponse` is the response body passed through `redact()`, or `null`.

### Card description

```ts
// src/infrastructure/payments/card.ts
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';
export interface CardDescription { last4: string; brand: CardBrand; }
// describeCard(pan): Visa 4 · Mastercard 51–55, 2221–2720 · Amex 34, 37 ·
// Discover 6011, 644–649, 65 · anything else 'unknown'
```

Luhn-valid test card numbers, used by `scripts/payments-check.ts` and the README:

| Card | Outcome |
|---|---|
| `4242424242424242` | approved |
| `4000000000000002` | declined (`402`) |
| `4000000000090003` | provider error (`500`) |
| `4000000000080004` | timeout (`UNKNOWN`), recorded as approved |

### Resilience primitives

```ts
// src/infrastructure/http/retry.ts
export interface RetryPolicy {
  maxAttempts: number;                          // default MAX_ATTEMPTS
  baseDelayMs: number;                          // default BACKOFF_BASE_MS
  isTransient: (outcome: unknown) => boolean;
}

// src/infrastructure/http/circuit-breaker.ts
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface CircuitBreakerOptions {
  name: 'payments' | 'geoapify';                // appears in the log line
  failureThreshold: number;                     // default BREAKER_FAILURE_THRESHOLD
  openMs: number;                               // default BREAKER_OPEN_MS
  now: () => number;                            // injectable clock; Date.now in production
}
export class CircuitOpenError extends Error {}  // infrastructure-internal, never crosses a port
```

Log line on every transition:
`{ level: 'warn', breaker: 'payments', from: 'CLOSED', to: 'OPEN', consecutiveFailures: 5 }`.

### Redaction rules

- **By key**, case-insensitive, at any depth: `cardNumber`, `card_number`, `pan` →
  masked; `apiKey`, `api_key` → `[REDACTED]`.
- **By value**, in any string: a run of 13–19 digits, optionally separated by
  spaces or dashes, that passes Luhn → `************0004`, keeping the last
  four digits.
- **In URLs:** an `apiKey=` query parameter's value → `[REDACTED]`.
- `redact()` is pure. It returns a redacted deep copy, never mutates its input,
  and survives circular references.

### Geocoding

```ts
// src/domain/ports/geocoding-errors.ts (new, additive)
export type GeocodingFailureReason = 'UNKNOWN_ADDRESS' | 'PROVIDER_UNAVAILABLE';
export class GeocodingFailedError extends Error {
  constructor(readonly reason: GeocodingFailureReason, message: string) { … }
}

// src/infrastructure/geocoding/us-cities.ts
export interface CityCentre { latitude: number; longitude: number; }
export const US_CITIES: Readonly<Record<string, CityCentre>>;  // key: 'new york|NY'
```

**Normalisation**, shared by the static lookup, the jitter and the cache key:
Unicode NFD with diacritics stripped, trimmed, internal whitespace collapsed,
lower-cased. `state` is upper-cased to its two-letter USPS code; a full state
name ("New York") is mapped through a 51-entry table covering the 50 states
plus DC.

**Normalised address string**, used for the jitter and the cache key; the
`recipient` is excluded:
`line1|line2|city|state|postalCode|country`, empty string for an absent field.

**Jitter:**
`h = sha256(normalisedAddress)`;
`latitude = centre.latitude + ((h.readUInt32BE(0) / 0xffffffff) * 2 - 1) * 0.05`;
`longitude = centre.longitude + ((h.readUInt32BE(4) / 0xffffffff) * 2 - 1) * 0.05`.
Example: `350 5th Ave, Apt 4, New York, NY 10118, US` → `40.675139, -74.013737`,
on every run.

**Cache:** a `Map`-based LRU, hand-written with no dependency, keyed by
`sha256(normalisedAddress)`. Only successes are stored.

**City table:** ~30 entries, including the five warehouse cities (Newark,
Los Angeles, Dallas, Chicago, Miami). Includes New York, Philadelphia,
San Diego, Houston, Milwaukee, Orlando, Seattle and Denver, plus `portland|OR`
and `portland|ME`, deliberately, to exercise the ambiguity rule.

## Implementation plan

Every step ends with `npm run lint`, `npm run build` and `npm run test:unit`
green. Steps from 4 onward also leave `docker compose up` working. Each step
states how it is verified before the next one starts.

1. **`redact()`.** Write `src/infrastructure/http/redaction.ts` with the key
   rules, the Luhn-checked value rule, the URL `apiKey=` rule and circular-reference
   safety.
   *Verify:* unit tests show that a nested `{ card: { cardNumber } }`, a
   free-text string `"card 4242 4242 4242 4242 failed"` and a URL carrying
   `apiKey=` come out masked. A 16-digit number that fails Luhn and a UUID come
   out untouched. The input object is not mutated.

2. **Structured logger and `no-console`.** Install `nestjs-pino`, bind it as the
   logger in `main.ts` and `main.worker.ts`, and run every log object through
   `redact()` before serialisation. Add the ESLint rule `no-console: error`
   for `src/**`, excluding `*.spec.ts` and the two CLI scripts `seed.ts` and
   `verify-schema.ts`, which never handle card data. The bootstrap `catch` in
   `main.ts` and `main.worker.ts` keeps its `console.error` — the logger may
   not exist when boot fails — but prints `redact(error)`, behind a single
   justified `eslint-disable-next-line`.
   *Verify:* a unit test builds the logger over an in-memory stream, logs
   `{ cardNumber: '4242424242424242', note: 'pan 4242424242424242' }`, and
   asserts that the captured output contains `************4242` and not
   `4242424242424242`. A scratch file under `src/infrastructure/` calling
   `console.log` fails `npm run lint`; delete it afterwards. `npm start`
   prints JSON log lines, and `/health` still answers 200.

3. **`payments-mock` service.** Create `payments-mock/` with its own
   `package.json`, `tsconfig.json`, `src/server.ts` (an app builder) and
   `src/main.ts` (listen on 4000). It covers the four card outcomes, the
   idempotent replay, `0004` delayed before the lookup, the unstored `500`,
   `422 idempotency_key_reused`, the shared in-flight promise, `GET /charge/:key`
   and `GET /health`.
   *Verify:* `npm test` inside `payments-mock/` passes `fastify.inject()` tests
   for every row of the wire contract. The `0004` delay is injectable in tests,
   so the suite does not wait 30 s.

4. **Container, compose and CI.** Write the multi-stage
   `docker/payments-mock.Dockerfile`. Replace the placeholder in
   `docker-compose.yml` with the `payments-mock` service and its healthcheck,
   and make `api` wait on `condition: service_healthy`. Add
   `npm ci && npm test` for `payments-mock/` to CI's `unit` job.
   *Verify:* `docker compose up` brings `payments-mock` up healthy before
   `api`. `curl` against `localhost:4000` reproduces `200`, `402` and `500`, and
   the `0004` request hangs. Repeating a request with the same key returns a
   byte-identical body.

5. **Retry primitive.** Write `src/infrastructure/http/retry.ts`: up to
   `maxAttempts`, full-jitter backoff, the `isTransient` predicate, and an early
   exit on `CircuitOpenError`.
   *Verify:* unit tests using `baseDelayMs: 0`. A transient failure followed by
   success resolves on attempt 2. A non-transient failure is not retried.
   Three transient failures surface the last outcome.

6. **Circuit breaker.** Write `src/infrastructure/http/circuit-breaker.ts` with
   the three states, per-attempt counting, a single half-open probe, the
   injectable clock and the `warn` log on each transition.
   *Verify:* unit tests with a fake clock. Five failures open it. A call inside
   the 30 s window throws `CircuitOpenError` without invoking the operation.
   At 30 s one probe is let through while a concurrent second call is
   rejected. A successful probe closes it, a failed probe reopens it, and one
   success in `CLOSED` resets the counter.

7. **Payment contracts.** Add `src/domain/ports/payment-failure-codes.ts` and
   `src/infrastructure/payments/card.ts` with `describeCard()`.
   *Verify:* unit tests show `describeCard()` returning the right brand for one
   number per prefix range, `'unknown'` otherwise, and the correct `last4`.

8. **`HttpPaymentGateway.charge()`.** Takes
   `{ baseUrl, timeoutMs?, retryPolicy?, breaker? }`, defaulting to the named
   constants. Maps `amountMinor` → `amountCents`, sends `Idempotency-Key`
   unchanged on every attempt, classifies each attempt into the outcome table,
   and fills `cardLast4` / `cardBrand` from `describeCard()` and `rawResponse`
   from `redact()`.
   *Verify:* unit tests against a fake `node:http` server started in the test,
   with a 50 ms timeout. `200` gives `CAPTURED`. `402` gives `DECLINED` after
   exactly one request. Three `500`s give `UNKNOWN`/`PROVIDER_ERROR` after three
   requests, all with the same key. A hanging handler gives `UNKNOWN`/`TIMEOUT`.
   A closed port gives `UNKNOWN`/`CONNECTION_REFUSED`. `400` gives
   `UNKNOWN`/`INVALID_REQUEST` after one request. None of these throws.

9. **`getStatus()` and the shared breaker.** Implement `getStatus()` over the
   same breaker and retry policy.
   *Verify:* unit tests. `approved` gives `CAPTURED`, `declined` gives
   `DECLINED`, and `404` gives `FAILED`/`NOT_FOUND`. Against a closed port, the
   second `charge()` opens the breaker after its second attempt, and the third
   call returns `UNKNOWN`/`CIRCUIT_OPEN` with the fake server receiving no
   request.

10. **Bind the gateway and the driver script.** Bind `PAYMENT_GATEWAY` to
    `HttpPaymentGateway` in `SharedModule`, built from `PAYMENTS_URL`, replacing
    the throwing stub. Write `scripts/payments-check.ts`, which runs the four
    test cards through the adapter against `PAYMENTS_URL` and prints one line
    per card: status, failureCode, last4, brand and elapsed time. Wire it into
    `npm run verify`.
    *Verify:* with the stack up, `npm run payments-check` prints `CAPTURED`,
    `DECLINED`, `UNKNOWN/PROVIDER_ERROR` and `UNKNOWN/TIMEOUT` in about 7 s, and
    exits non-zero if any line differs.

11. **Static geocoder.** Add `src/domain/ports/geocoding-errors.ts`, then under
    `src/infrastructure/geocoding/` the normalisation helpers, the state-name
    table, `us-cities.ts` and `StaticGeocodingProvider`.
    *Verify:* unit tests.
    - The example address returns `40.675139, -74.013737`.
    - The same address with a different `recipient` returns the same point.
    - `NY` and `New York` return the same point.
    - `New York` with no state resolves.
    - `Portland` with no state, `Boise, ID` and `Toronto, ON, CA` each throw
      `GeocodingFailedError('UNKNOWN_ADDRESS')`.
    - Every returned point lies within 0.05° of its city centre.

12. **Cache decorator.** Write `CachingGeocodingProvider` with the `Map`-based
    LRU.
    *Verify:* unit tests with a counting fake provider. A second identical call
    does not reach the provider. An address differing only by `recipient` is a
    cache hit. A failure is not cached, so the next call reaches the provider
    again. Entry 10,001 evicts the least recently used entry.

13. **Geoapify adapter.** Write `GeoapifyGeocodingProvider` over the structured
    search endpoint, with its own `'geoapify'` breaker, the shared retry
    policy, `429` treated as transient and `401`/`403` as configuration errors.
    *Verify:* unit tests against a fake server. A `features[0]` response maps to
    `Coordinates`. An empty `features` throws `UNKNOWN_ADDRESS`. Three `503`s
    throw `PROVIDER_UNAVAILABLE`. A `401` throws after exactly one request and
    leaves the breaker `CLOSED`. No log line or error message contains the API
    key.

14. **Bind the geocoder and compose interpolation.** A `useFactory` for
    `GEOCODING_PROVIDER` in `SharedModule`, reading `GEOCODING_DRIVER` once,
    constructing only the selected driver and wrapping it in the cache. The
    static driver logs its boot `warn`. Switch `api`'s environment in
    `docker-compose.yml` to `${GEOCODING_DRIVER:-static}` and
    `${GEOAPIFY_API_KEY:-}`.
    *Verify:* with no `.env`, `docker compose up` starts `api` using the static
    driver and prints the `warn`. With
    `GEOCODING_DRIVER=geoapify` and no key, the app refuses to boot through the
    existing Zod refinement. `grep` finds no `GEOCODING_DRIVER` comparison
    outside `shared.module.ts` and `env.schema.ts`.

15. **README.** A P2 section covering the Geoapify attribution and how to enable
    it with `.env`, the static geocoder's supported cities and its limits, the
    test card table, the `docker stop payments-mock` walkthrough, and the note
    that consecutive `0003`/`0004` orders can open the breaker for every card.
    *Verify:* following the walkthrough from a clean `docker compose up`
    reproduces each step as written.

## Acceptance criteria

**`payments-mock`**

- [x] `docker compose up` from a clean clone brings `payments-mock` up healthy,
      and `api` starts only after it.
- [x] `curl` against `localhost:4000/charge` reproduces each card outcome:
      `4242424242424242` → `200`, `4000000000000002` → `402`,
      `4000000000090003` → `500`, `4000000000080004` → no answer within 25 s.
- [x] Repeating a `POST /charge` with the same `Idempotency-Key` and body returns
      a byte-identical response, and `GET /charge/:key` shows a single charge.
- [x] Repeating a `4000000000080004` request with the same key is delayed again.
      It is not answered from the stored record.
- [x] After a `4000000000080004` request, `GET /charge/:key` returns `200` with
      `status: "approved"` while the `POST` is still pending.
- [x] After a `4000000000090003` request, `GET /charge/:key` returns `404`.
- [x] The same key with a different `amountCents` returns
      `422 idempotency_key_reused`.
- [x] No `payments-mock` response body contains a full card number.

**`HttpPaymentGateway`**

- [x] `npm run payments-check` against the running stack prints `CAPTURED`,
      `DECLINED`, `UNKNOWN/PROVIDER_ERROR` and `UNKNOWN/TIMEOUT` for the four
      test cards, each with `cardLast4` and `cardBrand: visa`, and exits zero.
- [x] A `402` produces exactly one HTTP request. A `500` produces exactly three,
      all carrying the same `Idempotency-Key`.
- [x] A timeout ends in `UNKNOWN`, never `FAILED` or `DECLINED`.
- [x] `charge()` and `getStatus()` resolve — never reject — for every row of the
      outcome table, including a closed port and an open breaker.
- [x] No single `charge()` takes longer than 7 s.
- [x] `getStatus()` maps `approved` → `CAPTURED`, `declined` → `DECLINED` and
      `404` → `FAILED`/`NOT_FOUND`.
- [x] With `payments-mock` stopped (`docker stop payments-mock`), the breaker
      opens during the second `charge()`: a `warn` log line
      `breaker: payments, to: OPEN` appears. The next call returns
      `UNKNOWN`/`CIRCUIT_OPEN` in under 50 ms. No unhandled rejection is logged
      and the process does not hang.
- [x] Thirty seconds later, one probe is sent. After `docker start
      payments-mock`, the next successful probe logs `to: CLOSED` and charges
      succeed again with no restart of `api`.
- [x] A `402` never counts toward opening the breaker: ten consecutive declined
      charges leave it `CLOSED`.

**Card data and redaction**

- [x] The logger unit test logs an object and a string, each containing
      `4242424242424242`. The captured output contains `************4242` and
      never the full number.
- [x] `grep 4242424242424242` over the api's stdout after `npm run
      payments-check` finds nothing.
- [x] `ChargeResult.rawResponse` never contains a full card number, for any of
      the four test cards.
- [x] No log line or error message produced by `GeoapifyGeocodingProvider`
      contains the API key.
- [x] `redact()` leaves a 16-digit number that fails Luhn, and a UUID, unchanged,
      and does not mutate its input.
- [x] A file under `src/` (outside the excluded CLI scripts and specs) calling
      `console.log` fails `npm run lint`.

**Geocoding**

- [x] `StaticGeocodingProvider` returns `40.675139, -74.013737` for
      `350 5th Ave, Apt 4, New York, NY 10118, US`, in two separate processes.
- [x] Two addresses that differ only in `recipient` return the same coordinates.
- [x] Every point the static provider returns lies within 0.05° of its city
      centre in both latitude and longitude.
- [x] `Portland` without a state, `Boise, ID` and `Toronto, ON, CA` each throw
      `GeocodingFailedError` with `reason: 'UNKNOWN_ADDRESS'`.
- [x] A static result for a New York address, passed to SPEC 02's selection
      query with the seeded data, returns Newark first.
- [x] A repeated geocode for the same normalised address reaches the underlying
      provider once. A failed geocode reaches it again on the next call.
- [x] `GeoapifyGeocodingProvider` throws `PROVIDER_UNAVAILABLE` after three
      `503`s. It throws after a single request on `401`, with its breaker still
      `CLOSED`.

**Configuration and wiring**

- [x] With `GEOCODING_DRIVER` unset and no `GEOAPIFY_API_KEY`, `api` starts,
      logs the static-driver `warn`, and answers `/health` with `200`.
- [x] With `GEOCODING_DRIVER=geoapify` and a key in a git-ignored `.env`,
      `docker compose up` constructs `GeoapifyGeocodingProvider` and never
      constructs the static one.
- [x] `GeoapifyGeocodingProvider` is never constructed when the static driver is
      selected.
- [x] No `GEOCODING_DRIVER` comparison exists outside
      `src/modules/shared.module.ts` and `src/infrastructure/config/env.schema.ts`.
- [x] `src/domain/**` still passes the `no-restricted-imports` rule with the two
      new files added.
- [x] `npm run lint`, `npm run build`, `npm run test:unit`, `npm test` in
      `payments-mock/`, and `npm run verify` all pass.

## Decisions

**Payment outcome classification**

- **Yes:** only two outcomes are definitive — `2xx` → `CAPTURED`, `402` →
  `DECLINED`. Everything else ends in `UNKNOWN`, and reconciliation (P6)
  decides. A timeout, a reset connection or even a `5xx` can hide a charge
  that went through; assuming "failed" would release the stock of a customer
  who was charged.
- **No:** mapping an exhausted `5xx` or a refused connection to `FAILED`. It
  would release the reservation on `docker stop payments-mock`, contradicting
  P4's AC 5 ("reservation intact").
- **Yes:** `charge()` and `getStatus()` never throw on a provider failure. The
  port returns a `ChargeResult`, and the classification is total, so P4 can
  switch on `status` without a `try/catch` that might swallow a programming
  error.
- **Yes:** `failureCode` carries the exact cause (`TIMEOUT`, `PROVIDER_ERROR`,
  `CONNECTION_REFUSED`, `NETWORK_ERROR`, `CIRCUIT_OPEN`, `INVALID_REQUEST`).
  P2 does not decide policy. `CIRCUIT_OPEN` and `CONNECTION_REFUSED` provably
  never reached the provider, so a future P4 refinement (release immediately,
  `503` + `Retry-After`) needs no adapter change.
- **Yes:** `NETWORK_ERROR` is separate from `CONNECTION_REFUSED`. Only
  `ECONNREFUSED` proves the request never left. An `ECONNRESET` may cut the
  connection after the provider charged.
- **Yes:** a `400`/`422` from the provider → `UNKNOWN`/`INVALID_REQUEST`, not
  retried, not counted by the breaker. Not `FAILED`: `422
  idempotency_key_reused` means a charge with that key already exists and may
  be captured.
- **Yes:** `payment-failure-codes.ts` lives in `src/domain/ports/`, an additive
  file beside the frozen port. P4 must be able to import it, and the
  application layer cannot import infrastructure (`references/layering.md`).

**Retries and timeouts**

- **Yes:** a timeout is retried like a `5xx`. The stable idempotency key makes
  the retry safe, so it is not the "blind" retry FR-4 warns against. Without
  it, card `0004` would never exercise the backoff.
- **No:** returning `UNKNOWN` on the first timeout. It is faster (~2 s), but
  leaves the retry path untested against the one failure it exists for.
- **Yes:** full-jitter exponential backoff, base 200 ms, 3 attempts. The worst
  case is about 6.6 s. Full jitter spreads simultaneous retries better than
  "equal jitter", at no cost in code.
- **Yes:** `AbortSignal.timeout` and native `fetch`, with no HTTP client
  dependency. Node 22 ships both.
- **Yes:** timeouts and retry policy are injectable through the constructor,
  defaulting to the named constants. Tests run with 50 ms and 0 ms instead of
  waiting seconds per case.

**`payments-mock` semantics**

- **Yes:** a separate container, not an in-process fake
  (`infrastructure.md` §4). Timeouts, refused connections and an opening
  breaker only mean something against a real socket.
- **Yes:** card `0004` is recorded as approved when it arrives, and every
  request with it is delayed, replays included. The delay is checked before
  the idempotency lookup. Otherwise the second attempt would receive the
  stored `200` and `0004` could never produce `UNKNOWN`.
- **Yes:** recording `0004` as approved, so `GET` returns `approved` and P6
  demonstrates "a timeout can hide a successful charge".
- **Yes:** a `500` is never stored, so `GET` returns `404` and P6 demonstrates
  the release branch.
- **No:** storing it as `failed`. Same outcome, one more state in the mock.
- **Yes:** same key with a different body → `422 idempotency_key_reused`, as
  real providers do. It catches a P4 bug that reuses a key.
- **Yes:** a second request with the same key awaits the first one's promise,
  so no key can ever produce two charges.
- **Yes:** in-memory state, lost on restart. Accepted as a mock limitation and
  recorded in Risks. The `docker stop` demo is unaffected: its order never
  reached the mock.
- **No:** persisting the mock's state to a JSON file on a volume. More faithful,
  but file I/O in a mock nobody deploys.
- **Yes:** the wire field is `amountCents` (the phase's contract) while the port
  says `amountMinor` (SPEC 01). The adapter translates, and the frozen port is
  untouched.

**Circuit breaker**

- **Yes:** it counts each failed **attempt**, not each exhausted call. With
  `payments-mock` down, it opens during the second order instead of the fifth,
  sparing three customers about 7 s each.
- **No:** counting per call. Five slow orders before any protection.
- **Yes:** only `5xx`, network errors and timeouts count as failures. A `402`,
  a `404` from `getStatus` or a `4xx` means the provider answered and is
  healthy. Counting declines would let five rejected cards cut off every
  customer.
- **Yes:** an open breaker stops the retry loop at once. Retrying against a
  breaker that will reject is pointless.
- **Yes:** half-open lets exactly one probe through, and concurrent calls are
  rejected meanwhile. N probes add nothing on a single instance.
- **Yes:** one breaker per provider. `charge()` and `getStatus()` share the
  payments breaker, since they hit the same host. Geoapify has its own.
- **Yes:** in-memory, per process. The api and the worker each hold their own.
  Breaker state is ephemeral by design, so losing it on restart is harmless
  and does not conflict with NFR-3.
- **Yes:** hand-written with an injectable clock (~60 lines), as the phase's
  file list anticipates.
- **No:** `opossum` or `cockatiel`. Their counting semantics do not match
  "per attempt, stop the loop when open" without configuration that is harder
  to review than the code itself.
- **Accepted:** the deterministic cards trip the breaker too. Two consecutive
  `0003` orders open it for every card for 30 s. That is correct behaviour,
  since a provider returning `500` is unhealthy, and the README warns about
  it for demos.

**Card data and the idempotency key**

- **Yes:** `cardLast4` and `cardBrand` are derived locally from the PAN by
  `describeCard()`. The alternative, reading them from the provider's response,
  leaves them `null` on exactly the rows reconciliation needs: timeouts,
  `500`s and an open breaker.
- **Yes:** the adapter forwards `ChargeCommand.idempotencyKey` unchanged on
  every attempt. That, not the retry count, is what prevents a double charge.
- **Yes:** the key format is `order:<orderId>:attempt:<n>`, where `<n>` is
  `payments.attempt` — a business-level payment attempt (one `payments` row),
  not an HTTP retry. P4 builds it in `src/application/orders/`. Recorded in
  `phases/04-order-creation-saga.md`.
- **No:** P2 shipping the key helper. In `src/infrastructure/payments/` it
  would force the application layer to import infrastructure. In
  `src/domain/` it would add a file to the frozen layer for P4's sole use.
- **Yes:** the test cards are Luhn-valid (`4000000000090003`,
  `4000000000080004`), so P4 can add Luhn validation to its DTO without
  breaking the demo.

**Redaction and logging**

- **Yes:** P2 installs `nestjs-pino` in both entrypoints, with `redact()`
  applied to every log object. The phase's AC 5 asserts on stdout, and that
  requires a real logger. P3 extends it with `correlationId` and
  OpenTelemetry instead of replacing it.
- **No:** shipping only `redact()` and leaving the logger to P3. Cleaner file
  ownership, but AC 5 could then only be proven against the function, not the
  output.
- **Yes:** ESLint `no-console: error` under `src/**`. A redacting logger is
  only a guarantee if nothing can write around it. Excluded: `*.spec.ts`, and
  the CLI scripts `seed.ts` and `verify-schema.ts`, which print progress and
  never touch card data. The two bootstrap `catch` handlers keep
  `console.error` behind an inline disable, because the logger may not exist
  when boot fails — and they print `redact(error)`.
- **Yes:** redaction by key *and* by value. Keys catch structured fields.
  The Luhn-checked value rule catches a PAN pasted into free text, an error
  message or a URL. Luhn keeps order numbers and timestamps from being masked.
- **Yes:** a PAN is masked as `************0004`, keeping the last four digits.
  They are already persisted, and they make logs debuggable.
- **No:** a flat `[REDACTED]` for PANs. It gains no security over keeping the
  last four digits and loses the debugging value.
- **Yes:** `apiKey` is redacted by key and inside URLs, since Geoapify takes it
  as a query parameter.

**Geocoding**

- **Yes:** the static provider stays the default, and Geoapify is opt-in. C-11
  requires `docker compose up` with no account and no key, the phase's AC 7
  requires the app to work with `GEOCODING_DRIVER` unset, and CI must not
  depend on the internet or a quota.
- **Yes:** the static provider's danger is made explicit rather than hidden:
  a boot `warn`, the README naming Geoapify as the production configuration,
  and a `422` for any address it cannot resolve.
- **No:** Geoapify as the default. It breaks C-11 and AC 7, and would reopen
  FR-3.
- **No:** automatic selection by the presence of `GEOAPIFY_API_KEY`. A lost key
  in production would silently switch to the mock and route orders from the
  wrong warehouses.
- **No:** falling back to a default point for an unknown city. It would pick an
  arbitrary warehouse and persist a fake location in `orders.shipping_location`
  as if it were real.
- **Yes:** a city table (~30 entries) plus `sha256` jitter of up to ±0.05°,
  as R2.4 describes. About 5 km of error is irrelevant when warehouses are
  hundreds of kilometres apart: the warehouse choice stays verifiable by hand.
- **No:** a ZIP-code centroid table (US Census, ~33k rows). More precise, but a
  1 MB data file, and `postalCode` is optional in `ShippingAddress`.
- **Yes:** a missing `state` matches on city alone only when the name is unique
  in the table. Tolerant, but it never guesses on ambiguity (`Portland`).
- **No:** requiring `state` in the static driver. `ShippingAddress.state` is
  optional, and the mock should not be stricter than the contract.
- **Yes:** the `recipient` is excluded from the jitter input and the cache key.
  Two people at one address are at one point.
- **Yes:** `GeocodingFailedError` lives in `src/domain/ports/geocoding-errors.ts`,
  an additive file beside the frozen port, so P4 maps it to `422` without
  importing infrastructure.
- **Yes:** Geoapify's structured search endpoint. The address already arrives
  as separate fields, so free-text parsing would only add ambiguity.
- **Yes:** `429` is transient. `401` and `403` are configuration errors: not
  retried, not counted by the breaker, logged at `error`. A bad key is not an
  outage, and must not open the breaker for 30 s at a time.

**Caching**

- **Yes:** an in-memory LRU decorator around the selected driver, 10,000
  entries, no TTL. Geoapify's terms permit storing results, and static results
  never change.
- **Yes:** the cache wraps both drivers. It caches address → coordinates only;
  warehouse selection and distance are recomputed on every order, since they
  depend on stock. Wrapping the static driver gains nothing in latency — it is
  deterministic and computes in microseconds. It is kept for FR-3's "both
  adapters" rule, and so the cache path runs in the default demo without a
  Geoapify key.
- **Yes:** failures are never cached. A Geoapify outage must not mark an
  address as bad after the provider recovers.
- **No:** a PostgreSQL cache table. It would survive restarts, but needs a
  migration on a frozen schema for a cost saving the free tier does not need.

**Packaging, tests and CI**

- **Yes:** `payments-mock/` is its own package, with its own `package.json`
  and TypeScript build. Its Fastify dependency stays out of the app's
  dependency tree, and the root lint glob already excludes it.
- **Yes:** adapter tests run against a fake `node:http` server started inside
  each test, in `test:unit`. No Docker, no database, and every failure mode
  (hang, closed port, `500`) is reproducible on demand.
- **Yes:** `scripts/payments-check.ts` runs in `npm run verify` against the
  compose `payments-mock`. It is the phase's "small driver script" until P4
  exposes `curl`.
- **No:** automating the `docker stop` scenario. It needs a test driving
  Docker; it stays a documented manual walkthrough.
- **No:** real Geoapify calls in CI. A quota and a network dependency in the
  pipeline, for a path the fake server already covers.

**Secrets**

- **Yes:** the Geoapify key goes in a git-ignored `.env` that Compose
  interpolates. It satisfies NFR-6 ("no secrets in the repository").
- **No:** a secrets manager (AWS Secrets Manager, Doppler, 1Password) in this
  spec. Locally, it cannot hide a secret from the machine's operator, who can
  read it with `docker inspect`. It belongs to a deployment spec.

**Deviations from the phase's file ownership**

`phases/02-external-adapters.md` lists the files P2 owns. This spec also
touches, deliberately:

- `src/main.ts` and `src/main.worker.ts` — to install the redacting logger
  (AC 5 needs it before P3 exists).
- `src/modules/shared.module.ts` — to replace the two throwing stubs with the
  real bindings. SPEC 01 anticipated this: "P2/P3 swap a `useValue` stub for a
  real `useClass` adapter".
- `src/domain/ports/geocoding-errors.ts` and `payment-failure-codes.ts` — new
  files. The existing ports are not modified.
- `docker-compose.yml` — beyond adding `payments-mock`, `api` now waits for it
  and interpolates `GEOCODING_DRIVER` / `GEOAPIFY_API_KEY`, so enabling
  Geoapify never means editing a tracked file.
- `eslint.config.mjs` — the `no-console` rule.
- `.github/workflows/tests.yml`, `package.json` and `README.md` — CI step,
  `payments-check` script and documentation.

**Noted for P4** (recorded in `phases/04-order-creation-saga.md`, "Handoff from
SPEC 03")

- A `502` means "payment outcome unknown", not "order failed". Its body must
  carry the `orderId`, so the client polls `GET /orders/:id` instead of
  re-posting with a new `Idempotency-Key` — which could charge twice.
- The charge key is persisted in `payments.idempotency_key` before `charge()`
  is called, so P6 reads it back and never rebuilds it.

## Risks

| Risk | Mitigation |
|---|---|
| `payments-mock` loses its state on restart. An `UNKNOWN` charge that was really approved (`0004`) then reads `404` at reconciliation, and P6 releases an order whose customer was charged. | Accepted as a mock limitation and documented in the README. The `docker stop` demo is unaffected, because its orders never reached the mock. A real provider persists its charges. |
| The deterministic cards trip the breaker. Two consecutive `0003` orders make every card return `UNKNOWN`/`CIRCUIT_OPEN` for 30 s, which looks like a bug during a demo. | Correct behaviour, documented in the README's walkthrough with the recommended order: happy path first, `0003`/`0004` last, or wait 30 s. |
| Code that logs through `console.log` bypasses `nestjs-pino` and `redact()`, so a future phase could print a PAN. | ESLint `no-console: error` under `src/**` (step 2). The logger is the only way to write output from the app; the two bootstrap handlers that must use `console.error` print `redact(error)`. |
| The value rule only catches Luhn-valid numbers. A mistyped card number (Luhn-invalid) pasted into free text is not masked. | The key rule still masks it in any `cardNumber`/`pan` field, whatever its value. P4's DTO rejects a Luhn-invalid card before any use case runs. Free-text logging of request bodies stays forbidden. |
| `fetch` wraps socket errors (`TypeError: fetch failed`, with the code in `error.cause.code`), and the shape could change between Node versions, misclassifying `ECONNREFUSED`. | Classification reads `cause.code`, and unknown shapes fall back to `NETWORK_ERROR` — still `UNKNOWN`, so the fallback is safe. The closed-port unit test runs against a real socket on Node 22. |
| Worst-case latency adds up. Geocoding (Geoapify, ~6.6 s) plus payment (~6.6 s) can bring `POST /orders` to about 13 s. A client with a 10 s timeout gives up, then re-posts with a new `Idempotency-Key`. | The breaker bounds this to the first two orders of an outage. The static driver never waits. P4's handoff note says a `502` carries the `orderId` and must not be retried with a new key; P4 decides whether to document a client timeout. |
| Geoapify's free tier (3,000 credits/day) runs out. `429`s are retried, open the breaker, and every order returns `422` until the next day. | The cache avoids repeat lookups. Opt-in only: the default path never calls Geoapify. The README states the quota. |
| Geoapify changes its response shape. The fake-server tests keep passing while the real adapter breaks. | The mapping reads only `features[0].properties.lat` / `lon`. The README includes a manual one-`curl` check to run when enabling it. |
| `nestjs-pino` clashes with P3's OpenTelemetry setup. | P3 extends the logger P2 installs, and pino has first-party OTel instrumentation. If P3 needs another transport, `redact()` is a pure function and moves with it. |

## What is **not** in this spec

- Persisting `payments` rows, calling the gateway from a use case, and building
  the charge idempotency key. — P4.
- The `502` response body and any release-early refinement for
  `CIRCUIT_OPEN` / `CONNECTION_REFUSED`. — P4.
- Payment reconciliation. — P6.
- `correlationId`, OpenTelemetry spans, and redaction of span attributes. — P3.
- Redaction inside the RFC 9457 error filter. — P4.
- Breaker metrics and dashboards.
- A secrets manager.
- Persistent `payments-mock` state.
- ZIP-code geocoding.
- Geocoding warehouses.

Each one of those, if it lands, goes in its own spec.
