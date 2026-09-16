# P5 — Read Side

| | |
|---|---|
| **Wave** | 2 (can start as early as P0 is done) |
| **Depends on** | P0 only |
| **Parallel with** | anything |
| **Risk** | low |
| **Target** | Thursday PM |

## Objective

`GET /orders` and `GET /orders/:id`. Without a read path the reviewer cannot
verify the write path — this is why it is in scope at all (§2.1).

Low risk and fully independent: **a good phase to run alongside P1 or P4** when a
second session is free.

---

## Requirements

### R5.1 — `GET /orders/:id`

Full representation: order, items with snapshots, payment attempts, selected
warehouse (id **and name**), shipment if it exists, and the computed distance
from the shipping address to the warehouse.

Unknown id → `404` in the same problem+json envelope P4 defines. Coordinate the
envelope shape with P4 rather than inventing a second one.

### R5.2 — `GET /orders` with keyset pagination (FR-7)

**Keyset (cursor), not `OFFSET`.** Offset degrades linearly and produces
duplicates and gaps when rows are inserted concurrently — which is exactly this
workload. Using `OFFSET` here would be a visible mistake.

- Sort `(created_at DESC, id DESC)`, backed by `idx_orders_keyset`.
- Cursor is opaque to the client (base64 of the sort tuple).
- Response carries `nextCursor` and `hasMore`.
- Page size default 20, maximum 100, validated.

### R5.3 — Filters

`customerId`, `status`, `warehouseId`, `createdAtFrom`, `createdAtTo`.
Combinable. Validated with the same strict whitelist as P4 — unknown query
parameters are rejected, not ignored.

### R5.4 — No N+1 (NFR-2)

Fetching a page of 20 orders with their items must not issue 21 queries. Log the
query count for one page request and record it in the phase notes.

### R5.5 — Projection, not entities

Return a response DTO, never the ORM entity. In particular `payments.raw_response`
and anything card-related must be impossible to leak by accident.

---

## Files owned by this phase

```
src/application/orders/list-orders.*
src/application/orders/get-order.*
src/infrastructure/http/controllers/orders-read.controller.ts
src/infrastructure/http/dto/order-response.dto.ts
src/infrastructure/database/repositories/orders-read.repository.ts
```

> `orders.controller.ts` belongs to P4. Use a separate controller file to avoid a
> collision if both phases run at once.

---

## Acceptance criteria

1. Paging through 50 seeded orders reaches every order exactly once, with no duplicates or gaps.
2. Inserting a new order **mid-pagination** does not shift or duplicate results on subsequent pages.
3. No `OFFSET` appears in any query.
4. `EXPLAIN` on the list query shows the keyset index in use.
5. Each filter works alone and in combination.
6. A page of 20 orders with items issues a bounded number of queries, not 21.
7. No card data or raw gateway payload is reachable through any response.
8. An unknown query parameter returns `400`.

## Out of scope

Writes of any kind. Aggregations, reporting, search.

## References

FR-7, NFR-2, NFR-6 · `data-model.dbml` (`idx_orders_keyset`)
