# P2 — External Adapters

| | |
|---|---|
| **Wave** | 1 |
| **Depends on** | P0 (ports) |
| **Parallel with** | P1, P5 |
| **Risk** | low |
| **Target** | Wednesday PM |

## Objective

Implement everything that talks to the outside world, behind the ports P0 froze:
the payment gateway (plus its mock service) and geocoding (mock + real provider).

The value of this phase is not the mocks. It is the **client-side resilience**:
timeouts, retries, backoff, circuit breaker, and never leaking a card number.

---

## Requirements

### R2.1 — `payments-mock` service (infrastructure.md §4)

A standalone Fastify service, its own container, its own Dockerfile.

- `POST /charge` taking `{ cardNumber, amountCents, currency, description }` plus an `Idempotency-Key` header.
- Deterministic outcomes keyed on the card's last four digits, so every branch is reproducible on demand:

  | last4 | Behaviour |
  |---|---|
  | `0002` | `402` declined |
  | `0003` | `500` provider error |
  | `0004` | hangs ~30 s → forces a client timeout |
  | anything else | approved after 200–600 ms of simulated latency |

- Replays the stored response for a repeated `Idempotency-Key`.
- `GET /charge/:idempotencyKey` returning the authoritative status — this is what
  reconciliation calls in P6.
- `GET /health`.
- In-memory state is fine. It is a mock.

### R2.2 — `HttpPaymentGateway` adapter (FR-4, NFR-3)

Implements P0's `PaymentGateway`. This is where the engineering is:

- **Timeout** of 2 s per attempt, via `AbortSignal.timeout`.
- **Retries**: max 3 attempts, exponential backoff **with jitter**, and only on
  transient failures (5xx, network errors). Never on `402`.
- **Circuit breaker**: opens after 5 consecutive failures, half-opens after 30 s.
- Outcome classification is explicit and total:
  - `402` → **declined**, terminal, do not retry
  - `5xx` / network → **transient**, retry
  - timeout after retries → **`UNKNOWN`**, never assumed failed — a charge may have succeeded
- Sends a **stable idempotency key** derived from the order, so a retry can never double-charge.

### R2.3 — Card data handling (NFR-6)

- The full PAN exists only in memory, for the life of the request.
- Persist `card_last4` and `card_brand` only.
- A logger redaction rule that strips card numbers from **every** log, trace
  attribute and error message — including ones added by future phases.
- Write a check that proves it: log an object containing a card number and assert the output is redacted.

### R2.4 — `StaticGeocodingProvider` (FR-3, default)

- Lookup table of US cities plus deterministic per-address jitter hashed from the full address string.
- Same input always yields the same coordinates. No randomness — demos must be reproducible.
- Coordinates must be plausible for the city, so P1's nearest-warehouse results are verifiable by hand.
- Unknown city → a clear, typed failure that P4 will map to `422`.

### R2.5 — `GeoapifyGeocodingProvider` (FR-3, opt-in)

- Selected by `GEOCODING_DRIVER=geoapify` + `GEOAPIFY_API_KEY`.
- Same timeout / retry / breaker treatment as payments.
- Attribution line ("Powered by Geoapify") noted for the README.
- **Absence of the API key must not break the default path.** The adapter is only constructed when selected.

### R2.6 — Result caching

Cache geocoding results by normalised address hash. Cuts provider cost and keeps
repeated requests consistent.

### R2.7 — Provider selection

The active adapter is chosen once, in the module provider binding, from the
environment variable. **No `if (driver === ...)` anywhere in application code.**

---

## Files owned by this phase

```
src/infrastructure/payments/**
src/infrastructure/geocoding/**
src/infrastructure/http/{retry,circuit-breaker,redaction}.ts
payments-mock/**
docker/payments-mock.Dockerfile
docker-compose.yml          ← ONLY to add the `payments-mock` service
```

## Frozen contracts consumed

`PaymentGateway`, `GeocodingProvider`, `ChargeCommand`, `ChargeResult`,
`Coordinates`, `ShippingAddress` from P0.

---

## Acceptance criteria

1. Each of the four card outcomes is reproducible with a single `curl` against the api once P4 exists; for now, against a small driver script.
2. `docker stop payments-mock` → the adapter times out, retries with visible backoff, and the breaker opens. No unhandled rejection, no hang.
3. A timeout produces `UNKNOWN`, never a silent "failed".
4. Repeating a charge with the same idempotency key returns the identical response and does not create a second charge.
5. No card number appears anywhere in stdout, and the redaction check proves it.
6. The static provider returns identical coordinates across runs and process restarts.
7. With `GEOCODING_DRIVER` unset, the app starts and works with **no** Geoapify key present.

## Out of scope

Persisting `payments` rows (P4 does that), calling the gateway from a use case,
reconciliation (P6).

## References

FR-3, FR-4, NFR-3, NFR-6, C-4, C-5 · `infrastructure.md` §4
