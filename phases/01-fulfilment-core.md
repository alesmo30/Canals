# P1 — Fulfilment Core 🔴

| | |
|---|---|
| **Wave** | 1 |
| **Depends on** | P0 |
| **Parallel with** | P2, P5 |
| **Risk** | 🔴 **highest in the project** |
| **Target** | Wednesday PM → Thursday AM |

## Objective

The two mechanisms the assessment is actually testing:

1. Find the **single** warehouse that holds every requested product, and among
   those, the one **closest** to the shipping address.
2. Reserve that stock so that **no amount of concurrency can oversell**.

This phase builds and proves those two in isolation, before any HTTP, payment or
queue code exists around them. **Give it the most time.**

---

## Requirements

### R1.1 — Warehouse selection query (FR-2)

A **single, hand-written, parameterised SQL statement**. Not a query builder, not
a loop in application code.

It must:

- Accept a shipping point and a list of `(product_id, quantity)` pairs.
- Return only warehouses where **every** requested line has
  `quantity_available >= requested_quantity`.
- Use `GROUP BY warehouse_id` + `HAVING count(*) = :lineCount` for "has them all".
- Order by proximity using `location <-> :point` so the **GiST index drives the
  ordering**, not a post-hoc sort.
- Also return the exact distance via `ST_Distance` for the response payload.
- Break ties deterministically by `warehouse.id`.
- Exclude inactive warehouses and inactive products.
- Return the **top N candidates** (N = 3), not just one — R1.3 needs the fallbacks.

> `ST_MakePoint` takes **longitude first**. Getting this backwards routes orders to
> the wrong continent without raising an error. Assert it in the seed check.

### R1.2 — Prove the query uses the index

`EXPLAIN` on the selection query must show `Order By:` **inside** an
`Index Scan using` the GiST index — not a separate `Sort` node above a `Seq Scan`.

Capture the plan output in the phase notes. If the planner refuses the index
scan once the inventory join is present, that is a real finding: record it,
and fall back to selecting candidate warehouses by availability first and
ordering that smaller set by distance.

### R1.3 — Reservation (FR-5 phase 1, NFR-1)

An `InventoryService.reserve(...)` operating in **one short transaction**:

1. `SELECT ... FROM inventory ... FOR UPDATE` for the candidate warehouse's rows,
   **`ORDER BY product_id`**. The ordering is what prevents deadlocks between
   concurrent orders touching the same products in different sequence.
2. Re-verify availability under the lock. The selection query in R1.1 is a *read*
   and guarantees nothing; **this step is the authority**.
3. `quantity_available -= qty`, `quantity_reserved += qty`.
4. Append `RESERVE` rows to `inventory_movements` with the resulting balances.
5. Commit.

If availability fails under the lock, roll back and **fail over to the next
candidate** from R1.1, up to 3 attempts, then surface "no fulfilment possible".

**The transaction must not contain any network call.** Nothing HTTP happens
inside it, ever.

### R1.4 — Release and commit

- `release(...)` — reservation → available. Appends `RELEASE` movements. Used on
  payment failure and by the reaper.
- `commit(...)` — reservation → gone. Appends `COMMIT` movements. Used on payment success.
- Both idempotent at the service level: releasing an already-released reservation
  must not double-credit stock. Guard on order status, inside the transaction.

### R1.5 — Ledger integrity

`inventory_movements` is append-only. Never updated, never deleted. A test query
must be able to reconstruct any `inventory` row's current balance by replaying its
movements — this is the audit property NFR-5 promises, and it is worth
demonstrating in the README.

### R1.6 — Concurrency harness

A script (not a formal test suite) that:

- Seeds a product with exactly **N** units in one warehouse.
- Fires **N + 20** concurrent reservation attempts.
- Asserts: exactly N succeed, 20 fail cleanly, `quantity_available` ends at 0,
  and no `CHECK` constraint ever fired.

This is the proof for NFR-1 and P6 reuses it end-to-end. Build it here, where
there is nothing else in the way to blame.

---

## Files owned by this phase

```
src/domain/services/warehouse-selection.*      (pure ranking/eligibility rules)
src/application/allocation/**
src/infrastructure/database/repositories/warehouse-selection.repository.ts
src/infrastructure/database/repositories/inventory.repository.ts
src/infrastructure/database/sql/select-warehouse.sql
scripts/concurrency-check.ts
```

## Frozen contracts consumed

`Order`, `OrderItem`, `Inventory`, `Warehouse`, `Coordinates`, `Money` from P0.
**Do not modify them.**

---

## Acceptance criteria

1. Given the seeded data, the query returns the **provably nearest** qualifying warehouse — verifiable by hand against the known city coordinates.
2. An order containing a product that no single warehouse can fully supply returns "no fulfilment", **even when the combined stock across warehouses would cover it** (C-6).
3. `EXPLAIN` shows index-assisted ordering, or the deviation is documented with its reason.
4. The concurrency harness passes: N successes out of N+20 attempts, never N+1.
5. No `CHECK` constraint violation appears in the logs during the harness run — the application-level locking holds on its own, with the constraint as an unused backstop.
6. Replaying `inventory_movements` reproduces the current balances exactly.
7. No HTTP call exists anywhere inside a transaction.

## Out of scope

HTTP endpoints, payment, geocoding (the harness passes coordinates directly),
queue, the order state machine beyond what reservation needs.

## References

FR-2, FR-5 (phase 1), NFR-1, NFR-2, NFR-5, C-6, C-7
