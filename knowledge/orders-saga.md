# Orders: the creation saga, idempotency, errors and the read side

`POST /orders` runs a three-phase saga (reserve, charge, settle) behind an
`Idempotency-Key`. `GET /orders` and `GET /orders/:id` are the read side.

Main sources: [spec 05](../specs/05-order-creation-saga.md) (written in
Spanish), [spec 06](../specs/06-read-side.md), the settlement and error-body
fixes in [spec 07](../specs/07-hardening-demo.md), and the
transactional-integrity and idempotency requirements in
[architectural-requirements.md](../engineering:documentation/architectural-requirements.md).

## Saga phases

Code:
- `src/application/orders/create-order.use-case.ts` → `CreateOrderUseCase`, `CreateOrderUseCase.reserveOrder`, `CreateOrderUseCase.chargeOrder`, `CreateOrderUseCase.settleOrder`, `ReserveOrderResult`, `ChargeOrderResult`, `CreateOrderResult`
- `src/application/orders/create-order.types.ts` → `CreateOrderCommand`

`execute()` reads as the saga's table of contents: resolve customer and
products, reserve, charge, settle. Each phase keeps its own decisions in
its own private method. Splitting by phase is an allowed exception to the
"services keep their logic in the method body" rule, because the phases
are named units the spec already defines
([references/coding-conventions.md](../references/coding-conventions.md)).

`CreateOrderCommand` is built once by the controller from the validated DTO
and passed through all three phases. `cardNumber` and `idempotencyKey` are
unused by phase 1 but travel with the command anyway.

**Phase 1, reserve** (`reserveOrder`):
- Geocode the shipping address **before** `AllocateInventoryUseCase` runs,
  never inside `onBeforeReserve`. No network call may happen inside the
  reservation transaction; this rule is as strict as the one for the
  payment call.
- Generate the `order_number` once, before the failover loop
  ([Order number](#order-number)).
- `AllocateInventoryUseCase`'s `onBeforeReserve` inserts the `orders` row
  (`PENDING_PAYMENT`) and the `order_items` rows (with price snapshots) in
  the same short transaction as the reservation
  ([allocation.md#failover-loop](allocation.md#failover-loop)).
- Result (`ReserveOrderResult`): the persisted `order`/`items` domain
  objects, plus the winning warehouse's name and distance (`allocation`)
  for the 201 response.

**Phase 2, charge** (`chargeOrder`):
- **No transaction may be open while `charge()` is in flight.**
- The charge idempotency key is written to the `payments` row **before**
  calling `charge()`, so reconciliation later reads it back from the row
  instead of rebuilding it.
- `settled_at` is set only for a definitive outcome
  ([Settlement](#settlement)).
- Result (`ChargeOrderResult`): the persisted `payments` row and the
  gateway's raw outcome.

**Phase 3, settle** (`settleOrder`): see [Settlement](#settlement).

`CreateOrderResult` is what `execute()` returns on the only path that
returns normally, `CAPTURED`. `DECLINED` and `UNKNOWN` throw
(`PaymentDeclinedError` / `PaymentProviderUnavailableError`) after phase 3
has already settled the order and inventory.

Source: [spec 05, Scope and Risks](../specs/05-order-creation-saga.md#risks).

## Settlement

Code:
- `src/application/orders/order-settlement.service.ts` → `OrderSettlementService`, `OrderSettlementService.settle`, `OrderSettlementService.confirmCaptured`, `OrderSettlementService.failDeclined`, `OrderSettlementService.cancelUnpaid`, `PaymentResolution`
- `src/application/orders/create-order.use-case.ts` → `isDefinitiveOutcome`, `CreateOrderUseCase.settleOrder`, `CreateOrderUseCase.chargeOrder`

`OrderSettlementService` is the **single implementation of "settle this
order"**, shared by the saga's phase 3, the reservation reaper and payment
reconciliation. Without it, three code paths would each re-implement the
same transition / inventory / event sequence, and the saga's in-memory
`Order` could overwrite a `CANCELLED` that the reaper wrote in between.

Outcomes:

| Method | When | Inventory | Order |
|---|---|---|---|
| `confirmCaptured` | `CAPTURED` | commit | `PENDING_PAYMENT -> PAID -> CONFIRMED`, publishes `order.confirmed` in the same transaction |
| `failDeclined` | `DECLINED` | release | `PENDING_PAYMENT -> PAYMENT_FAILED` |
| `cancelUnpaid(reason)` | never charged | release | `PENDING_PAYMENT -> CANCELLED` |

Each method delegates the shared steps to the private `settle`:

1. open a transaction and lock the order row with raw SQL
   (`SELECT id FROM orders WHERE id = $1 FOR UPDATE`). Raw SQL because this
   is concurrency-critical; the read-back after it goes through the ORM as
   usual, protected by the lock held for the rest of the transaction;
2. if the order is no longer `PENDING_PAYMENT`, return `ALREADY_SETTLED`
   and change nothing;
3. if a `PaymentResolution` was passed, update the `payments` row;
4. run the caller's own transition (the part that differs between
   confirm / fail / cancel stays in each public method, not hidden in
   `settle`).

The status `UPDATE` is also raw SQL with a `WHERE status IN (...)` guard,
which is what stops it overwriting a row a concurrent settler already
finished. The row lock is what makes two settlers racing on the same order
resolve to exactly one winner. A conditional `UPDATE` alone was considered
and rejected (spec 07, Decisions).

`PaymentResolution` is passed by the jobs (reaper, reconciliation). The
saga's phase 3 does not pass it, because phase 2 already wrote the
`payments` row.

**Saga phase 3** branches on the charge outcome:
- `CAPTURED` → `confirmCaptured`; `DECLINED` → `failDeclined`, then throw
  `PaymentDeclinedError`;
- `UNKNOWN` → leave the order `PENDING_PAYMENT` with the reservation intact
  and throw `PaymentProviderUnavailableError`; reconciliation or the reaper
  decides later.

**`settled_at`**: `isDefinitiveOutcome` is true only for `CAPTURED` and
`DECLINED`, the two statuses that mean the provider gave a final answer.
Only then is `payments.settled_at` set. Reconciliation finds the payments it
must resolve with `settled_at IS NULL`; setting it for every outcome would
hide exactly those rows.

Jobs that call this service select candidates in a short transaction and
let the service re-lock and re-check each order
([messaging-jobs.md#settlement-locking](messaging-jobs.md#settlement-locking)).

Source: [spec 07, “Saga — payments.settled_at”, “OrderSettlementService” and Decisions](../specs/07-hardening-demo.md#decisions).

## Charge idempotency key

Code:
- `src/application/orders/charge-idempotency-key.ts` → `buildChargeIdempotencyKey`
- `src/application/orders/create-order.use-case.ts` → `FIRST_PAYMENT_ATTEMPT`

`buildChargeIdempotencyKey` produces the value passed as
`ChargeCommand.idempotencyKey`. It is derived from the order id plus an
attempt number, so a retry of the same charge can never double-charge
([http-payments.md#port](http-payments.md#port)). It is a pure function with
no infrastructure dependency.

`attempt` is always `1` today (`FIRST_PAYMENT_ATTEMPT`): a second charge
attempt for the same order is out of scope.

Source: [spec 05, Charge idempotency key](../specs/05-order-creation-saga.md#charge-idempotency-key);
[spec 03, Decisions › “Card data and the idempotency key”](../specs/03-external-adapters.md#decisions).

## Order number

Code:
- `src/application/orders/helpers/order-number.helpers.ts` → `generateOrderNumber`
- `src/application/orders/create-order.use-case.ts` → `CreateOrderUseCase.reserveOrder`

Format `CNL-<year>-<6 digits>`, backed by the global Postgres sequence
`order_number_seq` (one counter, no per-year reset; see
[database.md#migrations](database.md#migrations)). The format is assembled
at generation time, not stored in the sequence.

It is generated **once**, before the failover loop, and reused on every
retry, for the same reason as the allocation `orderId`: a failed attempt
rolls back fully, and the value stays stable
([allocation.md#failover-loop](allocation.md#failover-loop)).

Source: [spec 05, “Nueva migración — secuencia de order_number” and Decisions](../specs/05-order-creation-saga.md#decisions).

## Idempotency

Code:
- `src/application/orders/create-order-idempotent.service.ts` → `CreateOrderIdempotentService`, `CreateOrderIdempotentService.assertValidIdempotencyKey`, `CreateOrderIdempotentService.beginIdempotentRequest`, `CreateOrderIdempotentService.runAndRecord`
- `src/application/orders/idempotency.repository.ts` → `SCOPE`, `IDEMPOTENCY_KEY_TTL_HOURS`, `computeRequestFingerprint`, `insertInProgress`, `findActiveByKey`, `markCompleted`
- `src/application/orders/idempotency.types.ts` → `IdempotencyCheckResult`

`CreateOrderIdempotentService` wraps the saga with `Idempotency-Key`
handling. The use case knows nothing about request idempotency (only
orders, payments and inventory), and the controller stays a thin HTTP
adapter.

Flow:

1. **Validate the header** (`assertValidIdempotencyKey`): a missing or
   malformed `Idempotency-Key` (must be a UUID) is a 400.
2. **Insert first** (`beginIdempotentRequest` → `insertInProgress`): insert
   an `IN_PROGRESS` row under the unique `(scope, idempotency_key)`
   constraint, **before any other work begins**. This is its own
   autocommit statement, never inside the reservation transaction, so the
   unique constraint is what serialises duplicate requests. The unique
   violation is allowed to propagate; the returned row id is used later to
   mark the row `COMPLETED`.
3. **On conflict** (unique violation), look up the existing row with
   `findActiveByKey` and decide, in this order (`IdempotencyCheckResult`):
   - same key, **different body** (fingerprint mismatch) → 422, whatever
     the row's state;
   - still `IN_PROGRESS` → 409;
   - `COMPLETED` → **replay the stored response verbatim**: never a second
     order, never a second charge.

   Edge case: a row past `expires_at` that has not been deleted still blocks
   the insert, but `findActiveByKey` returns `null` for it, so the original
   unique-violation error is rethrown (an unhandled 500). What to do with
   expired-but-unreaped rows was left open by the spec's Risks table. The
   code comment in `beginIdempotentRequest` says the blocking row is used
   "regardless of whether findActiveByKey still considers it active"; the
   code does not do that.
4. **Run and record** (`runAndRecord`): run the saga and mark the key
   `COMPLETED` for **any** final outcome, success or typed error alike
   (`markCompleted`). There is no "failed but retryable" state. It reuses
   `buildProblem()` from the problem-details filter, so the stored body is
   exactly what the client receives.
   - A 402 and a 502 are only thrown after the order row exists, so
     `idempotency_keys.order_id` is recorded for both. A replay can then
     point to the order even though only the 502 body carries `orderId`.

Details:
- `SCOPE`: every row this saga writes shares one scope (also the column
  default).
- `IDEMPOTENCY_KEY_TTL_HOURS = 24`, a named constant. `findActiveByKey`
  returns `null` for "no row" and for a row past `expires_at`: an expired
  key counts as absent. Deleting expired rows is not done here.
- `computeRequestFingerprint`: sha256 of the body with keys sorted and no
  whitespace, so field order never changes the fingerprint.

Source: [spec 05, “Idempotencia”, Decisions and Risks](../specs/05-order-creation-saga.md#idempotencia-idempotency);
idempotency requirement in [architectural-requirements.md](../engineering:documentation/architectural-requirements.md).

## Errors

Code:
- `src/application/orders/create-order.errors.ts` → `CustomerNotFoundError`, `ProductNotFoundError`, `PaymentOutcomeErrorParams`, `PaymentDeclinedError`, `PaymentProviderUnavailableError`

| Error | Raised when | Status |
|---|---|---|
| `CustomerNotFoundError` | `customerId` does not resolve to a customer | 404 |
| `ProductNotFoundError` | one or more `productId`s missing **or inactive** (same 404 either way) | 404 |
| `GeocodingFailedError` | the shipping address cannot be geocoded; see [geocoding.md#errors](geocoding.md#errors) | 422 |
| `NoFulfilmentPossibleError` | see [allocation.md#errors](allocation.md#errors) | 422 / 409 |
| `PaymentDeclinedError` | charge `DECLINED`. Terminal: the order is already `PAYMENT_FAILED` and stock released | 402 |
| `PaymentProviderUnavailableError` | charge `UNKNOWN` (timeout, connection refused, circuit open). The order stays `PENDING_PAYMENT` with its reservation intact | 502 |

Both payment errors are raised only after the order row exists, so both
carry its id (`PaymentOutcomeErrorParams`). The 402 body does not expose
`orderId` (a 402 is terminal; the client posts a new order), but the id is
still recorded in `idempotency_keys.order_id`. Only the 502 body carries
it ([Error contract](#error-contract)).

Source: [spec 05, “Comando interno y errores nuevos” and Decisions](../specs/05-order-creation-saga.md#decisions);
[spec 07, “Fix C — 502 body”](../specs/07-hardening-demo.md#fix-c--502-body).

## Error contract

Code:
- `src/infrastructure/http/filters/problem-details.filter.ts` → `ProblemDetailsFilter`, `ProblemDetails`, `ProblemShape`, `buildProblem`, `WHITELIST_VIOLATION_PATTERN`, `extractValidationErrors`, `ExposedHttpError`

Every error response uses one **RFC 9457** problem-details envelope.

- `correlationId` always comes from `AsyncLocalStorage`
  (`CorrelationMiddleware` sets it before any handler runs); it is never
  generated here, so it always matches the request's trace
  ([observability.md#correlation](observability.md#correlation)).
- Unhandled exceptions (500) are logged with their full stack. The logger
  redacts every logged object, so a card number cannot reach a log line
  this way ([observability.md#redaction](observability.md#redaction)).
- `buildProblem` maps every outcome of the saga to its status (table in
  [Errors](#errors)). `type` values are `urn:problem-type:*` identifiers:
  RFC 9457 only requires a URI reference that identifies the problem type,
  and there is no documentation site to point real URLs at.
- One error class, two statuses: `NoFulfilmentPossibleError.reason` picks
  422 (`NO_CANDIDATES`) or 409 (`RESERVATION_RACE_LOST`).
- The 502 body carries `orderId` as an RFC 9457 extension member (only on
  the 502). It tells the client to **poll the order** instead of re-posting
  with a new `Idempotency-Key`, which could charge twice.
- `ProblemShape` / `buildProblem` are exported so the idempotency service
  stores exactly the status and body the client receives.
- **Body-parser errors**: a limit error such as 413 (body over `BODY_LIMIT`)
  is thrown by Express middleware before Nest's pipeline. It is shaped like
  the `http-errors` package's output (a `status` plus `expose: true`,
  meaning safe to show the client), not an `HttpException`.
  `ExposedHttpError` describes that shape and the filter maps it.
- **Validation messages**: Nest's global `ValidationPipe` formats each
  message as `<dot.path> <constraint text>`, even for nested properties,
  because it prepends the parent path into the message string itself
  (`prependConstraintsWithParentProp` in `@nestjs/common`).
  `extractValidationErrors` splits on the first space to recover the path,
  which avoids a custom `exceptionFactory` in `main.ts`. The one exception is
  class-validator's whitelist message, the fixed sentence
  `property <name> should not exist`, where the field name is the *second*
  word; `WHITELIST_VIOLATION_PATTERN` handles it.

Unit tests cover one case per mapping row
([testing.md#http-tests](testing.md#http-tests)).

Source: [spec 05, “Respuesta 201 y envelope de error”](../specs/05-order-creation-saga.md#respuesta-201-y-envelope-de-error);
[spec 07, Decisions and “Fix C — 502 body”](../specs/07-hardening-demo.md#fix-c--502-body);
error-contract requirement in [architectural-requirements.md](../engineering:documentation/architectural-requirements.md).

## Validation

Code: `src/infrastructure/http/dto/create-order.dto.ts` → `SUPPORTED_COUNTRY`, `CARD_NUMBER_PATTERN`, `OrderLineDto.productId`, `UniqueProductIds`

- `SUPPORTED_COUNTRY = 'US'`: the only supported market.
- `CARD_NUMBER_PATTERN`: shape only, 13 to 19 digits. The payment provider
  decides the real outcome from the exact number.
- `UniqueProductIds`: `items[]` must not repeat a `productId`. A repeat is
  rejected with 400, never merged.
- UUID fields use `@IsUUID('loose')`: any 8-4-4-4-12 hex shape, not only
  RFC 4122 version/variant nibbles. Real ids come from
  `gen_random_uuid()` (always valid v4), but the fixed seed and harness ids
  (`a0000000-…`, `b0000000-…` in the seed, `d0000000-…` in
  concurrency-check, `e0000000-…` in events-check) are readable, non-v4
  strings. The strict default would reject them and make `POST /orders`
  impossible to exercise against the seed data. `GetOrderService` uses the
  same `'loose'` rule for `:id`.

Source: [spec 05, “DTOs de request” and Decisions](../specs/05-order-creation-saga.md#decisions).

## HTTP API

Code:
- `src/infrastructure/http/controllers/orders.controller.ts` → `OrdersController`, `OrdersController.create`
- `src/infrastructure/http/dto/order-response.dto.ts` → `OrderResponse`, `toOrderResponse`, `WarehouseAllocationInfo`
- `src/infrastructure/http/dto/helpers/distance-format.helper.ts` → `formatDistance`
- `src/infrastructure/http/dto/helpers/money-format.helper.ts` → `formatCentsAsDollars`

- `OrdersController` (`POST /orders`) is a thin HTTP adapter. All
  `Idempotency-Key` orchestration, including which status and body to
  answer with, lives in `CreateOrderIdempotentService`.
- Response types (`OrderResponse`, `ProblemDetails`) are plain interfaces
  with no runtime metadata for the Swagger CLI plugin, so each outcome is
  documented with an `@ApiResponse` description
  ([architecture.md#http-hardening](architecture.md#http-hardening)).
- `OrderResponse` is the 201 body. `toOrderResponse` shows which warehouse
  was chosen and why (its name and distance), so a reviewer can see it
  without opening psql.
- `WarehouseAllocationInfo` is the raw allocation result (meters only), as
  `AllocateInventoryUseCase` returns it, before projection.
- `formatDistance`: km and miles rounded to 2 decimals, meters kept at
  source precision. `formatCentsAsDollars`: cents to dollars with
  `toFixed(2)`, no other rounding decision.

Source: [spec 05, “Respuesta 201 y envelope de error”](../specs/05-order-creation-saga.md#respuesta-201-y-envelope-de-error).

## Read side

Code:
- `src/infrastructure/http/controllers/orders-read.controller.ts` → `OrdersReadController`, `OrdersReadController.list`
- `src/application/orders/list-orders.service.ts` → `ListOrdersService`, `ListOrdersService.decodeCursorOrThrow`
- `src/application/orders/get-order.service.ts` → `GetOrderService`
- `src/application/orders/helpers/cursor.helpers.ts` → `encodeCursor`, `InvalidCursorError`
- `src/application/orders/order-read.errors.ts` → `OrderNotFoundError`
- `src/infrastructure/database/repositories/orders-read.repository.ts` → `OrdersReadRepository.findPage`, `OrdersReadRepository.findItemsByOrderIds`, `OrdersReadRepository.findOrderById`
- `src/infrastructure/http/dto/order-list.response.dto.ts` → `toOrderListItem`
- `src/infrastructure/http/dto/order-detail.response.dto.ts` → `toOrderDetailResponse`

**Routing.** `OrdersReadController` serves `GET /orders` and
`GET /orders/:id`. It is a separate file from the `POST` controller; both
use the `orders` prefix without collision (`@Get()` is exactly `orders`,
`@Get(':id')` is `orders/:id`).

**Local validation pipe.** `list` uses its own
`ValidationPipe({ transform: true, … })` so `pageSize` arrives as a
`number`. Adding `transform: true` to the global pipe would risk changing
how `CreateOrderDto` coerces its fields.

**Keyset pagination** (`GET /orders`):
- The cursor is `base64("<createdAt ISO>|<id>")` (`encodeCursor`). Not JSON:
  clients only echo it back, never parse it. `createdAt` carries
  microseconds ([Cursor precision](#cursor-precision)).
- A cursor this module did not produce raises `InvalidCursorError`;
  `decodeCursorOrThrow` rethrows it as `BadRequestException`, the same 400
  bucket as any invalid query parameter, with no new problem type.
- `findPage` builds the `WHERE` clause from parameterised fragments in
  TypeScript, not a static `.sql` file, because the filters are optional and
  combinable. The cursor condition is a real Postgres row comparison,
  `(created_at, id) < (…)`, not two `OR` branches, so `created_at` ties
  resolve correctly by `id`.
- It queries `LIMIT pageSize + 1`. `ListOrdersService` uses the extra
  lookahead row to compute `hasMore` without a `COUNT(*)`, and builds
  `nextCursor` from the last **retained** row, never the lookahead.
- `findItemsByOrderIds` loads items for the whole page in one query
  (`WHERE order_id = ANY($1::uuid[])`), grouped by order in the service. The
  explicit `::uuid[]` cast keeps the SQL valid for an empty page.
- The base-case listing must use `idx_orders_keyset`; an EXPLAIN test
  checks it ([testing.md#explain-tests](testing.md#explain-tests)).

**Detail** (`GET /orders/:id`, `GetOrderService`):
- A `:id` that is not UUID-shaped behaves exactly like an unknown id: both
  throw `OrderNotFoundError` (404), there is no separate 400, and a
  malformed id never reaches the database. The check is `'loose'` for the
  same reason as the DTO ([Validation](#validation)).
- The order, its items (`findItemsByOrderIds`) and the other lookups are
  independent and run in parallel.
- `findOrderById` uses `LEFT JOIN warehouses`: `warehouse_id` is nullable in
  the schema and the read side must not rely on the saga always filling it.
  A null `warehouse_id` still returns the order, with `warehouse_name` and
  `distance_meters` null.

**Projections.** `toOrderListItem` and `toOrderDetailResponse` build the
response field by field, never by spreading a row, so a column added later
cannot leak by accident. The detail projection deliberately leaves out
`card_last4`, `card_brand`, `provider_payment_id`, `idempotency_key` and
`raw_response`.

Source: [spec 06, Data model and Decisions](../specs/06-read-side.md#decisions).

## Cursor precision

Code:
- `src/application/orders/helpers/cursor.helpers.ts` → `OrderCursor`, `encodeCursor`, `decodeCursor`
- `src/infrastructure/database/repositories/orders-read.repository.ts` → `OrderPageRow`, `OrdersReadRepository.findPage`

`created_at` is `timestamptz`, stored with microseconds; a JS `Date` holds
only milliseconds. The cursor used to be built from `row.created_at`
(`toISOString()`), so `…05.132167` became `…05.132`. The next page's
`(created_at, id) < ('…05.132', id)` then excluded every remaining row at
`…05.132167`, whatever its `id`, because that timestamp is *greater* than
the truncated one. Rows were silently skipped, never duplicated.

It showed on real data: `created_at` defaults to `now()`, which always has
microseconds and is constant inside a transaction, so a batch insert
produces many rows with the same instant. A page boundary inside such a
group lost the rest of the group (found with 25 rows at one instant and
`pageSize=100`: the walk returned 1667 of 1687 orders).

Fix: `findPage` also selects `created_at` formatted by Postgres
(`to_char(... AT TIME ZONE 'UTC', '…SS.US"Z"')`) as `cursor_created_at`.
The cursor carries that string, never a `Date`, and the comparison casts it
back with `::timestamptz`. `decodeCursor` still rejects an unparseable date
but returns the string untouched. Millisecond cursors issued before the fix
still decode and work. Changing the column to `timestamptz(3)` was rejected:
a schema migration for a read-side concern.

Regression test: `orders-read.repository.integration.spec.ts`, "does not
skip rows when a page boundary splits a group sharing a sub-millisecond
created_at".
