# P6 — Hardening and Demo

| | |
|---|---|
| **Wave** | 4 |
| **Depends on** | P4 |
| **Parallel with** | — |
| **Risk** | medium |
| **Target** | Friday AM |

## Objective

Close the two failure paths that make the design honest — orphaned reservations
and unknown payments — then make the whole thing provable and reviewable in under
five minutes.

**This phase is where the assessment is won or lost.** A reviewer who cannot run
the project, or cannot see the concurrency proof, does not get to appreciate P1.

---

## Requirements

### R6.1 — Reservation reaper (FR-5)

A scheduled job that finds orders still `PENDING_PAYMENT` past
`reservation_expires_at` and resolves each one:

- Ask the payment provider for the authoritative status of that idempotency key (`GET /charge/:key` from P2).
- Charged → settle: commit the reservation, `PAID` → `CONFIRMED`, publish `order.confirmed`.
- Not charged → release the reservation, `CANCELLED` with a reason.
- Still unknown → leave it and retry next run, with a bounded number of attempts before alerting.

**Without this, a provider timeout leaks stock forever.** It is what makes FR-5's
`UNKNOWN` branch legitimate rather than a hole.

### R6.2 — Payment reconciliation

A scheduled job over `payments` where `settled_at IS NULL` and
`created_at < now() - interval`. Queries the provider and settles the row.
Overlaps with R6.1 by design — they attack the same hole from the order side and
the payment side.

### R6.3 — End-to-end concurrency proof (NFR-1)

Extend P1's harness to run through the **full HTTP stack**:

- Seed a product with exactly **N** units in a single warehouse.
- Fire **N + 20** concurrent `POST /orders`, all with approving cards, distinct idempotency keys.
- Assert: exactly **N** orders `CONFIRMED`, 20 clean `409`/`422`, `quantity_available = 0`, `quantity_reserved = 0`, and the ledger reconciles.
- Optionally run it against two api instances behind the nginx profile — same result, which is the NFR-7 claim.

Output a readable summary. This is the single most important artefact after the
code itself.

### R6.4 — Failure-path demo script

One script or `curl` collection that walks every branch, in order, with expected
output beside each:

1. happy path → `201`, shows the chosen warehouse and distance
2. declined card → `402`, stock returned
3. provider down (`docker stop payments-mock`) → `502`, reservation held, breaker opens
4. reaper resolves the held order after the TTL
5. unsatisfiable order → `422`
6. duplicate idempotency key → identical response, no second charge
7. concurrency proof

### R6.5 — README (NFR-9)

Clone to successful order in **under five minutes**:

- One-command start. Prerequisites. Port map.
- The design in ~1 page: why three phases and not one transaction, why the
  warehouse query is one statement, why the queue lives in PostgreSQL.
- Copy-pasteable `curl` for every scenario in R6.4.
- Known limitations, stated plainly — this reads as judgment, not as gaps.
- The `GEOCODING_DRIVER=geoapify` switch and the Geoapify attribution.

### R6.6 — Operational polish

- Graceful shutdown verified for api and worker.
- Request body size limit and basic rate limiting.
- Helmet; CORS configured explicitly, not wildcarded.
- OpenAPI served at `/docs`.
- One final pass: no secret, no card number, no PII in any log.

### R6.7 — Clean-clone rehearsal

`git clone` into a fresh directory, `docker compose up`, run R6.4 end to end.
**Do this on a machine state you have not been developing on.** It catches the
missing `.env.example` entry, the image that only built because of a cached
layer, the seed that assumed existing data.

---

## Files owned by this phase

```
src/application/jobs/reservation-reaper.*
src/application/jobs/payment-reconciliation.*
scripts/concurrency-e2e.ts
scripts/demo/**
README.md
```

---

## Acceptance criteria

1. An order left `PENDING_PAYMENT` past its TTL is resolved by the reaper — settled or released, never left hanging.
2. Killing `payments-mock` mid-flight and restarting it leads to a correct final state with no stock lost or leaked.
3. The concurrency proof passes repeatedly, never N+1.
4. Every scenario in R6.4 produces its documented output.
5. A clean clone reaches a successful order in under five minutes following only the README.
6. `/docs` renders the OpenAPI spec.
7. A `grep` for card numbers and secrets across the logs of a full demo run returns nothing.

## Out of scope

Deployment (explicitly dropped — the assessment does not ask for it and C-11
makes local the priority). Bulk and PATCH (P7).

## References

FR-5, NFR-1, NFR-3, NFR-6, NFR-7, NFR-9
