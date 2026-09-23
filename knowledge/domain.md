# Domain

The domain layer (`src/domain/**`) holds the only two rich domain classes
(`Order`, `OrderItem`), three value objects, enum value sets and the ports.
It has no Nest or TypeORM imports. Anything the database already guarantees
(a `CHECK`, a unique index, a `HAVING`) is not re-checked here; see the
domain-service test in [references/layering.md](../references/layering.md).

Source for the whole layer: [spec 01, “Domain layer, frozen” and Decisions › “Layering and contracts”](../specs/01-foundation.md#domain-layer-frozen).

## Order state machine

Code:
- `src/domain/entities/order-status.transitions.ts` → `ORDER_TRANSITIONS`, `assertValidOrderTransition`
- `src/domain/entities/order.ts` → `Order.markPaid`, `Order.markPaymentFailed`, `Order.confirm`, `Order.cancel`
- `src/domain/entities/order-status.transitions.spec.ts` → the "terminal states reject every outgoing transition" cases

The whole state machine is one readable transition table:

```
PENDING_PAYMENT -> PAID -> CONFIRMED
PENDING_PAYMENT -> PAYMENT_FAILED
PENDING_PAYMENT -> CANCELLED        (reservation expired)
```

`PAYMENT_FAILED` and `CANCELLED` are both **terminal**, with no transition
between them. The ASCII diagram in
[architectural-requirements.md](../engineering:documentation/architectural-requirements.md)
draws an arrow from `PAYMENT_FAILED` to `CANCELLED`, but three other
passages of the same document disagree with it:

1. the `order_status` enum's note calls `PAYMENT_FAILED` terminal;
2. the settle phase of the order-creation flow lists exactly three
   outcomes, with nothing after `PAYMENT_FAILED`;
3. the reservation reaper and payment reconciliation only ever act on
   orders still in `PENDING_PAYMENT`.

The arrow is read as a layout artifact, not a fourth transition. This was
flagged when the table was implemented and nobody objected. A unit test
asserts that `PAYMENT_FAILED -> CANCELLED` is rejected.

`assertValidOrderTransition(from, to)` throws when `from -> to` is not an
edge of `ORDER_TRANSITIONS`. Every mutating method on `Order` calls it
first:

| Method | Transition | Meaning |
|---|---|---|
| `markPaid()` | `PENDING_PAYMENT -> PAID` | The payment provider captured the charge. |
| `markPaymentFailed()` | `PENDING_PAYMENT -> PAYMENT_FAILED` | Declined. The caller has already released the reservation (inventory is a use-case concern, not this entity's). |
| `confirm()` | `PAID -> CONFIRMED` | The reservation is committed for good and the `order.confirmed` event fires (outbox). |
| `cancel(reason)` | `PENDING_PAYMENT -> CANCELLED` | Reservation expired without a definitive payment. |

In practice the settle step is done by `OrderSettlementService` under a row
lock, not by the in-memory entity alone; see
[orders-saga.md#settlement](orders-saga.md#settlement).

Source: [spec 01, Decisions › “Layering and contracts” (“PAYMENT_FAILED and CANCELLED both terminal”)](../specs/01-foundation.md#decisions).

## Order entity

Code:
- `src/domain/entities/order.ts` → `Order`, `OrderProps.total`
- `src/domain/entities/order.spec.ts` → "does not compile when assigning to status"

`Order` mirrors an `orders` row. `status` is exposed **only** through
`getStatus()`; there is no public `status` property, so
`order.status = 'CONFIRMED'` is a compile error (TS2339), not just a bad
runtime value. The only way to change status is through the named methods
above, each of which checks the transition table first.

The unit test locks this in with a `@ts-expect-error` on a direct
assignment. If someone later adds a public `status` field, the directive
becomes "unused" and the test fails loudly instead of silently passing.

`OrderProps.total` is the authoritative amount charged. The database stores
`currency` and `total_cents` as separate columns; in the domain they are one
`Money` value, so currency and amount can never disagree.

## Order item

Code: `src/domain/entities/order-item.ts` → `OrderItem`, `OrderItem.getLineTotal`

`OrderItem` mirrors an `order_items` row. It resolves the many-to-many
between orders and products and **freezes the price and product identity at
purchase time** (data-model note). The constructor guards `quantity > 0`,
independently of the database `CHECK`.

`getLineTotal()` is `quantity * unitPrice`, exact in integer-cent
arithmetic. It is deliberately not a stored column; it is always derived.

Source: [data-model.dbml, `order_items` note](../engineering:documentation/data-model.dbml).

## Enums

Code:
- `src/domain/enum-types/order-status.ts` → `OrderStatus`
- `src/domain/enum-types/payment-status.ts` → `PaymentStatus`
- `src/domain/enum-types/product-condition.ts` → `ProductCondition`
- `src/domain/enum-types/shipment-status.ts` → `ShipmentStatus`

Each file mirrors a Postgres enum from the data model and holds only the
value set. The allowed order transitions live separately, in
`order-status.transitions.ts`.

- `PaymentStatus.UNKNOWN`: the provider timed out (or was unreachable). It is
  resolved later by the reconciliation job
  ([messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation)).
- `ProductCondition` lives on the **product**, not on inventory: a
  refurbished iPhone is a distinct SKU at a distinct price, not the same
  product in a different state.
- Enums that exist only for infrastructure (`idempotency_state`,
  `inventory_movement_type`) have no domain mirror; see
  [database.md#entities](database.md#entities).
- Runtime arrays of these values, needed by TypeORM's `enum` column option,
  live next to the ORM entities (`ORDER_STATUS_VALUES`, …).

## Coordinates

Code:
- `src/domain/value-objects/coordinates.ts` → `Coordinates`, `Coordinates.of`
- `src/domain/value-objects/coordinates.spec.ts` → "does not compile with positional latitude/longitude"

A geodetic point. It backs `warehouses.location` and
`orders.shipping_location` (both `geography(Point,4326)`) and is what
`GeocodingProvider.geocode()` returns.

**No distance method, on purpose.** Distance ranking is done in one SQL
statement (`location <-> :shippingPoint`, PostGIS geodesic distance,
assisted by the GiST index). That is a database responsibility; a JS
version would be a second, divergent notion of "distance". See
[allocation.md#selection-query](allocation.md#selection-query).

**`Coordinates.of({ latitude, longitude })` takes one named object**, not
positional arguments. Both values are plain `number`, so positional
`Coordinates.of(lng, lat)` would compile silently, and the ±90/±180 range
checks do not catch a swap inside the continental US (both values are in
range either way). A routing bug of exactly this shape once shipped. With a
named object the mistake becomes a wrong key instead of an invisible
argument-order slip. A unit test holds a `@ts-expect-error` on a positional
call; if `of` is ever reverted to positional args, the directive reports
"unused" and the build fails.

The same longitude/latitude order risk exists at the persistence edge
(GeoJSON is `[longitude, latitude]`) and in SQL (`ST_MakePoint(lng, lat)`);
see [database.md#geography-columns](database.md#geography-columns).

Source: [spec 01, Decisions › “Layering and contracts” (Coordinates.of() takes an object)](../specs/01-foundation.md#decisions);
[spec 02, Decisions › “Selection query”](../specs/02-fulfilment-core.md#decisions).

## Money

Code: `src/domain/value-objects/money.ts` → `Money`

Money is **integer cents plus a currency code**. There is no floating-point
money anywhere; every amount is a whole number of cents, matching the
`bigint` money columns in the schema.

Amounts are a JS `number`, not `bigint`. This system deals in USD retail
order totals, nowhere near `Number.MAX_SAFE_INTEGER` cents (about $90
trillion), so integer `number` arithmetic is exact. `bigint` would add
friction (no native JSON support, different operators) for no real safety
gain at this scale. The database side converts `bigint` columns to `number`
to match; see [database.md#bigint-money](database.md#bigint-money).

`Money.of(amountCents, currency = 'USD')`: USD is the default because the
system is USD-only.

## Shipping address

Code: `src/domain/value-objects/shipping-address.ts` → `ShippingAddress`

Matches the `shippingAddress` field of the `POST /orders` request and the
`orders.shipping_address` jsonb snapshot column (same field names,
camelCase throughout).

It is a **snapshot frozen when the order is created**: the order stores a
copy, not a reference to the customer's address, so editing a customer
profile later never rewrites a past order.

Field format rules (for example "is this a valid US state code") belong to
the request DTO ([orders-saga.md#validation](orders-saga.md#validation)).
This value object only guards that the fields the domain depends on are
present.

Source: [data-model.dbml, `orders` note](../engineering:documentation/data-model.dbml).
