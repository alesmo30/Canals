# SPEC 06 — P5 Read Side: `GET /orders` and `GET /orders/:id`

> **Status:** Implemented
> **Depends on:** SPEC 01 (domain, schema, `idx_orders_keyset` — P0)
> **Date:** 2026-09-21
> **Objective:** Give the reviewer a read path to verify SPEC 05's write
> path (`POST /orders`) without opening `psql`: the full detail of an
> order and a paginated listing, both read-only, without touching any P4
> file.

## Scope

**In:**

- `GET /orders/:id` — full representation: order, lines with snapshot,
  payment attempts, assigned warehouse (id **and name**), distance
  computed from the shipping address to that warehouse, and the shipment
  if it exists. Unknown id or non-UUID shape → `404`, same RFC 9457
  envelope as SPEC 05 (`problem-details.filter.ts`, extended additively).
- `GET /orders` — **keyset** pagination (`created_at DESC, id DESC`,
  over `idx_orders_keyset`), never `OFFSET`. Opaque cursor (base64),
  `nextCursor` + `hasMore` in the response. Page size 20 by default,
  100 maximum. Each order on the page carries its lines — without
  incurring N+1.
- Combinable filters: `customerId`, `status`, `warehouseId`,
  `createdAtFrom`, `createdAtTo`. Same strict whitelist as P4: an
  unknown query param → `400` (never ignored).
- Hand-built projection DTOs for both endpoints — never the TypeORM
  entity, nor a `raw_response`/card field reachable by accident.
- New `orders-read.controller.ts` controller, registered alongside
  `OrdersController` (P4) in `api.module.ts` — same `orders` prefix,
  separate file (phases/05, collision note).

**Out of scope (for future specs):**

- Any write (`POST`, `PATCH`, `DELETE`).
- Aggregations, reports, text search.
- Reaper and reconciliation of `PENDING_PAYMENT`/`UNKNOWN` (P6) — this
  spec only reads what already exists, it does not interpret or fix
  stuck states.
- Bulk creation and `PATCH /orders` (P7).
- Any change to `orders.controller.ts`, `create-order.use-case.ts`,
  `order-response.dto.ts` or any other file owned by SPEC 05 — their
  already-exported types (`OrderResponseWarehouse`, `OrderResponseItem`)
  are reused by import, without modifying them.

## Data model

No new migration. `idx_orders_keyset`, `idx_orders_reaper`,
`(customer_id, created_at)` and the plain index on `warehouse_id`
already exist since SPEC 01 (`data-model.dbml`, `orders` table). This
section only lists new code.

### Read repository (`src/infrastructure/database/repositories/orders-read.repository.ts`)

Parameterized raw SQL via `dataSource.query()` (`references/coding-conventions.md`
convention: query builder out for anything performance/projection-critical).
Unlike `select-warehouse.sql`, `findPage`'s `WHERE` varies with whichever
filters arrived — it is not a single static statement, so it is built as
an array of parameterized fragments in TypeScript, not a `.sql` file
loaded from disk (see Decisions).

```ts
export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  warehouse_id: string | null;
  status: OrderStatus;
  currency: string;
  total_cents: string; // bigint comes back as a string from the driver
  created_at: Date;
}

export interface OrdersPageFilters {
  customerId?: string;
  status?: OrderStatus;
  warehouseId?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  cursor?: { createdAt: Date; id: string };
  pageSize: number; // already validated 1-100 in the DTO
}

export interface OrderDetailRow extends OrderRow {
  shipping_address: Record<string, unknown>;
  warehouse_name: string | null;
  distance_meters: number | null;
}

@Injectable()
export class OrdersReadRepository {
  // SELECT ... WHERE (combinable filters) AND (created_at, id) < ($cursor)
  // ORDER BY created_at DESC, id DESC LIMIT (pageSize + 1) — the +1 is the
  // lookahead used to compute hasMore without a second count() query.
  async findPage(filters: OrdersPageFilters): Promise<OrderRow[]>

  // WHERE order_id = ANY($1) — a single query for the whole page,
  // grouped by order_id in the service (R5.4).
  async findItemsByOrderIds(orderIds: string[]): Promise<OrderItemRow[]>

  // LEFT JOIN warehouses + ST_Distance(w.location, o.shipping_location).
  // LEFT JOIN, not INNER: warehouse_id is nullable in the schema (even
  // though in practice P4 always fills it before inserting the order —
  // see Risks).
  async findOrderById(id: string): Promise<OrderDetailRow | null>

  async findPaymentsByOrderId(orderId: string): Promise<PaymentAttemptRow[]>

  async findShipmentByOrderId(orderId: string): Promise<ShipmentRow | null>
}
```

### Cursor (`src/application/orders/helpers/cursor.helpers.ts`)

Purely mechanical (encoding/decoding a tuple, no business decision) —
lives in `helpers/`, not as a service method
(`references/coding-conventions.md`).

```ts
// base64(`${createdAt.toISOString()}|${id}`) — not JSON: it's only two
// fields and the client must never parse the structure, only echo it
// back.
export function encodeCursor(params: { createdAt: Date; id: string }): string
export function decodeCursor(cursor: string): { createdAt: Date; id: string }
// decodeCursor throws InvalidCursorError if the base64 doesn't carry
// exactly two parts separated by "|" or the date doesn't parse — mapped
// to 400 in the filter (same bucket as an invalid query param, not a
// new case).
```

### Query DTOs (`src/infrastructure/http/dto/list-orders-query.dto.ts`)

```ts
export class ListOrdersQueryDto {
  @IsOptional() @IsUUID('loose') customerId?: string;
  @IsOptional() @IsIn(ORDER_STATUS_VALUES) status?: OrderStatus;
  @IsOptional() @IsUUID('loose') warehouseId?: string;
  @IsOptional() @IsISO8601() createdAtFrom?: string;
  @IsOptional() @IsISO8601() createdAtTo?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
```

`ORDER_STATUS_VALUES` is reused from the array already exported by
`order.orm-entity.ts` — the enum is not duplicated.

### Response DTOs

```ts
// order-list.response.dto.ts
export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouseId: string | null;
  totalCents: number;
  currency: string;
  createdAt: string; // ISO
  items: OrderResponseItem[]; // reused from order-response.dto.ts (P4), untouched
}

export interface OrderListResponse {
  items: OrderListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// order-detail.response.dto.ts
export interface OrderDetailPaymentAttempt {
  attempt: number;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  failureCode: string | null;
  settledAt: string | null; // ISO | null
  createdAt: string; // ISO
}

export interface OrderDetailShipment {
  status: ShipmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderDetailResponse {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouse: OrderResponseWarehouse | null; // { id, name, distanceMeters } — reused from P4
  items: OrderResponseItem[];
  payments: OrderDetailPaymentAttempt[];
  shipment: OrderDetailShipment | null;
  totalCents: number;
  currency: string;
  createdAt: string;
}
```

Note what does **not** appear: `payments.raw_response`, `card_last4`,
`card_brand`, `provider_payment_id`, `idempotency_key` — see Decisions.

### New error (`src/application/orders/order-read.errors.ts`)

```ts
export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) { ... }
}
```

`problem-details.filter.ts` (P4, shared file) gains an additive branch:
`OrderNotFoundError` → same bucket as `CustomerNotFoundError`/
`ProductNotFoundError` (`404`, `urn:problem-type:not-found`) — the
already-existing `type`/`title` is reused, no second envelope is
invented (R5.1 explicitly asks for this).

## Implementation plan

Each step ends with `npm run lint` and `npm run build` green; from step
1 onward, also `npm run test:unit`.

1. **`cursor.helpers.ts`.** `encodeCursor`/`decodeCursor` + `InvalidCursorError`.
   *Verify:* unit tests — round-trip `encodeCursor(x)` → `decodeCursor`
   returns `x` back; a string that is not valid base64 or does not carry
   exactly one `"|"` throws `InvalidCursorError`.

2. **`OrderNotFoundError` + mapping in `problem-details.filter.ts`.**
   *Verify:* unit test — the exception maps to `404`,
   `urn:problem-type:not-found`, same shape as `CustomerNotFoundError`.

3. **`ListOrdersQueryDto`.** Filters + pagination with `class-validator`.
   *Verify:* unit tests — empty payload passes (everything optional);
   `pageSize=0`, `pageSize=101`, `status` outside the enum,
   `createdAtFrom` not ISO8601, and an unknown property each fail with
   its own message.

4. **`OrdersReadRepository.findPage` + `findItemsByOrderIds`.**
   *Verify:* integration test against a real Postgres
   (`references/testing.md`: its own fixtures with `randomUUID()`,
   without `seed.ts`) — seed 50 orders with spaced-out `created_at`,
   paginate 20 at a time and confirm 0 duplicates/0 gaps across the 50;
   `findItemsByOrderIds([])` does not blow up.

5. **`ListOrdersService`** (`src/application/orders/list-orders.service.ts`).
   Orchestrates step 4's two queries, groups items by `order_id`,
   decides `hasMore` (did the page bring back `pageSize + 1` rows?) and
   builds `nextCursor` from the last **retained** row (not the lookahead
   one).
   *Verify:* unit test with a fake repository — a page of 3 with
   `pageSize=2` gives 2 items, `hasMore=true`, `nextCursor` points at
   the 2nd row.

6. **`order-list.response.dto.ts`.** `toOrderListItem`/`toOrderListResponse`
   — explicit field-by-field mapping, reusing P4's `OrderResponseItem`.
   *Verify:* unit test — an `OrderRow` + its `OrderItemRow[]` produce the
   expected shape; no field outside the interface survives a
   `JSON.stringify` of the result (a guard against an accidental spread
   of the entity).

7. **`OrdersReadRepository.findOrderById` + `findPaymentsByOrderId` +
   `findShipmentByOrderId`.**
   *Verify:* integration test — an order seeded with 2 payment attempts
   and a shipment: all three queries return the correct rows;
   a non-existent id → `findOrderById` returns `null` (does not throw).

8. **`GetOrderService`** (`src/application/orders/get-order.service.ts`).
   Validates `id`'s UUID shape (regex, without hitting the database for
   a malformed-shape id — see Decisions), calls step 7's three queries
   in parallel (`Promise.all`, they're independent) and throws
   `OrderNotFoundError` if `findOrderById` gives `null`.
   *Verify:* integration test — a malformed-shape id and a well-formed
   but non-existent id both throw `OrderNotFoundError`; a real id
   returns the three assembled sets.

9. **`order-detail.response.dto.ts`.** `toOrderDetailResponse` —
   explicit projection, `warehouse: null` if `warehouse_id`/`warehouse_name`
   came back null, `shipment: null` if there is no row.
   *Verify:* unit test — confirms that `card_last4`/`card_brand`/
   `raw_response`/`provider_payment_id`/`idempotency_key` exist under no
   key of the resulting object, nested or otherwise.

10. **`orders-read.controller.ts` + registration in `api.module.ts`.**
    `GET /orders/:id`, `GET /orders` with
    `@Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))`
    (see Decisions — the global `ValidationPipe` in `main.ts` is not
    touched).
    *Verify:* `curl localhost:3000/orders` and
    `curl localhost:3000/orders/<seeded-id>` against `npm run seed`
    return `200` with the expected shape; `curl localhost:3000/orders/does-not-exist`
    → `404`; `curl 'localhost:3000/orders?bogus=1'` → `400`.

11. **End-to-end acceptance coverage.** Integration/e2e suite for the 8
    AC below: full pagination of 50 orders with no duplicates or gaps,
    a concurrent insert mid-pagination, `EXPLAIN` on step 4's query
    (no-filter case), query count per page (logged/counted via a spy on
    `dataSource.query` in the test, not in production), each filter
    alone and combined, a `grep` over the whole suite's responses
    confirming the absence of any card data or `raw_response`, and an
    unknown query param → `400`.
    *Verify:* the full `npm run verify` green.

## Acceptance criteria

- [x] Paginating the 50 seeded orders reaches each one exactly once, with no duplicates or gaps.
- [x] Inserting a new order **mid-pagination** does not shift or duplicate results on subsequent pages.
- [x] No `OFFSET` appears in any query.
- [x] `EXPLAIN` on the listing query (base case, no filters) shows `idx_orders_keyset` in use.
- [x] Each filter works alone and in combination with the others.
- [x] A page of 20 orders with their items emits a bounded number of queries, not 21.
- [x] No card data nor the gateway's raw payload is reachable from any response.
- [x] An unknown query param returns `400`.

## Decisions

- **Yes:** `findPage`'s `WHERE` is built as an array of parameterized
  SQL fragments in TypeScript, not as a static `.sql` file (unlike
  `select-warehouse.sql`). R5.3's filters are optional and combinable —
  a fixed statement cannot express "any subset of 5 filters" without a
  combinatorial explosion of files.
- **No:** a `.sql` per possible filter combination. Unmaintainable and
  adds nothing the fragment array doesn't already give (it's still
  parameterized SQL, no query builder).
- **Yes:** the items page resolved in 2 queries — `findPage` (one) +
  `findItemsByOrderIds` (one, `WHERE order_id = ANY($1)`) — grouped in
  the service. Satisfies R5.4 with a fixed number of queries,
  independent of page size.
- **No:** a single `SELECT` with `json_agg` of items per order. The
  `LIMIT pageSize + 1` that decides `hasMore` (step 5) needs *order*
  rows, not *line* rows; a join with item fan-out breaks that count
  unless it's aggregated before paginating, which complicates the
  ordering query's plan — exactly what the `EXPLAIN` AC (#4) asks to
  keep simple.
- **Yes:** cursor = `base64("${createdAt.toISOString()}|${id}")`.
  Opaque to the client (FR-7), two fields are enough — no need for JSON.
- **No:** a JSON or signed/encrypted cursor. It's not a security
  boundary (nothing sensitive travels in the cursor, only a timestamp
  and an id the client already saw on the previous page), just shape
  opacity.
- **Yes:** the next-page condition is a real Postgres tuple comparison:
  `(created_at, id) < ($cursorCreatedAt, $cursorId)`, not two hand-written
  `OR` conditions. Postgres evaluates the row comparison directly, and
  that's what makes a `created_at` tie (two orders with the same
  timestamp) resolve correctly by `id` with no extra logic.
- **Yes:** the payment attempt projected in `OrderDetailResponse`
  exposes `{attempt, status, amountCents, currency, failureCode,
  settledAt, createdAt}` — leaving out `card_last4`, `card_brand`,
  `provider_payment_id` and `idempotency_key`, plus `raw_response`.
  R5.5 explicitly separates "`raw_response`" from "any card data" as
  two things to protect; neither FR-7 nor R5.1 asks to show the brand or
  last 4 digits on the read side, and a hand-built projection (not a
  spread of the entity) is exactly the mechanism R5.5 asks for so
  leaking something by accident is "impossible". If a reviewer needs to
  see the brand/last 4 later, that's a line in another spec, not an
  inference from this one.
- **No:** including `card_last4`/`card_brand` "because they're already
  safe" (NFR-6 allows them in general). Allowed in general is not the
  same as asked for here — the smaller surface is the one R5.5
  describes.
- **Yes:** a non-UUID-shaped `:id` in `GET /orders/:id` is treated the
  same as a well-formed but non-existent id → `404`
  (`OrderNotFoundError`), without reaching the database or adding a new
  validation branch to the filter. From the client's side, a made-up id
  and a malformed one are indistinguishable in practice, and this
  avoids adding a second kind of `400` error to a filter SPEC 05 already
  closed out with its own 7-row table.
- **No:** a `ParseUUIDPipe`/path-param DTO returning `400` for a
  malformed `:id`. It's a distinction with no real value for the client
  and widens the error contract without R5.1 asking for it.
- **Yes:** `GET /orders` validates its query with a **local**
  `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true,
  transform: true`) passed directly to the `@Query(...)` decorator,
  instead of touching the global `ValidationPipe` in `main.ts`. The
  global one (P0, `whitelist`/`forbidNonWhitelisted` without `transform`)
  is already what `POST /orders` uses (SPEC 05, verified green);
  `transform: true` is needed here so `pageSize` arrives as a `number`
  and not a `string`, but adding it to the global pipe would risk
  changing how `CreateOrderDto` coerces its own fields without any AC
  of this spec covering that.
- **No:** adding `transform: true` to the global `ValidationPipe`.
  Touches an already-closed and verified spec for a benefit a local
  pipe gives just as well, without the risk.
- **Yes:** `findOrderById` uses `LEFT JOIN warehouses` (not
  `INNER JOIN`), returning `warehouse: null` in the response if
  `warehouse_id` is null. The schema allows a null `warehouse_id`
  (`data-model.dbml`: "Null only while allocation is in flight"), and
  even though in practice SPEC 05 only inserts the `orders` row after
  the allocation has already succeeded, this endpoint must not assume
  that other spec's invariant — it should keep returning something
  coherent if that invariant ever changed.
- **No:** `INNER JOIN` (would fail to return the whole order if an
  order without a warehouse ever exists — a false `404` for a real
  order).
- **Yes:** `GetOrderService` fires its three queries (order+warehouse,
  payments, shipment) with `Promise.all` — they are independent of each
  other, no reason to serialize them.
- **No:** three sequential `await`s. Would be latency for no reason.

## Risks

| Risk | Mitigation |
|---|---|
| `idx_orders_keyset` is declared `(created_at, id)` in the migration, with no explicit `DESC`. `ORDER BY created_at DESC, id DESC` needs Postgres to walk the index **backward** (`Index Scan Backward`), not forward — a two-column ascending btree does support this natively, but it isn't confirmed against a real `EXPLAIN` until step 11. | Step 11 runs `EXPLAIN` against a real Postgres and AC #4 explicitly requires it before considering the spec satisfied. If the plan does not use the index, the mitigation is to review `ANALYZE`/statistics before considering a new explicit `DESC` index (out of scope for this spec's "no new migration", but documented here as the next question if the risk materializes). |
| An `EXPLAIN` with the `customerId` filter may legitimately pick the `(customer_id, created_at)` index instead of `idx_orders_keyset` — that's the planner's correct choice for that filter, not a regression. AC #4 is only verified against the base case (no filters); it is not read as a guarantee that *every* filter uses *that* specific index. | Documented here so whoever reads AC #4 does not take it as "the keyset index is always used no matter what" — step 11 runs the base case's `EXPLAIN` only. |
| `findItemsByOrderIds` with an empty page (`orderIds = []`) — `WHERE order_id = ANY($1::uuid[])` with an empty array is valid SQL in Postgres (returns zero rows), but it's worth confirming explicitly in a test rather than assuming it. | Covered in step 4's *Verify* — the empty-array case is deliberately exercised. |
| The "not 21" query-count AC has no native way to be measured in production without new instrumentation (out of scope). A test spy on `dataSource.query` is the only measurement, and it might not capture a query issued through a different path (e.g. if TypeORM's internal `QueryRunner` made an extra call not visible through `dataSource.query`). | Accepted for this spec — the same level of rigor R5.4 asks for ("log the count... and record it in the phase notes"), not a runtime-instrumented guarantee. If a discrepancy shows up, it's documented in step 11's implementation notes, it does not block the spec. |

## What is **not** in this spec

- Any write to `orders`/`order_items`/`payments`/`shipments`.
- Reaper and reconciliation (P6) — the read side shows what's there, it
  doesn't decide whether an old `PENDING_PAYMENT` order should be
  released.
- Bulk creation and `PATCH /orders` (P7).
- Aggregations, reports or text search over orders.
- Any change to `orders.controller.ts`, `create-order.use-case.ts` or
  `order-response.dto.ts` (SPEC 05) beyond importing their
  already-exported types.

Each of these, if it lands, goes in its own spec.
