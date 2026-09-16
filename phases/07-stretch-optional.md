# P7 — Stretch (GATED)

| | |
|---|---|
| **Wave** | 4 |
| **Depends on** | P6 complete and green |
| **Risk** | — |
| **Target** | Friday PM, **only if** the gate below passes |

---

## ⛔ Gate

Do not start this phase unless **all** of these are true on Friday at midday:

- [ ] P0–P6 complete
- [ ] The clean-clone rehearsal (R6.7) passed
- [ ] The concurrency proof (R6.3) passes repeatedly
- [ ] Every failure path in R6.4 behaves as documented
- [ ] The README is finished

**If any box is unchecked, stop.** A polished core beats a broader one with rough
edges — and the assessment explicitly says *"Only the functionality specified
above"*. FR-10 and FR-11 are already documented as out of scope with reasons; that
documentation is itself a valid deliverable.

---

## R7.1 — Bulk order creation (FR-10)

- `POST /orders/bulk`, **maximum 25 orders** per request.
- Each order runs through the *same* P4 pipeline. No parallel implementation —
  if this requires duplicating logic, the design is wrong and it is better to skip it.
- `207 Multi-Status` with a per-item result array; partial success is explicit.
- Each item keeps its own idempotency key.
- Rejects a batch over 25 with `400`.

> The cap is low on purpose: every order does its own geocoding call, warehouse
> selection, inventory locking and payment call, so 25 already holds locks and
> burns provider quota for a meaningful stretch. Anything larger should be an
> async job with a status endpoint, which is a different feature.

## R7.2 — Order modification (FR-11)

- `PATCH /orders/:id`, **only** while the order is `PENDING_PAYMENT`.
- **Only** fields that touch neither stock nor money: recipient name, address
  line 2, delivery notes.
- Any attempt to change `items`, the shipping city, or totals → `409` with an
  explanation. Those would require re-running warehouse selection and
  re-reserving stock, which is a materially larger feature.
- The allowed transitions go in the domain state machine from P0, not in the controller.

## R7.3 — If skipped

Confirm `architectural-requirements.md` §2.2 still states both as out of scope
with their reasoning, and mention them in the README's limitations section. Being
able to say *"I scoped these out deliberately, here is why"* is a stronger answer
than a half-finished `PATCH`.

---

## Files owned by this phase

```
src/application/orders/create-orders-bulk.*
src/application/orders/update-order.*
src/infrastructure/http/controllers/orders-bulk.controller.ts
src/infrastructure/http/dto/bulk-order.dto.ts
src/infrastructure/http/dto/update-order.dto.ts
```

Must not modify anything P4 owns. If bulk cannot reuse P4's `CreateOrder` use
case as-is, skip the phase rather than fork the pipeline.

---

## Acceptance criteria

1. A bulk request of 25 with one invalid order returns `207`: 24 created, 1 reported with its error.
2. A bulk request of 26 returns `400`.
3. `PATCH` on a `CONFIRMED` order returns `409`.
4. `PATCH` on an allowed field of a `PENDING_PAYMENT` order returns `200`, and stock and totals are untouched.
5. Nothing in P0–P6 regressed. Re-run R6.4 and R6.3 afterwards.

## References

FR-10, FR-11
