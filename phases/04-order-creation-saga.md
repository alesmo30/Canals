# P4 — Order Creation Saga 🔴

| | |
|---|---|
| **Wave** | 3 — sequential |
| **Depends on** | P0, P1, P2, P3 |
| **Parallel with** | P5 |
| **Risk** | 🔴 **high** — this is the integration phase |
| **Target** | Thursday PM |

## Objective

`POST /orders`. Wire P1 (allocation), P2 (payment, geocoding) and P3 (events)
into the three-phase saga, with idempotency and a clean error contract.

**Budget more time than feels necessary.** Integration always surprises.

---

## Requirements

### R4.1 — Endpoint and validation (FR-1, FR-8)

- `POST /orders` with the request shape in FR-1.
- DTO validation with a **strict whitelist**: unknown properties are *rejected*,
  not stripped, so the client learns about its mistake.
- `Idempotency-Key` header **required**; a missing one is a `400`.
- Quantities positive integers; items non-empty; no duplicate `productId` in one request
  (merge or reject — decide and document).

### R4.2 — Idempotency (FR-6)

- Insert into `idempotency_keys` under its unique constraint **before any work begins**. The constraint is what serialises duplicates, not application logic.
- Store a SHA-256 fingerprint of the canonicalised body.
- Same key + same body, still running → `409`.
- Same key + same body, completed → **replay the stored response verbatim**.
- Same key + **different** body → `422`.
- Keys expire after 24 h.

### R4.3 — The three-phase saga (FR-5)

**Phase 1 — Reserve (short transaction):**
resolve customer and products → geocode → select warehouse (P1) → reserve stock
(P1) → insert `orders` as `PENDING_PAYMENT` with `reservation_expires_at` →
insert `order_items` **with price snapshots** → commit.

**Phase 2 — Charge (NO transaction open):**
call `PaymentGateway.charge` (P2) with a stable idempotency key. Persist the
attempt in `payments` regardless of outcome.

**The charge idempotency key (fixed by SPEC 03, built here):**

- Format: `order:<orderId>:attempt:<n>`, e.g. `order:8f3c…e21a:attempt:1`
  (~53 chars, fits `payments.idempotency_key varchar(128)`).
- `<n>` is `payments.attempt` — a **business-level payment attempt** (one
  `payments` row), **not** an HTTP retry. The P2 adapter's up-to-3 HTTP retries
  all reuse the same key, which is exactly what stops the provider charging twice.
- Today `<n>` is always `1`: `DECLINED` is terminal (`PAYMENT_FAILED`), so nothing
  creates a second attempt. The column exists so a future "pay with another card"
  gets a fresh key without breaking anything.
- The helper building it lives in `src/application/orders/charge-idempotency-key.ts`
  (pure function, unit-tested). Not in `src/infrastructure/payments/` — the
  application layer must not import infrastructure (`references/layering.md`).
- The key is persisted in `payments.idempotency_key` **before** calling `charge`,
  so P6's reconciliation reads it back from the row and never rebuilds it.
- A different string per HTTP retry, or a random key, would turn one timeout into
  several real charges.

**Phase 3 — Settle (short transaction):**

| Outcome | Action |
|---|---|
| approved | commit reservation, `PAID` → `CONFIRMED`, publish `order.confirmed` **in this transaction** |
| declined | release reservation, `PAYMENT_FAILED` |
| `UNKNOWN` | leave `PENDING_PAYMENT`, reservation intact, let P6's reconciliation decide |

> **The hard rule:** no database transaction may be open while the payment call is
> in flight. If a reviewer finds one, the whole NFR-1 story collapses.

### R4.4 — Totals

`total_cents` is computed from the line snapshots and persisted as the
authoritative amount sent to the payment provider. Integer arithmetic only.
No tax, no shipping cost (out of scope per §2.2).

### R4.5 — Error contract (FR-8)

Single envelope based on RFC 9457 (`application/problem+json`) with
`type`, `title`, `status`, `detail`, `instance`, `correlationId`, and a structured
`errors[]` for field-level failures.

Mapping — all of these must be reachable with the seeded data:

| Condition | Status |
|---|---|
| invalid payload | 400 |
| unknown customer / product | 404 |
| no single warehouse can fill it | 422 (naming the unsatisfiable products) |
| geocoding failed | 422 |
| inventory race lost on all candidates | 409 |
| payment declined | 402 |
| payment provider unreachable | 502 |

Error responses never echo sensitive input. Unhandled exceptions become a generic
`500` with a correlation id; the stack trace goes to logs only.

### R4.6 — Response

`201` with the full order: id, `order_number`, status, selected `warehouseId` **and
its name**, the computed distance, line items with snapshots, total, payment
status. The reviewer must be able to see *which warehouse was chosen and why*
without opening psql.

### R4.7 — Wiring

- `ApiModule` imports `SharedModule` and the controllers. It must **not** import `WorkerModule`.
- All ports resolved through DI. No adapter is constructed directly in a use case.

---

## Files owned by this phase

```
src/application/orders/create-order.*
src/application/orders/idempotency.*
src/application/orders/charge-idempotency-key.ts
src/infrastructure/http/controllers/orders.controller.ts
src/infrastructure/http/dto/**
src/infrastructure/http/filters/problem-details.filter.ts
src/modules/api.module.ts
```

---

## Acceptance criteria

1. A valid order returns `201` and picks the demonstrably nearest qualifying warehouse.
2. Replaying the same `Idempotency-Key` returns the identical body and creates **no** second order and **no** second charge.
3. Card `...0002` → `402`, order `PAYMENT_FAILED`, **stock returned to `quantity_available`**.
4. Card `...0004` → `502`, order stays `PENDING_PAYMENT`, reservation intact.
5. `docker stop payments-mock` → `502`, reservation intact, breaker opens.
6. An unsatisfiable order returns `422` and persists **nothing**.
7. Every one of the seven error rows in R4.5 is reproducible by `curl`.
8. A successful order produces exactly one shipment, asynchronously, visible within ~1 s.
9. No card number in any response, log or trace.
10. Grafana shows one trace: request → geocode → selection → reserve → charge → settle → jobs.

## Handoff from SPEC 03 (P2 — external adapters)

Decided while specifying P2; P4 must honour them:

- **Charge idempotency key** — format and ownership in R4.3, Phase 2 above.
- **`charge()` never throws on provider failure.** Only two outcomes are
  definitive: `CAPTURED` (2xx) and `DECLINED` (402). Everything else — 5xx after
  retries, timeout, network error, circuit breaker open — comes back as
  `UNKNOWN`. P4 maps `UNKNOWN` → `502` and keeps the reservation (AC 4 and 5).
- **`ChargeResult.failureCode` carries the exact cause** on `UNKNOWN`:
  `TIMEOUT`, `PROVIDER_ERROR`, `CONNECTION_REFUSED`, `CIRCUIT_OPEN`. The last two
  mean the request provably never reached the provider. P4 keeps `502` + reservation
  intact for all of them today; the code is there so a later refinement (release
  immediately and answer `503` + `Retry-After`) needs no adapter change.
- **A `502` is "payment outcome unknown", not "order failed".** The order exists in
  `PENDING_PAYMENT` and P6's reconciliation will settle it. The `502` problem body
  must include the `orderId` and say the payment is pending confirmation, so the
  client checks `GET /orders/:id` instead of re-posting with a new
  `Idempotency-Key` — which would create a second order and, if the first charge
  did go through, charge the customer twice.

## Out of scope

Reaper and reconciliation (P6). Bulk and PATCH (P7). Read endpoints (P5).

## References

FR-1, FR-4, FR-5, FR-6, FR-8, NFR-1, NFR-3, NFR-6
