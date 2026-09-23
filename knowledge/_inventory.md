# Comment inventory

Input for (1) the agent writing `knowledge/*.md` and (2) the agents trimming code comments. Scope: every `.ts`/`.js`/`.mjs` file under `src/` (incl. `*.spec.ts`), `test/`, `scripts/`, `payments-mock/src/`.

Listed: every comment block that is ≥ 3 lines, or mentions a spec/phase/requirement ID (`SPEC 04`, `P4`, `R0.6`, `FR-9`, `step N`, …), or is a JSDoc on an exported symbol, plus every `eslint-disable` / `@ts-*` directive. Short one-line comments with no IDs are not listed and should be left alone. "Phase 1/2/3" when it means the *saga* phases (reserve/charge/settle) is domain vocabulary, not a spec ID, and stays.

## How to use this file

- **Entry ID** (`C-###`) is stable and only exists to refer to entries. It is **not** a line number; find a block by `file` + `symbol` + the verbatim original.
- **Action**:
  - **KEEP**: an invariant, safety warning or non-obvious why that stays in code. It may be tightened (spec/phase IDs removed) to the replacement text when one is given. `(unchanged)` means leave it byte-for-byte.
  - **SHORTEN**: code keeps the 1–3 line *why* given as the replacement. The full original is quoted here, so knowledge writers can still use it.
  - **MOVE**: the full text goes into `knowledge/<topic>.md#<anchor>`. Code keeps the replacement one-liner, which points there.
  - **DROP**: narration of obvious code, pure spec duplicate or test boilerplate. Delete it (replacement `(none)`). If knowledge needs the content, it is covered once under the named anchor.
- **Knowledge target**: `knowledge/<topic>.md#<anchor>`. The knowledge writer should create each anchor that at least one MOVE/SHORTEN/DROP entry points to, merging all entries for that anchor. Spec/phase/requirement IDs must **not** be copied into knowledge; write the idea in plain English.
- **Spec duplicate**: where the same reasoning already exists in `specs/*.md` or `engineering:documentation/*.md`. “Decisions › “X”” means the bold group heading inside that spec's `## Decisions`. `specs/05` is written in Spanish.
- **MUST-KEEP**: must survive trimming (may be tightened, never removed): tracing import order, the DB pool size, transaction/lock rules, redaction guarantees, and directives.

## Summary

**413 blocks**: KEEP 153 · SHORTEN 216 · MOVE 26 · DROP 18.

### Per topic

| Topic | KEEP | SHORTEN | MOVE | DROP | Total |
|---|---:|---:|---:|---:|---:|
| architecture | 8 | 15 | 1 | 0 | 24 |
| domain | 12 | 8 | 1 | 0 | 21 |
| allocation | 10 | 15 | 1 | 1 | 27 |
| orders-saga | 23 | 49 | 1 | 1 | 74 |
| messaging-jobs | 16 | 23 | 5 | 0 | 44 |
| observability | 24 | 11 | 2 | 1 | 38 |
| http-payments | 16 | 15 | 2 | 0 | 33 |
| database | 12 | 30 | 1 | 0 | 43 |
| geocoding | 5 | 10 | 0 | 1 | 16 |
| testing | 18 | 29 | 2 | 14 | 63 |
| scripts | 9 | 10 | 4 | 0 | 23 |
| investigations | 0 | 1 | 6 | 0 | 7 |

### Per file

| File | KEEP | SHORTEN | MOVE | DROP | Total |
|---|---:|---:|---:|---:|---:|
| `payments-mock/src/card.ts` | 1 | 0 | 0 | 0 | 1 |
| `payments-mock/src/charge.service.ts` | 1 | 2 | 1 | 0 | 4 |
| `payments-mock/src/constants.ts` | 1 | 2 | 0 | 0 | 3 |
| `payments-mock/src/hash.ts` | 1 | 0 | 0 | 0 | 1 |
| `payments-mock/src/main.ts` | 1 | 0 | 0 | 0 | 1 |
| `payments-mock/src/server.spec.ts` | 1 | 0 | 0 | 0 | 1 |
| `payments-mock/src/server.ts` | 0 | 1 | 0 | 0 | 1 |
| `payments-mock/src/types.ts` | 3 | 0 | 0 | 0 | 3 |
| `scripts/concurrency-check.ts` | 1 | 1 | 0 | 0 | 2 |
| `scripts/concurrency-e2e.ts` | 0 | 1 | 1 | 0 | 2 |
| `scripts/demo/harness.ts` | 6 | 2 | 1 | 0 | 9 |
| `scripts/demo/index.ts` | 0 | 0 | 2 | 0 | 2 |
| `scripts/demo/scenarios.ts` | 2 | 2 | 0 | 0 | 4 |
| `scripts/events-check.ts` | 0 | 3 | 1 | 0 | 4 |
| `scripts/payments-check.ts` | 0 | 1 | 1 | 0 | 2 |
| `src/application/allocation/allocate-inventory.use-case.integration.spec.ts` | 1 | 2 | 0 | 1 | 4 |
| `src/application/allocation/allocate-inventory.use-case.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/application/allocation/allocation.types.ts` | 0 | 4 | 0 | 0 | 4 |
| `src/application/allocation/errors.ts` | 0 | 3 | 0 | 0 | 3 |
| `src/application/allocation/helpers/inventory.helpers.ts` | 4 | 0 | 0 | 1 | 5 |
| `src/application/allocation/inventory.service.integration.spec.ts` | 0 | 1 | 0 | 1 | 2 |
| `src/application/allocation/inventory.service.ts` | 4 | 2 | 0 | 0 | 6 |
| `src/application/jobs/analytics-record.handler.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/jobs/customer-notify.handler.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/jobs/helpers/shipment-mock.helpers.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/application/jobs/helpers/tracing.helper.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/application/jobs/job-handler.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/application/jobs/payment-reconciliation.handler.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/application/jobs/payment-reconciliation.handler.ts` | 3 | 1 | 1 | 0 | 5 |
| `src/application/jobs/reservation-reaper.handler.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/application/jobs/reservation-reaper.handler.ts` | 4 | 0 | 1 | 0 | 5 |
| `src/application/jobs/shipment-create.handler.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/application/jobs/shipment-create.handler.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/jobs/shipment.service.ts` | 0 | 0 | 2 | 0 | 2 |
| `src/application/orders/charge-idempotency-key.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/create-order-idempotent.service.integration.spec.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/create-order-idempotent.service.ts` | 1 | 6 | 0 | 0 | 7 |
| `src/application/orders/create-order.errors.ts` | 0 | 5 | 0 | 0 | 5 |
| `src/application/orders/create-order.types.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/create-order.use-case.integration.spec.ts` | 1 | 3 | 0 | 1 | 5 |
| `src/application/orders/create-order.use-case.ts` | 7 | 6 | 0 | 0 | 13 |
| `src/application/orders/get-order.service.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/application/orders/get-order.service.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/helpers/cursor.helpers.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/application/orders/helpers/order-number.helpers.integration.spec.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/helpers/order-number.helpers.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/idempotency.repository.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/application/orders/idempotency.repository.ts` | 1 | 4 | 0 | 1 | 6 |
| `src/application/orders/idempotency.types.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/list-orders.service.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/application/orders/order-read.errors.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/order-settlement.service.integration.spec.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/application/orders/order-settlement.service.ts` | 4 | 0 | 1 | 0 | 5 |
| `src/domain/entities/order-item.ts` | 2 | 0 | 0 | 0 | 2 |
| `src/domain/entities/order-status.transitions.spec.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/domain/entities/order-status.transitions.ts` | 1 | 0 | 1 | 0 | 2 |
| `src/domain/entities/order.spec.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/domain/entities/order.ts` | 2 | 3 | 0 | 0 | 5 |
| `src/domain/enum-types/order-status.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/domain/enum-types/payment-status.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/domain/enum-types/product-condition.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/domain/enum-types/shipment-status.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/domain/ports/event-publisher.ts` | 1 | 2 | 1 | 0 | 4 |
| `src/domain/ports/geocoding-errors.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/domain/ports/geocoding-provider.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/domain/ports/payment-failure-codes.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/domain/ports/payment-gateway.ts` | 2 | 4 | 0 | 0 | 6 |
| `src/domain/value-objects/coordinates.spec.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/domain/value-objects/coordinates.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/domain/value-objects/money.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/domain/value-objects/shipping-address.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/config/config.module.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/config/env.schema.ts` | 1 | 3 | 0 | 0 | 4 |
| `src/infrastructure/database/data-source.integration.spec.ts` | 1 | 0 | 0 | 1 | 2 |
| `src/infrastructure/database/data-source.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/infrastructure/database/entities/customer.orm-entity.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/database/entities/idempotency-key.orm-entity.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/database/entities/inventory-movement.orm-entity.ts` | 2 | 1 | 0 | 0 | 3 |
| `src/infrastructure/database/entities/inventory.orm-entity.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/database/entities/order-item.orm-entity.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/database/entities/order.orm-entity.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/database/entities/payment.orm-entity.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/database/entities/product.orm-entity.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/database/entities/shipment.orm-entity.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/database/entities/warehouse.orm-entity.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/database/interfaces/geo-point.ts` | 0 | 0 | 1 | 0 | 1 |
| `src/infrastructure/database/mappers/order.mapper.integration.spec.ts` | 1 | 1 | 0 | 1 | 3 |
| `src/infrastructure/database/mappers/order.mapper.ts` | 3 | 2 | 0 | 0 | 5 |
| `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` | 3 | 5 | 0 | 0 | 8 |
| `src/infrastructure/database/migrations/1790028652771-OrderNumberSequence.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/database/persistence-entities.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/database/repositories/orders-read.explain.integration.spec.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/infrastructure/database/repositories/orders-read.repository.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/infrastructure/database/repositories/orders-read.repository.ts` | 0 | 3 | 0 | 0 | 3 |
| `src/infrastructure/database/repositories/warehouse-selection.explain.integration.spec.ts` | 1 | 1 | 1 | 0 | 3 |
| `src/infrastructure/database/repositories/warehouse-selection.repository.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/infrastructure/database/repositories/warehouse-selection.repository.ts` | 1 | 3 | 0 | 0 | 4 |
| `src/infrastructure/database/seed.ts` | 1 | 3 | 0 | 0 | 4 |
| `src/infrastructure/database/transformers/bigint-number.transformer.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/database/verify-ledger.integration.spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `src/infrastructure/database/verify-schema.ts` | 0 | 3 | 0 | 0 | 3 |
| `src/infrastructure/geocoding/caching-geocoding.provider.spec.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/geocoding/caching-geocoding.provider.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/geocoding/geoapify-geocoding.provider.spec.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/geocoding/geoapify-geocoding.provider.ts` | 1 | 2 | 0 | 0 | 3 |
| `src/infrastructure/geocoding/normalisation.ts` | 2 | 2 | 0 | 0 | 4 |
| `src/infrastructure/geocoding/static-geocoding.provider.ts` | 3 | 1 | 0 | 0 | 4 |
| `src/infrastructure/geocoding/us-cities.ts` | 0 | 1 | 0 | 1 | 2 |
| `src/infrastructure/health/health.controller.ts` | 0 | 0 | 1 | 0 | 1 |
| `src/infrastructure/health/pg-boss.health-indicator.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/health/worker-healthcheck.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/infrastructure/health/worker-readiness.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/http/circuit-breaker.ts` | 2 | 0 | 1 | 0 | 3 |
| `src/infrastructure/http/controllers/orders-read.controller.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/http/controllers/orders.controller.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/http/dto/create-order.dto.spec.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/http/dto/create-order.dto.ts` | 1 | 3 | 0 | 0 | 4 |
| `src/infrastructure/http/dto/helpers/distance-format.helper.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/http/dto/helpers/money-format.helper.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/http/dto/list-orders-query.dto.spec.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/http/dto/order-detail.response.dto.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/http/dto/order-list.response.dto.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/http/dto/order-response.dto.ts` | 1 | 2 | 0 | 0 | 3 |
| `src/infrastructure/http/fetch-errors.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/infrastructure/http/filters/problem-details.filter.spec.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/http/filters/problem-details.filter.ts` | 4 | 6 | 0 | 0 | 10 |
| `src/infrastructure/http/redaction.ts` | 3 | 0 | 0 | 0 | 3 |
| `src/infrastructure/http/retry.ts` | 1 | 1 | 0 | 0 | 2 |
| `src/infrastructure/logging/pino.config.ts` | 3 | 1 | 1 | 0 | 5 |
| `src/infrastructure/messaging/correlation-and-tracing.integration.spec.ts` | 1 | 3 | 0 | 0 | 4 |
| `src/infrastructure/messaging/event-routing.ts` | 1 | 2 | 0 | 0 | 3 |
| `src/infrastructure/messaging/job-envelope.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/messaging/job-runner.integration.spec.ts` | 3 | 5 | 2 | 0 | 10 |
| `src/infrastructure/messaging/job-runner.ts` | 3 | 3 | 2 | 0 | 8 |
| `src/infrastructure/messaging/pg-boss-event-publisher.integration.spec.ts` | 0 | 1 | 1 | 0 | 2 |
| `src/infrastructure/messaging/pg-boss-event-publisher.spec.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/messaging/pg-boss-event-publisher.ts` | 3 | 1 | 0 | 0 | 4 |
| `src/infrastructure/messaging/pg-boss-shutdown.hook.ts` | 1 | 0 | 0 | 0 | 1 |
| `src/infrastructure/messaging/pg-boss.provider.ts` | 2 | 3 | 0 | 0 | 5 |
| `src/infrastructure/messaging/queue-setup.ts` | 0 | 5 | 0 | 0 | 5 |
| `src/infrastructure/observability/correlation.middleware.ts` | 0 | 1 | 0 | 1 | 2 |
| `src/infrastructure/observability/correlation.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/observability/dlq-gauge.integration.spec.ts` | 0 | 2 | 0 | 0 | 2 |
| `src/infrastructure/observability/dlq-gauge.ts` | 0 | 0 | 1 | 0 | 1 |
| `src/infrastructure/observability/redacting-span-exporter.ts` | 2 | 0 | 0 | 0 | 2 |
| `src/infrastructure/observability/tracing.ts` | 3 | 2 | 0 | 0 | 5 |
| `src/infrastructure/payments/card.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/infrastructure/payments/http-payment-gateway.spec.ts` | 2 | 0 | 0 | 0 | 2 |
| `src/infrastructure/payments/http-payment-gateway.ts` | 2 | 2 | 0 | 0 | 4 |
| `src/main.ts` | 6 | 6 | 0 | 0 | 12 |
| `src/main.worker.ts` | 4 | 2 | 0 | 0 | 6 |
| `src/modules/api.module.ts` | 0 | 1 | 0 | 0 | 1 |
| `src/modules/shared.module.ts` | 4 | 0 | 1 | 0 | 5 |
| `src/modules/worker.module.ts` | 0 | 1 | 0 | 0 | 1 |
| `test/app.e2e-spec.ts` | 0 | 0 | 0 | 1 | 1 |
| `test/hardening.e2e-spec.ts` | 1 | 1 | 0 | 0 | 2 |
| `test/orders-read.e2e-spec.ts` | 0 | 2 | 0 | 0 | 2 |
| `test/orders.e2e-spec.ts` | 0 | 3 | 0 | 0 | 3 |

## MUST-KEEP confirmation

| Entry | File | Symbol | Why |
|---|---|---|---|
| C-009 | `payments-mock/src/main.ts` | `(module)` | eslint-disable / @ts-* directive — never touched |
| C-015 | `scripts/concurrency-check.ts` | `DEFAULT_N` | DB pool size (spec 02 Decisions › Verification requires it) |
| C-054 | `src/application/allocation/helpers/inventory.helpers.ts` | `lockInventoryRows` | transaction/lock rule |
| C-061 | `src/application/allocation/inventory.service.ts` | `InventoryService` | transaction/lock rule |
| C-062 | `src/application/allocation/inventory.service.ts` | `InventoryService.reserve` | transaction/lock rule |
| C-064 | `src/application/allocation/inventory.service.ts` | `InventoryService > release` | transaction/lock rule |
| C-065 | `src/application/allocation/inventory.service.ts` | `InventoryService > commit` | transaction/lock rule |
| C-077 | `src/application/jobs/payment-reconciliation.handler.ts` | `selectUnsettledPayments` | transaction/lock rule |
| C-083 | `src/application/jobs/reservation-reaper.handler.ts` | `selectExpiredReservations` | transaction/lock rule |
| C-120 | `src/application/orders/create-order.use-case.ts` | `CreateOrderUseCase.reserveOrder` | transaction/lock rule |
| C-122 | `src/application/orders/create-order.use-case.ts` | `CreateOrderUseCase > chargeOrder` | transaction/lock rule |
| C-136 | `src/application/orders/idempotency.repository.ts` | `insertInProgress` | transaction/lock rule |
| C-146 | `src/application/orders/order-settlement.service.ts` | `OrderSettlementService > settle` | transaction/lock rule |
| C-147 | `src/application/orders/order-settlement.service.ts` | `OrderSettlementService.settle` | transaction/lock rule |
| C-148 | `src/application/orders/order-settlement.service.ts` | `OrderSettlementService.settle` | transaction/lock rule |
| C-154 | `src/domain/entities/order.spec.ts` | `describe('Order status transitions').it('does not compile when assigning to statu')` | eslint-disable / @ts-* directive — never touched |
| C-180 | `src/domain/value-objects/coordinates.spec.ts` | `describe('Coordinates').it('does not compile with positional latitud')` | eslint-disable / @ts-* directive — never touched |
| C-201 | `src/infrastructure/database/entities/inventory.orm-entity.ts` | `InventoryOrmEntity` | transaction/lock rule |
| C-224 | `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` | `InitialSchema1789596059697.up` | transaction/lock rule |
| C-226 | `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` | `InitialSchema1789596059697.up` | transaction/lock rule |
| C-267 | `src/infrastructure/geocoding/static-geocoding.provider.ts` | `StaticGeocodingProvider > geocode` | eslint-disable / @ts-* directive — never touched |
| C-274 | `src/infrastructure/health/worker-healthcheck.ts` | `main` | eslint-disable / @ts-* directive — never touched |
| C-308 | `src/infrastructure/http/filters/problem-details.filter.ts` | `ProblemDetailsFilter` | redaction guarantee |
| C-309 | `src/infrastructure/http/redaction.ts` | `(module)` | redaction guarantee |
| C-310 | `src/infrastructure/http/redaction.ts` | `CARD_NUMBER_VALUE_PATTERN` | redaction guarantee |
| C-311 | `src/infrastructure/http/redaction.ts` | `redactError` | redaction guarantee |
| C-315 | `src/infrastructure/logging/pino.config.ts` | `pinoOptions` | redaction guarantee |
| C-318 | `src/infrastructure/logging/pino.config.ts` | `pinoOptions.hooks` | redaction guarantee |
| C-339 | `src/infrastructure/messaging/job-runner.ts` | `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | transaction/lock rule |
| C-343 | `src/infrastructure/messaging/job-runner.ts` | `JobRunner.start` | redaction guarantee |
| C-370 | `src/infrastructure/observability/redacting-span-exporter.ts` | `RedactingSpanExporter` | redaction guarantee |
| C-371 | `src/infrastructure/observability/redacting-span-exporter.ts` | `redactSpan` | redaction guarantee |
| C-373 | `src/infrastructure/observability/tracing.ts` | `isWorker` | tracing import order (spec 04 Risks) |
| C-384 | `src/main.ts` | `(module)` | tracing import order (spec 04 Risks) |
| C-388 | `src/main.ts` | `bootstrap` | redaction guarantee |
| C-395 | `src/main.ts` | `bootstrap` | eslint-disable / @ts-* directive — never touched |
| C-396 | `src/main.worker.ts` | `(module)` | tracing import order (spec 04 Risks) |
| C-398 | `src/main.worker.ts` | `bootstrap` | redaction guarantee |
| C-401 | `src/main.worker.ts` | `bootstrap` | eslint-disable / @ts-* directive — never touched |
| C-404 | `src/modules/shared.module.ts` | `SharedModule.register.imports` | redaction guarantee |

### Directives (never touched)

- C-009 `payments-mock/src/main.ts` › `(module)`: `// eslint-disable-next-line no-console -- payments-mock has no card data reaching this line, and no redacting logger of its own (it is a standalone mock, not part of the main app).`
- C-154 `src/domain/entities/order.spec.ts` › `describe('Order status transitions').it('does not compile when assigning to statu')`: `// @ts-expect-error status is read-only via getStatus(); it is not a settable property.`
- C-180 `src/domain/value-objects/coordinates.spec.ts` › `describe('Coordinates').it('does not compile with positional latitud')`: `// @ts-expect-error Coordinates.of takes one { latitude, longitude } object, not positional args.`
- C-267 `src/infrastructure/geocoding/static-geocoding.provider.ts` › `StaticGeocodingProvider > geocode`: `// eslint-disable-next-line @typescript-eslint/require-await`
- C-274 `src/infrastructure/health/worker-healthcheck.ts` › `main`: `// eslint-disable-next-line no-console -- Docker HEALTHCHECK output; this bare script has no pino logger.`
- C-395 `src/main.ts` › `bootstrap`: `// eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.`
- C-401 `src/main.worker.ts` › `bootstrap`: `// eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.`

## Flagged for a decision

- C-177 `PaymentGateway` JSDoc names `MockPaymentGateway`, which does not exist (the adapter is `HttpPaymentGateway`). The replacement fixes it.
- C-390 (`main.ts`) says "no DTOs to validate yet", C-327 (`JobMeta.traceparent`) says "before step 7 lands tracing, always null", and C-302 calls `main.ts` "already-frozen". All three are out of date, and the replacements drop those parts.
- C-089 (`ShipmentService`): shipments start `DISPATCHED` with mock carrier data. This deviation from spec 04 is recorded **only** in this comment and in no spec. It is MOVEd so the knowledge docs keep it.
- C-088 / C-336: the NOT NULL-before-FK psql proof is kept once, under `investigations#not-null-before-fk`.
- Integration-test prerequisite headers (14 DROPs → `testing#integration-prereqs`): `references/testing.md` does not list the required env vars (`DATABASE_URL`, `PAYMENTS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`). The knowledge doc must state them once, or these should be SHORTENed instead.
- C-247 (`seed.ts` PRODUCTS) points to "the commit message" for price sources. It is KEEP, but that pointer is weak.

---

## architecture

### `src/domain/ports/event-publisher.ts`

#### C-168 · `EVENT_PUBLISHER` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/architecture.md#ports`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** DI token — EventPublisher is an interface and has no runtime value to key on. */
~~~~

### `src/domain/ports/geocoding-provider.ts`

#### C-171 · `GEOCODING_PROVIDER` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/architecture.md#ports`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** DI token — GeocodingProvider is an interface and has no runtime value to key on. */
~~~~

### `src/domain/ports/payment-gateway.ts`

#### C-178 · `PAYMENT_GATEWAY` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/architecture.md#ports`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** DI token — PaymentGateway is an interface and has no runtime value to key on. */
~~~~

### `src/infrastructure/config/config.module.ts`

#### C-185 · `ConfigModule` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#configuration`
- **Replacement:** Typed ConfigService<AppConfig> instead of process.env. validate runs once at boot; a throw aborts before any provider exists.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Configuration and validation”
- **Original:**

~~~~ts
/**
 * Wraps @nestjs/config so every provider in the app — api or worker — can
 * inject a typed `ConfigService<AppConfig>` instead of reading
 * `process.env` directly. `validate` runs once, synchronously, during
 * `NestFactory.create()`/`createApplicationContext()`; a thrown error there
 * aborts boot before any other provider is instantiated.
 */
~~~~

#### C-186 · `ConfigModule > envFilePath` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#configuration`
- **Replacement:** Loads a local .env if present; in Docker, compose injects the environment directly.
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Loads a local .env if one exists (dev convenience — copy
      // .env.example to .env and fill it in) and silently no-ops when it
      // doesn't. Docker never has one: docker-compose injects
      // `environment:` directly into process.env, which validate() reads
      // either way.
~~~~

### `src/infrastructure/config/env.schema.ts`

#### C-187 · `envSchema` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#configuration`
- **Replacement:** All config comes from env and is validated at boot: refuse to start on bad config instead of failing on first use.
- **Spec duplicate:** `specs/01-foundation.md` › Configuration schema
- **Original:**

~~~~ts
/**
 * R0.3 — every configuration value the app needs comes from the process
 * environment and is validated against this schema at boot. The app must
 * refuse to start on invalid config rather than failing later on first use
 * (e.g. a bad DATABASE_URL surfacing only when the first query runs).
 */
~~~~

#### C-188 · `envSchema` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#configuration`
- **Replacement:** Changes per deployment, so an env var. Comma-separated.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening; `references/coding-conventions.md`
- **Original:**

~~~~ts
    // SPEC 07 R6.6: an allowed CORS origin is exactly the kind of value an
    // operator changes per deployment, so it is an env var, not a
    // constant (references/coding-conventions.md). Comma-separated;
    // split/trimmed into the array main.ts's enableCors() needs.
~~~~

#### C-190 · `validateEnv` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#configuration`
- **Replacement:** Throws during bootstrap so the app never reaches a half-started state.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Validates the raw process environment against {@link envSchema}.
 *
 * Called from `ConfigModule.forRoot({ validate })` (see config.module.ts),
 * which NestJS invokes synchronously during `NestFactory.create()`. Throwing
 * here aborts the bootstrap promise before any controller, repository or
 * queue connection is created — the app never reaches a half-started state.
 */
~~~~

### `src/main.ts`

#### C-385 · `BODY_LIMIT` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/architecture.md#http-hardening`
- **Replacement:** Not tuned per deployment, so a constant.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening
- **Original:**

~~~~ts
/** SPEC 07 R6.6 — a value nobody tunes per deployment, so a constant, not an env var (references/coding-conventions.md). */
~~~~

#### C-386 · `DOCS_PATH_PREFIX` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/architecture.md#http-hardening`
- **Replacement:** Helmet's default CSP blocks Swagger UI's inline assets; relaxed for /docs only.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening; `specs/07-hardening-demo.md` › Risks
- **Original:**

~~~~ts
/** SPEC 07 R6.6, Risks: Helmet's default CSP blocks Swagger UI's inline assets — relaxed for `/docs` only, not globally. */
~~~~

#### C-387 · `bootstrap > app` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#bootstrap`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // abortOnError: false — without it, Nest's own bootstrap exception zone
  // catches a thrown `validate` error (see env.schema.ts), logs its own
  // stack trace and calls process.exit(1) itself, before the promise below
  // ever rejects. Disabling it means every bootstrap failure, config or
  // otherwise, is reported the same deliberate way below.
  // bufferLogs: true — Nest's own bootstrap logs (module init, route
  // mapping) are held until useLogger() below installs the redacting
  // pino logger, instead of going to Nest's default console logger first.
~~~~

#### C-389 · `bootstrap` · **KEEP**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/architecture.md#bootstrap`
- **Replacement:** enableShutdownHooks: without it SIGTERM skips PgBossShutdownHook and the api's pg-boss pool leaks.
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // Without this, SIGTERM kills the process directly and
  // PgBossShutdownHook.onApplicationShutdown() never runs — the api's own
  // pg-boss pool (and its internal timers) would leak instead of closing
  // (SPEC 04 step 9 finding — surfaced by this file's e2e test never
  // exiting cleanly).
~~~~

#### C-390 · `bootstrap` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/architecture.md#bootstrap`
- **Replacement:** Global ValidationPipe (whitelist + forbidNonWhitelisted). (Current text says "no DTOs yet" — stale.)
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Configuration and validation”
- **Original:**

~~~~ts
  // R0.1: global ValidationPipe, no DTOs to validate yet — P4 only writes
  // DTOs, this file does not change again for that.
~~~~

#### C-391 · `bootstrap > defaultHelmet` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#http-hardening`
- **Replacement:** /docs gets Helmet without CSP (Swagger inline assets); every other route keeps the full policy.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening
- **Original:**

~~~~ts
  // SPEC 07 R6.6 — HTTP hardening. `/docs` gets Helmet's other headers
  // but no CSP — Swagger UI's inline assets would otherwise be blocked
  // (Risks) — every other route keeps the full default policy.
~~~~

#### C-392 · `bootstrap` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#bootstrap`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // Registered before listen()/init() so the express adapter's own
  // default json parser (same middleware name, "jsonParser") is never
  // added on top of this one — this becomes the only json body parser.
~~~~

#### C-393 · `bootstrap > openApiDocument` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#http-hardening`
- **Replacement:** OpenAPI at /docs: request DTOs via the CLI plugin; response types are interfaces, documented with @ApiResponse.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening
- **Original:**

~~~~ts
  // SPEC 07 R6.6 — OpenAPI at /docs. The request DTOs (CreateOrderDto,
  // ListOrdersQueryDto) are introspected by the CLI plugin
  // (nest-cli.json); the response DTOs are plain interfaces with no
  // runtime metadata, so each route documents its outcomes with
  // @ApiResponse descriptions instead of a generated schema.
~~~~

#### C-394 · `bootstrap` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#configuration`
- **Replacement:** Invalid config throws during create(); caught here so the process exits non-zero with the reason.
- **Spec duplicate:** `specs/01-foundation.md` › Configuration schema
- **Original:**

~~~~ts
// R0.3: the app refuses to start on invalid config rather than failing
// later. ConfigModule's `validate` (env.schema.ts) throws during
// NestFactory.create() on a bad or missing variable; caught here so the
// process exits non-zero with the reason instead of an unhandled rejection.
~~~~

### `src/main.worker.ts`

#### C-397 · `bootstrap > app` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#bootstrap`
- **Replacement:** createApplicationContext(): the full DI graph without an HTTP listener. bufferLogs: see main.ts.
- **Spec duplicate:** `engineering:documentation/infrastructure.md` › 3. One repo, two entrypoints
- **Original:**

~~~~ts
  // createApplicationContext(), not create(): boots the entire DI graph —
  // every provider, repository and database connection — without starting
  // an HTTP listener (infrastructure.md §3). No app.listen() here.
  // bufferLogs: true — see main.ts.
~~~~

#### C-400 · `bootstrap` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#bootstrap`
- **Replacement:** The open pg-boss/TypeORM pools keep the process alive.
- **Spec duplicate:** `engineering:documentation/infrastructure.md` › 3. One repo, two entrypoints
- **Original:**

~~~~ts
  // boss.work() per queue (infrastructure.md §3's `main.worker.ts`
  // example). The open pg-boss/TypeORM pools keep the process alive from
  // here; nothing else holds the event loop open.
~~~~

### `src/modules/api.module.ts`

#### C-402 · `RATE_LIMIT_PER_MINUTE` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/architecture.md#http-hardening`
- **Replacement:** 600/min/IP covers the concurrency-e2e burst; a constant, not env. Exported so that script can refuse a larger N.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening
- **Original:**

~~~~ts
/** SPEC 07 R6.6 — 600/min/IP comfortably covers R6.3's burst (N + 20 = 70 by default); a named constant, not an env var (references/coding-conventions.md). Exported so scripts/concurrency-e2e.ts can refuse an N whose burst would exceed it. */
~~~~

### `src/modules/shared.module.ts`

#### C-403 · `SharedModule` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#shared-module`
- **Replacement:**
  > The shared DI graph (config, TypeORM, pg-boss, all ports), imported by both ApiModule and WorkerModule. register(role) only changes the PgBoss instance.
  > See knowledge/architecture.md#shared-module
- **Spec duplicate:** `engineering:documentation/infrastructure.md` › 3. One repo, two entrypoints; `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * infrastructure.md §3: "config, TypeORM, pg-boss, all ports — THE SHARED
 * PART". Both ApiModule and WorkerModule import this and nothing else for
 * their infrastructure needs, so the api and the worker share one DI graph
 * shape even though they boot through different entrypoints.
 *
 * P0 wires all three port tokens now so the graph is closed from day one —
 * P2/P3 swap a `useValue` stub for a real `useClass` adapter, they do not
 * add a new provider to this frozen module (specs/01-foundation.md,
 * Decisions).
 *
 * `register(role)` (SPEC 04 step 2): the only thing that differs between
 * the api's and the worker's copy of this module is which `PgBoss`
 * instance they get — everything else stays identical, so the DI graph
 * shape ApiModule/WorkerModule's comment promises still holds. `role` is a
 * structural fact of which entrypoint is booting, not an operator-tunable
 * value, so it is a constructor argument here rather than a new
 * `env.schema.ts` entry (references/coding-conventions.md).
 */
~~~~

#### C-406 · `SharedModule.register.providers.useFactory` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/architecture.md#adapter-selection`
- **Replacement:** The adapter is chosen once here from env — no driver checks anywhere else.
- **Spec duplicate:** —
- **Original:**

~~~~ts
            // R2.7 (phases/02-external-adapters.md): the active adapter is
            // chosen once, here, from the environment variable — no
            // `if (driver === ...)` anywhere else in application code.
~~~~

#### C-407 · `requireGeoapifyApiKey` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/architecture.md#adapter-selection`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * env.schema.ts's Zod refinement already refuses to boot when
 * GEOCODING_DRIVER=geoapify and GEOAPIFY_API_KEY is unset — this is a
 * defensive fallback, never reachable through normal configuration.
 */
~~~~

### `src/modules/worker.module.ts`

#### C-408 · `WorkerModule` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/architecture.md#worker-module`
- **Replacement:** SharedModule + job handlers. JOB_HANDLERS is a multi-provider array so JobRunner stays at 3 constructor parameters.
- **Spec duplicate:** `engineering:documentation/infrastructure.md` › 3. One repo, two entrypoints; `references/coding-conventions.md`
- **Original:**

~~~~ts
/**
 * SharedModule + job handlers (infrastructure.md §3). main.worker.ts's
 * entrypoint (`await app.get(JobRunner).start()`). `JOB_HANDLERS` is a
 * multi-provider array so `JobRunner` stays at 3 constructor parameters
 * (references/coding-conventions.md) instead of one per handler.
 */
~~~~

## domain

### `src/domain/entities/order-item.ts`

#### C-149 · `OrderItem` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/domain.md#order-item`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes) (order_items note)
- **Original:**

~~~~ts
/**
 * Mirrors an `order_items` row. Resolves the N:M between orders and
 * products, and freezes the price and product identity at purchase time
 * (data-model.dbml note).
 */
~~~~

#### C-150 · `OrderItem > getLineTotal` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/domain.md#order-item`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
  /**
   * quantity * unitPrice, exact in integer cent arithmetic. Deliberately
   * not a stored column (data-model.dbml) — always derived.
   */
~~~~

### `src/domain/entities/order-status.transitions.spec.ts`

#### C-151 · `describe('order status transitions').describe('terminal states reject every outgoing tr') > it('rejects PAYMENT_FAILED -> CANCELLED spec')` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/domain.md#order-state-machine`
- **Replacement:** The diagram's PAYMENT_FAILED → CANCELLED arrow is ruled out (see ORDER_TRANSITIONS).
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
    // The exact ambiguity resolved in order-status.transitions.ts's own
    // comment: architectural-requirements.md's diagram draws an arrow from
    // PAYMENT_FAILED to CANCELLED, but three other passages of the same
    // document treat PAYMENT_FAILED as terminal. This is the transition
    // that decision rules out.
~~~~

### `src/domain/entities/order-status.transitions.ts`

#### C-152 · `ORDER_TRANSITIONS` · **MOVE**

- **Category:** spec-ref, rationale, invariant
- **Knowledge target:** `knowledge/domain.md#order-state-machine`
- **Replacement:**
  > PENDING_PAYMENT → PAID → CONFIRMED; PENDING_PAYMENT → PAYMENT_FAILED | CANCELLED.
  > PAYMENT_FAILED and CANCELLED are terminal. See knowledge/domain.md#order-state-machine
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts ("PAYMENT_FAILED and CANCELLED both terminal")”
- **Original:**

~~~~ts
/**
 * R0.5 (frozen contract): the order state machine, as one readable
 * transition table, from architectural-requirements.md's diagram and FR-5
 * phase 3's settle outcomes:
 *
 *   PENDING_PAYMENT -> PAID -> CONFIRMED
 *   PENDING_PAYMENT -> PAYMENT_FAILED
 *   PENDING_PAYMENT -> CANCELLED (reservation expired)
 *
 * PAYMENT_FAILED and CANCELLED are both terminal, with no transition
 * between them — despite the ASCII diagram in architectural-requirements.md
 * drawing an arrow from PAYMENT_FAILED to CANCELLED. Three independent
 * passages of that same document disagree with that arrow: the
 * order_status enum's own note calls PAYMENT_FAILED terminal, FR-5 phase 3
 * lists exactly three settle outcomes with nothing past PAYMENT_FAILED, and
 * the reservation reaper / reconciliation job only ever act on orders still
 * PENDING_PAYMENT. Read the diagram's arrow as a layout artifact, not a
 * fourth transition — flagged when this was implemented (step 4/5), no
 * objection raised.
 */
~~~~

#### C-153 · `assertValidOrderTransition` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/domain.md#order-state-machine`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Throws if `from -> to` is not one of the edges in ORDER_TRANSITIONS. */
~~~~

### `src/domain/entities/order.spec.ts`

#### C-154 · `describe('Order status transitions').it('does not compile when assigning to statu')` · **KEEP** · **MUST-KEEP**

- **Category:** rationale, invariant
- **Knowledge target:** `knowledge/domain.md#order-entity`
- **Replacement:** (unchanged) (directive + its explanation — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Order has no public status property, only getStatus() — a direct assignment is
    // a compile error (TS2339: no such property), not merely a bad runtime value. If
    // a future edit ever adds a public `status` field, the directive below starts
    // reporting "unused" and this test fails loudly instead of silently passing.
    // @ts-expect-error status is read-only via getStatus(); it is not a settable property.
~~~~

### `src/domain/entities/order.ts`

#### C-155 · `OrderProps > total` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/domain.md#order-entity`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  /**
   * Authoritative amount charged. The DB stores `currency` and
   * `total_cents` as separate columns; here they are one Money value —
   * carrying currency on the amount avoids the two ever disagreeing.
   */
~~~~

#### C-156 · `Order` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/domain.md#order-entity`
- **Replacement:** status is getter-only (assigning it doesn't compile). Change it only through the named methods, which check ORDER_TRANSITIONS.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * Mirrors an `orders` row. R0.5 (frozen contract): `status` is exposed as a
 * getter only — there is no public `status` property, so
 * `order.status = 'CONFIRMED'` fails to compile (TS2339: no such property).
 * The only way to change it is through the named methods below, each of
 * which checks order-status.transitions.ts before mutating.
 */
~~~~

#### C-157 · `Order > markPaid` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/domain.md#order-state-machine`
- **Replacement:** PENDING_PAYMENT → PAID: the provider captured the charge.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
  /** PENDING_PAYMENT -> PAID. FR-5 phase 3, approved: the payment provider captured the charge. */
~~~~

#### C-158 · `Order > markPaymentFailed` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/domain.md#order-state-machine`
- **Replacement:** PENDING_PAYMENT → PAYMENT_FAILED. The caller has already released the reservation.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
  /**
   * PENDING_PAYMENT -> PAYMENT_FAILED. FR-5 phase 3, declined: the
   * reservation has already been released by the caller (Inventory.release,
   * outside this entity — that is a repository/use-case concern, not this
   * one order's).
   */
~~~~

#### C-159 · `Order > confirm` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/domain.md#order-state-machine`
- **Replacement:** PAID → CONFIRMED: the reservation is committed and the order.confirmed event fires.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
  /** PAID -> CONFIRMED. FR-5 phase 3: the reservation is committed for good and the order.confirmed outbox event fires. */
~~~~

### `src/domain/enum-types/order-status.ts`

#### C-160 · `OrderStatus` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/domain.md#enums`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
/**
 * Mirrors the `order_status` Postgres enum (data-model.dbml). The allowed
 * transitions between these values are defined separately in
 * order-status.transitions.ts, not here — this file is just the value set.
 */
~~~~

### `src/domain/enum-types/payment-status.ts`

#### C-161 · `PaymentStatus` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/domain.md#enums`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
/** Mirrors the `payment_status` Postgres enum (data-model.dbml). */
~~~~

#### C-162 · `PaymentStatus` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/domain.md#enums`
- **Replacement:** Provider timeout; resolved later by the reconciliation job.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
  // Provider timeout. Resolved by the reconciliation job (FR-5).
~~~~

### `src/domain/enum-types/product-condition.ts`

#### C-163 · `ProductCondition` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/domain.md#enums`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
/**
 * Mirrors the `product_condition` Postgres enum (data-model.dbml). Lives on
 * the product, not on inventory: a refurbished iPhone is a distinct SKU at
 * a distinct price, not the same product in a different state.
 */
~~~~

### `src/domain/enum-types/shipment-status.ts`

#### C-164 · `ShipmentStatus` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/domain.md#enums`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
/** Mirrors the `shipment_status` Postgres enum (data-model.dbml). */
~~~~

### `src/domain/value-objects/coordinates.spec.ts`

#### C-180 · `describe('Coordinates').it('does not compile with positional latitud')` · **KEEP** · **MUST-KEEP**

- **Category:** rationale, invariant
- **Knowledge target:** `knowledge/domain.md#coordinates`
- **Replacement:** (unchanged) (directive + its explanation — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // A routing bug this exact shape once shipped silently: Coordinates.of(lng, lat)
    // compiles fine when both parameters are plain `number`, because a swapped pair
    // still lands in range for both fields within the continental US. The named-object
    // signature turns that into a type error instead of a silent wrong location. If a
    // future edit reverts Coordinates.of to positional args, the directive below starts
    // reporting "unused" instead — a loud compile failure, not a silent regression.
    // @ts-expect-error Coordinates.of takes one { latitude, longitude } object, not positional args.
~~~~

### `src/domain/value-objects/coordinates.ts`

#### C-181 · `Coordinates` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/domain.md#coordinates`
- **Replacement:** A geodetic point. No distance method on purpose: ranking is PostGIS's job in the selection query; a JS version would diverge.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Selection query”
- **Original:**

~~~~ts
/**
 * R0.5 (frozen contract): a geodetic point. Backs `warehouses.location` and
 * `orders.shipping_location` (both `geography(Point,4326)`), and is what
 * `GeocodingProvider.geocode()` returns.
 *
 * Deliberately has no distance method: FR-2 computes distance ranking in a
 * single SQL query (`location <-> :shippingPoint`, PostGIS geodesic
 * distance, index-assisted by the GiST index) — that is a database
 * responsibility, not a domain one, and reimplementing it in JS would give
 * a second, divergent notion of "distance."
 */
~~~~

#### C-182 · `Coordinates > of` · **KEEP**

- **Category:** rationale, invariant
- **Knowledge target:** `knowledge/domain.md#coordinates`
- **Replacement:** (unchanged)
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts (Coordinates.of() takes an object)”
- **Original:**

~~~~ts
  /**
   * Takes one named-property object, not positional (latitude, longitude)
   * arguments. Both are plain `number`, so positional args let
   * `Coordinates.of(lng, lat)` compile silently — the ±90/±180 range checks
   * below do not catch a swap within the continental US, since both values
   * land in range for both fields either way. A named object forces the
   * caller to label each value: the mistake becomes a wrong key, not an
   * invisible argument-order slip.
   */
~~~~

### `src/domain/value-objects/money.ts`

#### C-183 · `Money` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/domain.md#money`
- **Replacement:** Integer cents + currency; never floats. A plain number (not bigint) stays exact far beyond any realistic order total.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions (Money noted)
- **Original:**

~~~~ts
/**
 * R0.5 (frozen contract): money as integer cents plus a currency code. No
 * floating-point money anywhere — every amount in this domain is a whole
 * number of cents, matching the `bigint` money columns in the schema.
 *
 * Amounts are kept as a JS `number`, not `bigint`. This system deals in USD
 * order totals for a retail catalogue — nowhere near
 * `Number.MAX_SAFE_INTEGER` cents (~$90 trillion) — so integer `number`
 * arithmetic is exact and avoids bigint's ergonomics (no native JSON
 * support, different operators) for no real safety gain at this scale.
 */
~~~~

### `src/domain/value-objects/shipping-address.ts`

#### C-184 · `ShippingAddress` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/domain.md#shipping-address`
- **Replacement:** Snapshot stored on the order, so editing a customer never rewrites past orders. Field format rules belong to the request DTO; this only guards required fields.
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes) (orders note)
- **Original:**

~~~~ts
/**
 * R0.5 (frozen contract): matches the request shape of `POST /orders`
 * (`shippingAddress`, FR-1) and the `orders.shipping_address` jsonb
 * snapshot column — same field names, camelCase throughout.
 *
 * Frozen the moment an order is created: the order stores this snapshot
 * rather than a reference to the customer's address, so editing a customer
 * profile later never rewrites a past order (data-model.dbml, orders note).
 *
 * Field-level format rules (e.g. "is this a valid US state code") are a
 * request-DTO concern for P4, not this value object's job here in P0 — it
 * only guards that the fields the domain actually depends on are present.
 */
~~~~

## allocation

### `src/application/allocation/allocate-inventory.use-case.ts`

#### C-044 · `AllocateInventoryUseCase` · **SHORTEN**

- **Category:** spec-ref, rationale, invariant
- **Knowledge target:** `knowledge/allocation.md#failover-loop`
- **Replacement:** Selects candidates once, then tries each in its own transaction (a rolled-back transaction can't be retried). The SQL's LIMIT 3 bounds the attempts.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Transaction boundaries and ownership”
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md — R1.3's failover loop. Selects candidates
 * once, then tries each in its own transaction (never a domain-level
 * retry inside `InventoryService` — a rolled-back transaction cannot be
 * retried, so each attempt needs its own, and this is the only component
 * above `reserve` that can open one). `select-warehouse.sql`'s own
 * `LIMIT 3` is what bounds this to "up to 3 attempts" — there is nothing
 * else to cap here.
 */
~~~~

#### C-045 · `AllocateInventoryUseCase.execute` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/allocation.md#failover-loop`
- **Replacement:** Generated once and reused across attempts: a failed attempt rolls back fully, and the id stays stable for whoever tracks it.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Transaction boundaries and ownership”
- **Original:**

~~~~ts
    // Generated once, before the first attempt, and reused across every
    // retry — a failed attempt rolls its whole transaction back, so
    // nothing conflicts, and the id stays stable for whoever is tracking
    // it outside this loop (specs/02-fulfilment-core.md, Decisions).
~~~~

### `src/application/allocation/allocation.types.ts`

#### C-046 · `OrderLine` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/allocation.md#contracts`
- **Replacement:** Types shared by the selection query, InventoryService and AllocateInventoryUseCase. Validating quantity belongs to the request DTO.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › TypeScript contracts
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md — TypeScript contracts shared across the
 * selection query, `InventoryService` and `AllocateInventoryUseCase`.
 * Quantity is a positive integer; validating that belongs to P4's DTO,
 * not here.
 */
~~~~

#### C-047 · `ReserveCommand` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#transaction-ownership`
- **Replacement:** The caller's transaction is the method's first argument, not a field: reserve/release/commit never open their own transaction.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Transaction boundaries and ownership”
- **Original:**

~~~~ts
/**
 * Everything `InventoryService.reserve` needs. `manager` — the caller's
 * transaction — travels as the method's own first argument, not as a
 * field here (specs/02-fulfilment-core.md, Decisions: reserve/release/
 * commit never open a transaction of their own).
 */
~~~~

#### C-048 · `ReleaseCommand` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/allocation.md#ledger`
- **Replacement:** No quantities: release/commit derive the amount from the latest RESERVE movement — the ledger is the source of truth. A `type` because an interface can't drop `lines`.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Ledger and idempotency”
- **Original:**

~~~~ts
/**
 * Everything `InventoryService.release`/`.commit` need — `ReserveCommand`
 * minus `lines`, plus `productIds`. No quantities: both derive the amount
 * to move from the last `RESERVE` movement's `quantity_delta` for each
 * `(order_id, product_id)` — the ledger, not the caller, is the source of
 * truth for how much was reserved (specs/02-fulfilment-core.md,
 * Decisions). `Omit` + intersection, not `interface extends`: an
 * interface can only add fields on top of its base, never drop one
 * (`lines`), so this has to be a `type`.
 */
~~~~

#### C-049 · `OnBeforeReserveParams` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#failover-loop`
- **Replacement:** Runs inside each attempt's transaction before reserve (the saga inserts the order here). orderId is generated once and reused across attempts.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Scope; `specs/02-fulfilment-core.md` › Decisions › “Transaction boundaries and ownership”
- **Original:**

~~~~ts
/**
 * What `AllocateInventoryUseCase`'s `onBeforeReserve` callback gets, run
 * inside each attempt's transaction before `reserve` — P1 inserts a mock
 * order through it, P4 will insert the real one
 * (specs/02-fulfilment-core.md, Scope). `orderId` is generated once by
 * the use case, before the first attempt, and reused across attempts
 * (Decisions: a failed attempt rolls its whole transaction back, so
 * reusing one id across retries is safe, and keeps the id stable for
 * whichever caller — P4's idempotency key — is tracking it outside the
 * failover loop).
 */
~~~~

### `src/application/allocation/errors.ts`

#### C-050 · `InsufficientStockError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/allocation.md#errors`
- **Replacement:** Raised by reserve when stock is insufficient under the lock or lock_timeout fires; the use case moves to the next candidate.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Implementation plan
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md — raised by `InventoryService.reserve` when
 * availability fails under the lock, or when `lock_timeout` fires.
 * `AllocateInventoryUseCase` catches it and moves to the next candidate
 * (R1.3's failover loop).
 */
~~~~

#### C-051 · `NoFulfilmentPossibleReason` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#errors`
- **Replacement:** NO_CANDIDATES: no warehouse qualified at selection. RESERVATION_RACE_LOST: candidates qualified but each lost the stock to a concurrent order first.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions (NoFulfilmentPossibleError reason); `specs/05-order-creation-saga.md` › Extensión de `NoFulfilmentPossibleError`
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md, Decisions — which of the two distinct
 * root causes `AllocateInventoryUseCase` collapsed into one error class
 * (specs/02-fulfilment-core.md originally mapped both to a single `422`;
 * P4 overrides that to restore R4.5's `422`/`409` split):
 *
 * - `NO_CANDIDATES` — the selection query itself returned zero
 *   candidates; no warehouse ever qualified for this order.
 * - `RESERVATION_RACE_LOST` — one or more candidates qualified at
 *   selection time, but every one of them lost the product to a
 *   concurrent order before this order's own attempt could lock it.
 */
~~~~

#### C-052 · `NoFulfilmentPossibleError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/allocation.md#errors`
- **Replacement:** No candidate qualifies, or every attempt failed. Mapped to 422 (NO_CANDIDATES) or 409 (RESERVATION_RACE_LOST).
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md — raised by `AllocateInventoryUseCase` when
 * no candidate warehouse qualifies, or every attempt is exhausted.
 * Carries the unsatisfiable product ids and, per specs/05's override
 * above, which of the two root causes applied — P4's `problem-details.filter.ts`
 * maps `NO_CANDIDATES` to `422` and `RESERVATION_RACE_LOST` to `409`.
 */
~~~~

### `src/application/allocation/helpers/inventory.helpers.ts`

#### C-053 · `LOCK_TIMEOUT` · **DROP**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#locking`
- **Replacement:** (none)
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Locking and concurrency ("the timeout is a named constant")”
- **Original:**

~~~~ts
/** specs/02-fulfilment-core.md, Decisions: a named constant, not an environment variable — adding one would mean touching P0's env.schema.ts/.env.example for a value nobody tunes per deployment. */
~~~~

#### C-054 · `lockInventoryRows` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/allocation.md#locking`
- **Replacement:** SET LOCAL lock_timeout + SELECT … FOR UPDATE ORDER BY product_id, shared by reserve/release/commit. Always lock in product_id order — any other order lets two orders deadlock.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Locking and concurrency”
- **Original:**

~~~~ts
/**
 * `SET LOCAL lock_timeout` + `SELECT ... FOR UPDATE ORDER BY product_id`
 * — the locking discipline shared by `InventoryService.reserve`,
 * `.release` and `.commit`. ORDER BY product_id, not the order the
 * caller's lines arrived in — otherwise two orders touching the same
 * products in reverse order could deadlock each other
 * (specs/02-fulfilment-core.md, Decisions).
 */
~~~~

#### C-055 · `updateInventoryBalances` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/allocation.md#ledger`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Writes one `(warehouse_id, product_id)` row's new balances. */
~~~~

#### C-056 · `insertMovement` · **KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/allocation.md#ledger`
- **Replacement:** Appends to the append-only ledger — never UPDATE or DELETE this table.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Semantics imposed on `inventory` and `inventory_movements`; `references/data-integrity.md`
- **Original:**

~~~~ts
/** Appends one row to the append-only ledger — no `UPDATE`, no `DELETE`, ever, against this table (specs/02-fulfilment-core.md, acceptance criteria). */
~~~~

#### C-057 · `isLockTimeout` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/allocation.md#locking`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** True when `error` is Postgres's `lock_timeout` error (55P03, lock_not_available). */
~~~~

### `src/application/allocation/inventory.service.ts`

#### C-060 · `RESERVATION_TTL_MINUTES` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#reservation-ttl`
- **Replacement:** Also read by the reservation reaper — don't hardcode 15 elsewhere.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Locking and concurrency”
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md, Decisions: a named constant, not an
 * environment variable — adding one would mean touching P0's
 * env.schema.ts and .env.example for a value nobody tunes per
 * deployment. P6's reaper reads this same constant, not a hardcoded 15.
 */
~~~~

#### C-061 · `InventoryService` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/allocation.md#transaction-ownership`
- **Replacement:** Every method takes the caller's EntityManager and never opens its own transaction; AllocateInventoryUseCase owns the boundary and the failover loop.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Transaction boundaries and ownership”
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md — reserve/release/commit all take the
 * caller's `EntityManager` and never open a transaction of their own
 * (Decisions: "Yes: reserve, release and commit all take the caller's
 * EntityManager..."). `AllocateInventoryUseCase` (step 8) owns the
 * transaction boundary and the failover loop.
 */
~~~~

#### C-062 · `InventoryService.reserve` · **KEEP** · **MUST-KEEP**

- **Category:** rationale, invariant
- **Knowledge target:** `knowledge/allocation.md#locking`
- **Replacement:** Re-verify availability under the lock: the candidate came from a query run before this transaction, so stock may have moved.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Transaction boundaries and ownership”
- **Original:**

~~~~ts
    // Re-verify availability under the lock — the candidate came from a
    // selection query run before this transaction opened, so stock may
    // have moved since (specs/02-fulfilment-core.md, R1.3's failover
    // exists exactly for this race).
~~~~

#### C-063 · `InventoryService.reserve` · **SHORTEN**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/allocation.md#ledger`
- **Replacement:** Movements always carry order_id — a row that can't name its order answers none of the ledger's questions.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Ledger and idempotency”
- **Original:**

~~~~ts
      // Append-only ledger: order_id is always populated on rows P1
      // writes (Decisions) — a movement that cannot name its order
      // answers none of the questions the ledger exists for.
~~~~

#### C-064 · `InventoryService > release` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/allocation.md#ledger`
- **Replacement:** Returns each line's reserved stock (amount from its RESERVE movement). Idempotent: no-op when the line's latest movement is already RELEASE or COMMIT ("any RELEASE exists" would miss release-after-commit).
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Ledger and idempotency”
- **Original:**

~~~~ts
  /**
   * Returns the reservation's stock, per line: `quantity_available` up,
   * `quantity_reserved` down, by the amount that line's `RESERVE`
   * movement originally moved. Idempotent: no-ops a line whose latest
   * movement is already `RELEASE` or `COMMIT` (specs/02-fulfilment-core.md,
   * Decisions — checking only "any RELEASE exists" would miss the
   * release-after-commit case).
   */
~~~~

#### C-065 · `InventoryService > commit` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/allocation.md#ledger`
- **Replacement:** Ends the reservation without touching quantity_available (units left the pool at reserve). Idempotent, same latest-movement rule as release.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Ledger and idempotency”
- **Original:**

~~~~ts
  /**
   * Ends the reservation, per line, without touching
   * `quantity_available` — the units left the available pool when they
   * were reserved; confirming the sale only ends the reservation
   * (specs/02-fulfilment-core.md, Decisions). Idempotent, same rule as
   * `release`: no-ops a line whose latest movement is already `RELEASE`
   * or `COMMIT`.
   */
~~~~

### `src/infrastructure/database/entities/inventory.orm-entity.ts`

#### C-201 · `InventoryOrmEntity` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/allocation.md#locking`
- **Replacement:** Concurrency hot path. Correctness lives in SELECT … FOR UPDATE (plain, blocking — never SKIP LOCKED) and the non-negative CHECK constraints, not in this class.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Locking and concurrency”
- **Original:**

~~~~ts
/**
 * Mirrors `inventory` (migration, step 8) — the concurrency hot path. No
 * domain mirror (R0.5): correctness depends on `SELECT ... FOR UPDATE`
 * (plain, blocking — never `SKIP LOCKED`; a row locked by a concurrent
 * reservation is contention to wait out, not stock to report as absent,
 * see `InventoryService.reserve`, specs/02-fulfilment-core.md Decisions),
 * so an in-memory `reserve()` would be a lie about where the real
 * guarantee lives. `quantity_available >= 0` and `quantity_reserved >= 0`
 * are enforced by the CHECK constraints created in the migration, not by
 * this class.
 */
~~~~

### `src/infrastructure/database/repositories/warehouse-selection.explain.integration.spec.ts`

#### C-237 · `describe('select-warehouse.sql query plan (integra')` · **MOVE**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/allocation.md#selection-query-plan`
- **Replacement:**
  > EXPLAIN assertion for select-warehouse.sql, run inside a rolled-back transaction. The planner uses the documented fallback, not a GiST index scan.
  > See knowledge/allocation.md#selection-query-plan
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Verification ("Captured (step 4)")”; `README.md` › The selection query and its captured plan
- **Original:**

~~~~ts
/**
 * R1.2's EXPLAIN assertion. Runs inside its own transaction — several
 * hundred synthetic warehouses and the ANALYZE that follows both roll
 * back with it, so this test leaves nothing behind for the rest of the
 * suite. Integration test — same prerequisites as the sibling
 * warehouse-selection.repository.integration.spec.ts.
 *
 * specs/02-fulfilment-core.md, step 4: capture what the planner actually
 * does with the inventory/product join present, assert on that captured
 * shape, and record the plan + reason in the spec's Decisions if it
 * deviates from an Index Scan using idx_warehouses_location_gist. It
 * does deviate here — see below and the spec's Decisions section for the
 * full captured plan.
 */
~~~~

#### C-239 · `describe('select-warehouse.sql query plan (integra').it('either drives the ORDER BY off idx_wareh')` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#selection-query-plan`
- **Replacement:** Fallback plan: eligible CTE first, warehouses via primary key for that small set, sorted directly — never a seq scan of all 500.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Verification”; `specs/02-fulfilment-core.md` › Risks
- **Original:**

~~~~ts
        // The documented fallback (spec Decisions / Risks): the eligible
        // CTE is computed first, `warehouses` is reached only through
        // its primary key for the (small) eligible set, and that small
        // set is sorted directly — never a sequential scan of all 500.
~~~~

### `src/infrastructure/database/repositories/warehouse-selection.repository.ts`

#### C-241 · `WarehouseCandidate` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/allocation.md#selection-query`
- **Replacement:** One row per candidate, as select-warehouse.sql returns it; nothing re-checks what the query guarantees.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Scope
- **Original:**

~~~~ts
/**
 * One row per candidate warehouse, as select-warehouse.sql returns it.
 * Nothing else (specs/02-fulfilment-core.md, Scope) — no domain service
 * re-checks what the query already guarantees.
 */
~~~~

#### C-242 · `SELECT_WAREHOUSE_SQL` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/allocation.md#selection-query`
- **Replacement:** Loaded once at module init; the statement never changes per order.
- **Spec duplicate:** —
- **Original:**

~~~~ts
// Loaded once at module init, not per call — the statement text never
// changes per order size (R1.1), so there is nothing to rebuild.
~~~~

#### C-243 · `WarehouseSelectionRepository` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/allocation.md#selection-query`
- **Replacement:** The whole warehouse-selection rule lives in select-warehouse.sql; this class only loads it, binds parameters and maps rows.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Selection query”
- **Original:**

~~~~ts
/**
 * Executes select-warehouse.sql — the whole of FR-2's warehouse-selection
 * rule lives in that statement (specs/02-fulfilment-core.md, Decisions:
 * "no domain service for warehouse selection"). This class only loads the
 * file, binds the three parameters and maps rows; it does not re-rank or
 * re-filter anything the SQL already decided.
 */
~~~~

#### C-244 · `WarehouseSelectionRepository.findCandidates` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/allocation.md#selection-query`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // ST_MakePoint/geography text input both take (longitude, latitude) —
    // see coordinates.ts's own guard against the reversed-pair mistake.
    // geography's default SRID is 4326, so plain WKT needs no explicit SRID.
~~~~

## orders-saga

### `src/application/orders/charge-idempotency-key.ts`

#### C-090 · `buildChargeIdempotencyKey` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#charge-idempotency-key`
- **Replacement:** Value passed as ChargeCommand.idempotencyKey. `attempt` is always 1 today (a second charge attempt is out of scope).
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Card data and the idempotency key”; `specs/05-order-creation-saga.md` › Charge idempotency key
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — the value passed as
 * `ChargeCommand.idempotencyKey` (domain/ports/payment-gateway.ts). Pure,
 * no infrastructure dependency — `attempt` is always `1` today (a second
 * charge attempt is out of scope, per SPEC 03's handoff).
 */
~~~~

### `src/application/orders/create-order-idempotent.service.ts`

#### C-092 · `CreateOrderIdempotentService` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Wraps the saga with Idempotency-Key handling, so the use case knows nothing about request idempotency and the controller stays thin.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-6 — Idempotency; `specs/05-order-creation-saga.md` › Idempotencia
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — the `Idempotency-Key` dance (FR-6)
 * around `CreateOrderUseCase`'s saga. The use case itself knows nothing
 * about request-level idempotency, only about orders, payments and
 * inventory — this service is the only thing that does, so
 * `orders.controller.ts` stays a thin HTTP adapter.
 */
~~~~

#### C-093 · `CreateOrderIdempotentService > assertValidIdempotencyKey` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Missing or malformed header → 400.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-1 — Create an order
- **Original:**

~~~~ts
  /** Missing header -> `400`; malformed -> `400` (FR-1's `Idempotency-Key (UUID, requerida)`). */
~~~~

#### C-094 · `CreateOrderIdempotentService > beginIdempotentRequest` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Inserts the row first, under its unique constraint. On conflict, resolves replay / 409 in progress / 422 changed body from the row that blocks the insert.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-6 — Idempotency
- **Original:**

~~~~ts
  /**
   * Inserts the row under its unique constraint (FR-6: before any other
   * work begins). On conflict, resolves the exact outcome — replay
   * verbatim, `409` still running, or `422` a changed body — by looking
   * up the row that's actually blocking the insert.
   */
~~~~

#### C-095 · `CreateOrderIdempotentService.beginIdempotentRequest` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Use the row that actually blocks the insert, even if findActiveByKey would treat it as expired.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Risks
- **Original:**

~~~~ts
      // The row is what's actually blocking the insert, regardless of
      // whether findActiveByKey still considers it active (specs/05,
      // Risks — an expired-but-unreaped row's fate is P6's to decide).
~~~~

#### C-096 · `CreateOrderIdempotentService.beginIdempotentRequest` · **KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** COMPLETED: replay the stored response verbatim — never a second order, never a second charge.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-6 — Idempotency
- **Original:**

~~~~ts
      // COMPLETED: replay the stored response verbatim (FR-6) — never a
      // second order, never a second charge.
~~~~

#### C-097 · `CreateOrderIdempotentService > runAndRecord` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Marks the key COMPLETED for any final outcome (success or typed error), reusing buildProblem() so the stored body matches what the filter sends.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions (idempotency_keys COMPLETED for any outcome)
- **Original:**

~~~~ts
  /**
   * Runs the saga and marks `idempotency_keys` `COMPLETED` for whichever
   * final outcome it reaches — success or one of the typed errors alike
   * (specs/05, Decisions) — reusing `problem-details.filter.ts`'s
   * `buildProblem()` so the stored body matches exactly what the global
   * filter will send the client on error.
   */
~~~~

#### C-098 · `CreateOrderIdempotentService.runAndRecord` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** 402 and 502 are thrown only after the order row exists, so order_id is recorded for both and a replay can point to the order.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Fix C — `502` body
- **Original:**

~~~~ts
      // SPEC 07 Fix C: both a 402 and a 502 are only ever thrown after the
      // order row exists, so idempotency_keys.order_id records it for
      // both — a replay can then point the client at the order even
      // though only the 502 body itself carries `orderId`.
~~~~

### `src/application/orders/create-order.errors.ts`

#### C-099 · `CustomerNotFoundError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#errors`
- **Replacement:** customerId doesn't resolve to a customer. Maps to 404.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Comando interno y errores nuevos
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — raised when `CreateOrderCommand.customerId`
 * does not resolve to a row in `customers`. Maps to `404`.
 */
~~~~

#### C-100 · `ProductNotFoundError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#errors`
- **Replacement:** One or more productIds missing or inactive — 404 either way.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — raised when one or more requested
 * `productId`s do not resolve to an active product row. Covers both
 * "does not exist" and "exists but inactive" — same `404` either way
 * (Decisions).
 */
~~~~

#### C-101 · `PaymentOutcomeErrorParams` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#errors`
- **Replacement:** Raised only after the order row exists, so both carry its id.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Fix C — `502` body
- **Original:**

~~~~ts
/** specs/05-order-creation-saga.md, R4.5's Phase-3 errors — both are only ever raised after the order row exists (SPEC 07 Fix C), so both carry its id. */
~~~~

#### C-102 · `PaymentDeclinedError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#errors`
- **Replacement:** DECLINED: the order is already PAYMENT_FAILED and stock released. Maps to 402; orderId isn't in the body (terminal) but is recorded in idempotency_keys.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Respuesta `201` y envelope de error; `specs/07-hardening-demo.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md, R4.5 — raised in Phase 3 (step 11) when
 * `ChargeResult.status === 'DECLINED'`. Terminal: the order becomes
 * `PAYMENT_FAILED` and stock is released before this is thrown. Maps to
 * `402`. `orderId` is not exposed on the `402` response body (Decisions —
 * a `402` is terminal, the client re-posts a new order) but is still
 * recorded in `idempotency_keys.order_id` (SPEC 07 Fix C).
 */
~~~~

#### C-103 · `PaymentProviderUnavailableError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#errors`
- **Replacement:** UNKNOWN (timeout, connection refused, circuit open): order stays PENDING_PAYMENT with the reservation intact for reconciliation. Maps to 502.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Payment outcome classification”; `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md, R4.5 — raised in Phase 3 (step 11) when
 * `ChargeResult.status === 'UNKNOWN'` (provider timeout, connection
 * refused, circuit open — SPEC 03's handoff). The order stays
 * `PENDING_PAYMENT` with its reservation intact; P6's reconciliation
 * decides its fate. Maps to `502`.
 */
~~~~

### `src/application/orders/create-order.types.ts`

#### C-104 · `CreateOrderCommand` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** Threaded through all three saga phases; built once by the controller from the validated DTO.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Comando interno y errores nuevos
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — threaded through all three phases of
 * the saga (steps 9-11). `cardNumber`/`idempotencyKey` are unused by
 * Phase 1 (reserve) but travel with the command so the controller (step
 * 12) builds it once, from the validated `CreateOrderDto`.
 */
~~~~

### `src/application/orders/create-order.use-case.ts`

#### C-113 · `FIRST_PAYMENT_ATTEMPT` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#charge-idempotency-key`
- **Replacement:** A second charge attempt is out of scope today — always 1.
- **Spec duplicate:** `specs/03-external-adapters.md` › Noted for P4
- **Original:**

~~~~ts
/** A second attempt is out of scope today (SPEC 03's handoff) — always 1. */
~~~~

#### C-114 · `isDefinitiveOutcome` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** The only two ChargeResult statuses that mean the provider gave a final answer.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions
- **Original:**

~~~~ts
/** SPEC 07 — the only two `ChargeResult.status` values that mean the provider gave a final answer. */
~~~~

#### C-115 · `ReserveOrderResult` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Phase 1's own result. `order`/`items` are the domain objects Phase 1
 * just persisted; `allocation` carries the winning warehouse's
 * name/distance for the eventual `201` response.
 */
~~~~

#### C-116 · `ChargeOrderResult` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Phase 2's own result — the persisted `payments` row and the gateway's raw outcome. */
~~~~

#### C-117 · `CreateOrderResult` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * What `execute()` resolves with on the only path that returns
 * normally — `CAPTURED`. `DECLINED` and `UNKNOWN` both throw instead
 * (`PaymentDeclinedError`/`PaymentProviderUnavailableError`), after
 * Phase 3 has already settled the order and inventory accordingly.
 */
~~~~

#### C-118 · `CreateOrderUseCase` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** The three-phase POST /orders saga. execute() reads as its table of contents (resolve, reserve, charge, settle); each phase keeps its decisions in its own private method.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5 — Transactional integrity; `references/coding-conventions.md`
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — the three-phase `POST /orders` saga.
 * `execute()` is the whole saga's table of contents: resolve, reserve,
 * charge, settle. Each phase's own flow and decisions stay inside its
 * own private method (not collapsed into a one-line delegating call);
 * splitting by phase mirrors the spec's own three-phase structure,
 * unlike the mechanical, no-decision helpers/ pattern used elsewhere in
 * this codebase (references/coding-conventions.md).
 */
~~~~

#### C-119 · `CreateOrderUseCase > reserveOrder` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  /**
   * Phase 1 (reserve): geocode + `AllocateInventoryUseCase`, whose
   * `onBeforeReserve` inserts `orders` (`PENDING_PAYMENT`) and
   * `order_items` with price snapshots in the same short transaction as
   * the reservation itself.
   */
~~~~

#### C-120 · `CreateOrderUseCase.reserveOrder` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** Geocode before AllocateInventoryUseCase runs, never inside onBeforeReserve — no network call inside the reservation transaction.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Risks
- **Original:**

~~~~ts
    // Resolved before AllocateInventoryUseCase.execute() ever runs, never
    // inside onBeforeReserve — a hard rule as strict as R4.3's one for the
    // payment call (specs/05-order-creation-saga.md, Risks).
~~~~

#### C-121 · `CreateOrderUseCase.reserveOrder` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#order-number`
- **Replacement:** Generated once before the failover loop so it stays stable across retries.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions (order_number generated once)
- **Original:**

~~~~ts
    // Generated once, before the failover loop, and reused across every
    // retry — same reasoning as AllocateInventoryUseCase's own orderId
    // (specs/05, Decisions).
~~~~

#### C-122 · `CreateOrderUseCase > chargeOrder` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#saga-phases`
- **Replacement:** No transaction may be open while charge() is in flight. The idempotency key is persisted to payments first, so reconciliation reads it back instead of rebuilding it.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5 — Transactional integrity
- **Original:**

~~~~ts
  /**
   * Phase 2 (charge) — R4.3's hard rule: no transaction open while this
   * is in flight. The idempotency key is persisted to `payments` before
   * calling `charge()`, so P6's reconciliation reads it back from the
   * row instead of rebuilding it (specs/05-order-creation-saga.md).
   */
~~~~

#### C-123 · `CreateOrderUseCase.chargeOrder.payment` · **KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** settled_at only for a definitive outcome: reconciliation finds UNKNOWN payments via settled_at IS NULL.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Saga — `payments.settled_at`
- **Original:**

~~~~ts
      // SPEC 07: settled_at only for a definitive outcome — R6.2's
      // `settled_at IS NULL` query is how reconciliation finds the
      // UNKNOWN payments it exists to resolve; setting it here for every
      // outcome would make that query miss exactly those rows.
~~~~

#### C-124 · `CreateOrderUseCase > settleOrder` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** Branches on the charge outcome and delegates to OrderSettlementService, whose row lock stops this phase overwriting a settlement a job already made. `payment` is omitted: phase 2 already wrote that row.
- **Spec duplicate:** `specs/07-hardening-demo.md` › `OrderSettlementService`; `specs/07-hardening-demo.md` › Decisions
- **Original:**

~~~~ts
  /**
   * Phase 3 (settle) — branches on the outcome table
   * (specs/05-order-creation-saga.md, R4.3), delegating the actual
   * transition/inventory/event sequence to `OrderSettlementService`
   * (SPEC 07) — the same one the reaper and reconciliation call, guarded
   * by its own row lock so this phase can never overwrite a settlement
   * one of those jobs already made. Called without `payment`: Phase 2
   * already wrote that row.
   */
~~~~

#### C-125 · `CreateOrderUseCase.settleOrder` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** UNKNOWN: leave PENDING_PAYMENT with the reservation intact; reconciliation decides.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Scope; `specs/03-external-adapters.md` › Noted for P4
- **Original:**

~~~~ts
    // UNKNOWN: leave PENDING_PAYMENT, reservation intact — P6's
    // reconciliation decides its fate (specs/05, Handoff from SPEC 03).
~~~~

### `src/application/orders/get-order.service.ts`

#### C-127 · `GetOrderService` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** A non-UUID :id behaves like an unknown id (OrderNotFoundError, no DB call). 'loose' UUID check because fixture ids aren't v4. Items come from findItemsByOrderIds; all queries run in parallel.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, step 8/Decisions — a `:id` with no UUID shape is
 * treated exactly like a well-formed but non-existent id: both throw
 * `OrderNotFoundError`, without a second `400` branch and without
 * reaching the database for a malformed id. `'loose'` — same reasoning as
 * CreateOrderDto's `productId`/`customerId` (this codebase's own fixed
 * test/seed ids are readable, non-v4 "uuid-shaped" strings).
 *
 * Items come from `findItemsByOrderIds` (step 4) — the response's
 * `items` field (Decisions, DTOs de respuesta) has no other source, so
 * this joins step 4's query to the three from step 7, still all
 * independent and run together.
 */
~~~~

### `src/application/orders/helpers/cursor.helpers.ts`

#### C-128 · `InvalidCursorError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** The cursor wasn't produced by this module. Maps to 400.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md — raised by `decodeCursor` when the client-supplied
 * cursor is not something this module produced. Mapped to `400`, same
 * bucket as an invalid query param (Decisions).
 */
~~~~

#### C-129 · `encodeCursor` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** base64("<createdAt ISO>|<id>"). Not JSON: clients only echo it back.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions; `specs/06-read-side.md` › Cursor
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md — `base64("${createdAt.toISOString()}|${id}")`.
 * Not JSON: the client only ever reflects this value back, never parses
 * it (Decisions).
 */
~~~~

### `src/application/orders/helpers/order-number.helpers.ts`

#### C-131 · `generateOrderNumber` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#order-number`
- **Replacement:** CNL-<year>-<6 digits> from the global order_number_seq. Called once before the failover loop so it's stable across retries.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions (secuencia global)
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — `CNL-<year>-<6 digits>`, backed by the
 * `order_number_seq` global sequence. Called once, before
 * `AllocateInventoryUseCase`'s failover loop, so the number stays stable
 * across retries (Decisions).
 */
~~~~

### `src/application/orders/idempotency.repository.ts`

#### C-133 · `SCOPE` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Every row this saga writes shares this scope (also the column default).
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-6 — Idempotency
- **Original:**

~~~~ts
/** FR-6: every row this saga writes shares this scope (column default too). */
~~~~

#### C-134 · `IDEMPOTENCY_KEY_TTL_HOURS` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** (none)
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Idempotencia; `references/coding-conventions.md`
- **Original:**

~~~~ts
/** specs/05-order-creation-saga.md, Scope: 24h — a named constant, not an env var (references/coding-conventions.md). */
~~~~

#### C-135 · `computeRequestFingerprint` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** sha256 of the body with sorted keys and no whitespace, so field order never changes the fingerprint.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Idempotencia
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — sha256 of the body with keys sorted
 * and no whitespace, so the same logical payload always fingerprints the
 * same way regardless of field order.
 */
~~~~

#### C-136 · `insertInProgress` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Its own autocommit statement, before any other work — never inside the reservation transaction. Lets the unique violation propagate; returns the row id to mark COMPLETED later.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Risks
- **Original:**

~~~~ts
/**
 * Its own autocommit statement, called before any other work begins
 * (Risks table) — never inside the same transaction as Phase 1's
 * reservation. Lets the unique `(scope, idempotency_key)` violation
 * propagate; step 12's controller maps it to `409`/`422`/replay.
 * Returns the new row's `id`, which step 12 needs later to mark it
 * `COMPLETED`.
 */
~~~~

#### C-137 · `findActiveByKey` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** null for no row or an expired row — an expired key counts as absent. Deleting expired rows is out of scope here.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions
- **Original:**

~~~~ts
/**
 * `null` for both "no row" and "row past `expires_at`" — an expired key
 * is treated as if it never existed (specs/05-order-creation-saga.md,
 * Scope). Deleting it is P6's reaper, out of scope here.
 */
~~~~

#### C-138 · `markCompleted` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Terminal write for any final outcome — there is no "failed but retryable" state.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions
- **Original:**

~~~~ts
/** Terminal write for any final request outcome, success or error alike (specs/05, Decisions) — `idempotency_state` has no third, "failed but retryable" value. */
~~~~

### `src/application/orders/idempotency.types.ts`

#### C-139 · `IdempotencyCheckResult` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#idempotency`
- **Replacement:** Outcome of trying to insert the Idempotency-Key and reading any existing row.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Idempotencia
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — the decision `POST /orders`'
 * controller (step 12) makes once it has tried to insert the request's
 * `Idempotency-Key` and looked up any existing row.
 */
~~~~

### `src/application/orders/list-orders.service.ts`

#### C-140 · `ListOrdersService` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** hasMore comes from the LIMIT pageSize + 1 lookahead; nextCursor is built from the last retained row, never the lookahead.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, step 5 — orchestrates the two queries from
 * OrdersReadRepository behind `GET /orders`: `hasMore` comes from the
 * `LIMIT pageSize + 1` lookahead (step 4's Decisions), and `nextCursor` is
 * built from the last *retained* row, never the lookahead row.
 */
~~~~

#### C-141 · `ListOrdersService > decodeCursorOrThrow` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** An invalid cursor is a 400 like any invalid query param — rethrown as BadRequestException.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
  /**
   * specs/06-read-side.md, cursor.helpers.ts's Decisions — an invalid
   * cursor is "the same bucket as an invalid query param", not a new
   * problem-details case: rethrown as BadRequestException so the existing
   * filter branch handles it.
   */
~~~~

### `src/application/orders/order-read.errors.ts`

#### C-142 · `OrderNotFoundError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** No row for :id, or :id not UUID-shaped (indistinguishable to the client). Maps to 404.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md — raised when `GET /orders/:id` resolves to no row,
 * or `id` is not shaped like a UUID (Decisions: both are indistinguishable
 * to the client, so both take this path rather than a separate `400`).
 * Maps to `404`, same bucket as `CustomerNotFoundError`/`ProductNotFoundError`.
 */
~~~~

### `src/application/orders/order-settlement.service.ts`

#### C-144 · `PaymentResolution` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** A job (reaper/reconciliation) passes this; the saga's Phase 3 doesn't — it already wrote the `payments` row itself in Phase 2. */
~~~~

#### C-145 · `OrderSettlementService` · **MOVE**

- **Category:** spec-ref, rationale, invariant
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:**
  > The single "settle this order" path for the saga, the reaper and reconciliation. Its row lock makes racing settlers resolve to exactly one winner.
  > See knowledge/orders-saga.md#settlement
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions (one OrderSettlementService); `specs/07-hardening-demo.md` › `OrderSettlementService`
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md — the one implementation of "settle this
 * order", shared by the saga's Phase 3, the reservation reaper (R6.1) and
 * payment reconciliation (R6.2). Without it, three code paths each
 * re-implement the same transition/inventory/event sequence, and the
 * saga's in-memory `Order` could overwrite a `CANCELLED` the reaper wrote
 * in between (Decisions — the row lock is what makes two settlers racing
 * on the same order resolve to exactly one winner).
 */
~~~~

#### C-146 · `OrderSettlementService > settle` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, rationale
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** Shared steps: lock the order row, return ALREADY_SETTLED if it moved on, update payments if a resolution was passed, then run the caller's own transition.
- **Spec duplicate:** `specs/07-hardening-demo.md` › `OrderSettlementService`
- **Original:**

~~~~ts
  /**
   * The steps every method above shares: lock the order row, bail out
   * `ALREADY_SETTLED` if it moved on already, update the `payments` row
   * when a resolution was passed in, then hand off to the caller's own
   * transition (the part that actually differs between confirm/fail/
   * cancel — kept in each method above, not hidden in here,
   * references/coding-conventions.md).
   */
~~~~

#### C-147 · `OrderSettlementService.settle` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** (unchanged)
- **Spec duplicate:** `references/coding-conventions.md`
- **Original:**

~~~~ts
      // Raw SQL for the lock itself — concurrency-critical
      // (references/coding-conventions.md); the read-back below goes
      // through the ORM as usual, now protected by the lock this holds
      // for the rest of the transaction.
~~~~

#### C-148 · `OrderSettlementService.settle` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/orders-saga.md#settlement`
- **Replacement:** (unchanged)
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions ("No: a conditional UPDATE … alone")
- **Original:**

~~~~ts
        // Raw SQL — concurrency-critical: the `WHERE status IN (...)`
        // guard is what stops this from overwriting a row a concurrent
        // settler already finished with (references/coding-conventions.md).
~~~~

### `src/infrastructure/database/repositories/orders-read.repository.ts`

#### C-234 · `OrdersReadRepository > findPage` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** WHERE built from parameterized fragments (filters are optional and combinable). The cursor uses a row comparison so created_at ties resolve by id. LIMIT pageSize + 1 gives hasMore without COUNT(*).
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
  /**
   * specs/06-read-side.md, Decisions — the WHERE clause is an array of
   * parameterized fragments assembled in TypeScript, not a static .sql
   * file: R5.3's filters are optional and combinable, so no single fixed
   * statement can express every subset. The cursor condition is a real
   * Postgres row comparison (`(created_at, id) < (...)`), not two `OR`
   * branches, so a `created_at` tie resolves correctly by `id`. `LIMIT
   * pageSize + 1` is the lookahead the service (step 5) uses to compute
   * `hasMore` without a second `COUNT(*)` query.
   */
~~~~

#### C-235 · `OrdersReadRepository > findItemsByOrderIds` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** One query for the whole page, grouped in the service. The ::uuid[] cast keeps it valid when orderIds is empty.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
  /**
   * `WHERE order_id = ANY($1)` — one query for the whole page, grouped by
   * `order_id` in the service (R5.4). The explicit `::uuid[]` cast is
   * what keeps this valid SQL when `orderIds` is empty (an empty page),
   * rather than relying on the driver to infer the array's element type.
   */
~~~~

#### C-236 · `OrdersReadRepository > findOrderById` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** LEFT JOIN warehouses: warehouse_id is nullable, so the order still returns with null warehouse fields.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
  /**
   * specs/06-read-side.md, Decisions — `LEFT JOIN warehouses`, not `INNER
   * JOIN`: `warehouse_id` is nullable in the schema, and this endpoint
   * must not assume SPEC 05's own invariant (it always fills it before
   * insert) — a null `warehouse_id` still returns the order, with
   * `warehouse_name`/`distance_meters` coming back `null` from the
   * unmatched join, no `CASE` needed.
   */
~~~~

### `src/infrastructure/http/controllers/orders-read.controller.ts`

#### C-279 · `OrdersReadController` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** GET /orders and GET /orders/:id; separate from the POST /orders controller, same prefix, no route collision.
- **Spec duplicate:** `specs/06-read-side.md` › Scope
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md — `GET /orders`/`GET /orders/:id`. Separate file
 * from `orders.controller.ts` (P4, `POST /orders`) — same `orders`
 * prefix, no route collision: `@Get()` is `orders` exact, `@Get(':id')`
 * is `orders/:id`.
 */
~~~~

#### C-280 · `OrdersReadController > list` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** Local ValidationPipe with transform: true (so pageSize is a number); adding it globally would change CreateOrderDto coercion.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
  /**
   * specs/06-read-side.md, Decisions — a local `ValidationPipe`, not the
   * global one in main.ts: `transform: true` is what makes `pageSize`
   * arrive as a `number`, and adding it to the global pipe would risk
   * changing how `CreateOrderDto` (SPEC 05, already verified) coerces its
   * own fields.
   */
~~~~

### `src/infrastructure/http/controllers/orders.controller.ts`

#### C-281 · `OrdersController` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** Thin HTTP adapter; Idempotency-Key orchestration lives in CreateOrderIdempotentService.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — `POST /orders`. A thin HTTP adapter:
 * all of the `Idempotency-Key` orchestration lives in
 * `CreateOrderIdempotentService` (application layer), including which
 * status/body this endpoint answers with.
 */
~~~~

#### C-282 · `OrdersController > create` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** Response types are plain interfaces, so outcomes are documented with @ApiResponse descriptions.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening
- **Original:**

~~~~ts
  /**
   * SPEC 07 R6.6: `OrderResponse`/`ProblemDetails` are plain interfaces
   * (no runtime metadata for the CLI plugin to introspect), so each
   * outcome is documented with an `@ApiResponse` description instead of a
   * generated schema.
   */
~~~~

### `src/infrastructure/http/dto/create-order.dto.ts`

#### C-284 · `SUPPORTED_COUNTRY` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#validation`
- **Replacement:** The only supported market.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions ("No: soporte de países distintos a US")
- **Original:**

~~~~ts
/** FR-1: the only market this saga supports — see specs/05-order-creation-saga.md, Decisions. */
~~~~

#### C-285 · `CARD_NUMBER_PATTERN` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#validation`
- **Replacement:** Shape only (13–19 digits); the provider decides the outcome.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions (cardNumber shape only)
- **Original:**

~~~~ts
/** Only shape, 13-19 digits — the mock decides the real outcome by the exact value (specs/05, Decisions). */
~~~~

#### C-286 · `OrderLineDto > productId` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/orders-saga.md#validation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // 'loose': accepts any 8-4-4-4-12 hex-dash shape, not just RFC4122's
  // version/variant nibbles. Real ids are gen_random_uuid() (always
  // valid v4), but this codebase's own fixed test/seed ids
  // (seed.ts's a0000000-.../b0000000-..., concurrency-check.ts's
  // d0000000-..., events-check.ts's e0000000-...) are deliberately
  // readable, sequential, non-v4 "uuid-shaped" strings — 'all' (the
  // default) rejects them outright, which would make POST /orders
  // impossible to exercise against npm run seed's own data.
~~~~

#### C-287 · `UniqueProductIds` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#validation`
- **Replacement:** items[] must not repeat a productId — rejected, never merged.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions (productId repetido → 400)
- **Original:**

~~~~ts
/** `items[]` must not repeat a `productId` — rejected outright, never merged (specs/05, Decisions). */
~~~~

### `src/infrastructure/http/dto/helpers/distance-format.helper.ts`

#### C-288 · `formatDistance` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Mechanical unit conversion for response DTOs — km/miles rounded to 2 decimals, `meters` kept at source precision. */
~~~~

### `src/infrastructure/http/dto/helpers/money-format.helper.ts`

#### C-289 · `formatCentsAsDollars` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Mechanical cents → dollars projection for response DTOs — no rounding decision beyond `toFixed(2)`. */
~~~~

### `src/infrastructure/http/dto/order-detail.response.dto.ts`

#### C-291 · `toOrderDetailResponse` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** Explicit projection: card_last4/card_brand, provider_payment_id, idempotency_key and raw_response are deliberately never exposed.
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, R5.5 — an explicit field-by-field projection.
 * Deliberately leaves out `card_last4`/`card_brand`/`provider_payment_id`/
 * `idempotency_key`/`raw_response` — no field in `PaymentAttemptRow`
 * beyond the ones listed here is ever read (Decisions).
 */
~~~~

### `src/infrastructure/http/dto/order-list.response.dto.ts`

#### C-292 · `toOrderListItem` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/orders-saga.md#read-side`
- **Replacement:** Explicit field-by-field projection, never a spread, so new columns can't leak into the response.
- **Spec duplicate:** `specs/06-read-side.md` › Response DTOs
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, R5.5 — an explicit field-by-field projection,
 * never a spread of `OrderRow`/`OrderItemRow`, so a column added to
 * `orders`/`order_items` later cannot leak into the response by accident.
 */
~~~~

### `src/infrastructure/http/dto/order-response.dto.ts`

#### C-293 · `WarehouseAllocationInfo` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Raw allocation result (meters only) — the shape `AllocateInventoryUseCase` hands back, before `toOrderResponse()` projects it into `OrderResponseWarehouse`. */
~~~~

#### C-294 · `OrderResponse` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** The 201 response body.
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Respuesta `201` y envelope de error
- **Original:**

~~~~ts
/** specs/05-order-creation-saga.md, Data model — the `201` body's shape. */
~~~~

#### C-295 · `toOrderResponse` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#http-api`
- **Replacement:** Shows which warehouse was chosen and why (name and distance).
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** R4.6: the reviewer must see which warehouse was chosen, and why (its name and distance), without opening psql. */
~~~~

### `src/infrastructure/http/filters/problem-details.filter.ts`

#### C-299 · `ProblemDetails` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** RFC 9457 body. orderId is an extension member, set only on the 502.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions; `specs/07-hardening-demo.md` › Fix C — `502` body
- **Original:**

~~~~ts
/** specs/05-order-creation-saga.md, Data model. `orderId` is an RFC 9457 extension member, set only on the `502` (SPEC 07 Fix C, Decisions). */
~~~~

#### C-300 · `ProblemShape` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Exported so the idempotency service stores exactly the status/body the client receives.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Exported so the controller (step 12) can mark `idempotency_keys` COMPLETED with the exact status/body the client is about to receive, without duplicating this mapping. */
~~~~

#### C-301 · `WHITELIST_VIOLATION_PATTERN` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * `class-validator`'s own whitelist check (`ValidationExecutor.whitelist`)
 * formats a rejected-property message as the fixed sentence
 * `property ${property} should not exist` — the field name sits in the
 * *second* position, unlike every other constraint message.
 */
~~~~

#### C-302 · `extractValidationErrors` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Same text minus "already-frozen"; keep the explanation of how Nest's ValidationPipe prefixes the path.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Nest's `ValidationPipe` (main.ts) formats every other message as
 * `<dot.path> <constraint text>` — even for a nested property, since it
 * prepends the parent path to the message string itself, not to a
 * separate field (`@nestjs/common/pipes/validation.pipe.js`,
 * `prependConstraintsWithParentProp`). Splitting on the first space
 * reliably recovers the path for those, without needing a custom
 * `exceptionFactory` in the already-frozen main.ts.
 */
~~~~

#### C-303 · `ExposedHttpError` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Shape of an http-errors error thrown by Express middleware: a status and expose: true (safe to show).
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * SPEC 07 R6.6: the shape `http-errors` (used by `body-parser`/`raw-body`,
 * among others) gives an Express-middleware-thrown error — a `status`
 * (the intended HTTP status) and `expose: true` (safe to show the client,
 * as opposed to an internal 500 detail).
 */
~~~~

#### C-304 · `buildProblem` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Maps every saga outcome to its status. `type` values are urn:problem-type:* identifiers — RFC 9457 allows a non-resolvable URI.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-8 — Input validation and error contract
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md, R4.5 — every branch this saga can end
 * in, mapped to its status. `type` values are `urn:problem-type:*`
 * identifiers, not resolvable URLs — RFC 9457 only requires a URI
 * reference that discriminates the problem type, and this codebase has no
 * documentation site to point them at.
 */
~~~~

#### C-305 · `buildProblem` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** One error class, two statuses via `reason` (422 vs 409).
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Decisions
- **Original:**

~~~~ts
    // specs/05, Decisions: P1's error carries `reason` so this one class
    // can still map to two different statuses (422 vs 409).
~~~~

#### C-306 · `buildProblem` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Tell the client to poll the order, not re-post with a new Idempotency-Key (that could charge twice).
- **Spec duplicate:** `specs/07-hardening-demo.md` › Fix C — `502` body
- **Original:**

~~~~ts
      // SPEC 07 Fix C: tells the client to poll the order instead of
      // re-posting with a new Idempotency-Key, which could charge twice.
~~~~

#### C-307 · `buildProblem` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Body-parser limit errors (e.g. 413) come from Express middleware before Nest; they're shaped like http-errors, not HttpException.
- **Spec duplicate:** `specs/07-hardening-demo.md` › R6.6 — HTTP hardening
- **Original:**

~~~~ts
  // SPEC 07 R6.6: a body-parser/raw-body limit error (e.g. `413` from a
  // body over BODY_LIMIT) is thrown by Express middleware, before Nest's
  // request pipeline — it is shaped like the `http-errors` package's
  // output (a `status` and `expose: true`), not an `HttpException`.
~~~~

#### C-308 · `ProblemDetailsFilter` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/orders-saga.md#error-contract`
- **Replacement:** Single RFC 9457 envelope. correlationId always comes from AsyncLocalStorage, never generated here. 500s log the full stack; the logger redacts every object, so card numbers can't reach logs this way.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-8
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md — the single RFC 9457 envelope for
 * every error response. `correlationId` always comes from
 * `AsyncLocalStorage` (`CorrelationMiddleware` sets it before any
 * handler runs) — never generated here, so it always matches the
 * request's own trace. Unhandled exceptions (`500`) are logged with
 * their full stack; `nestjs-pino`'s serializer runs every logged object
 * through `redact()` (`shared.module.ts`), so a card number can never
 * reach a log line this way either.
 */
~~~~

## messaging-jobs

### `src/application/jobs/analytics-record.handler.ts`

#### C-066 · `AnalyticsRecordHandler` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#event-handlers`
- **Replacement:** Logs a structured domain event; no real analytics sink — nothing leaves the process.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The event contract”; `specs/04-queue-worker-observability.md` › Scope
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "logs a structured domain event". No real analytics sink —
 * nothing leaves the process (Decisions, "The event contract" / "Out of
 * scope").
 */
~~~~

### `src/application/jobs/customer-notify.handler.ts`

#### C-067 · `CustomerNotifyHandler` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#event-handlers`
- **Replacement:** Logs a structured "notification sent" event; no real email sink — nothing leaves the process.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The event contract”; `specs/04-queue-worker-observability.md` › Scope
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "logs a structured 'notification sent' event". No real
 * email sink — nothing leaves the process (Decisions, "The event
 * contract" / "Out of scope").
 */
~~~~

### `src/application/jobs/helpers/shipment-mock.helpers.ts`

#### C-068 · `generateTrackingNumber` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#shipment-create`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Carrier-shaped, not carrier-verified — mock QA data, not a real tracking format guarantee. */
~~~~

### `src/application/jobs/job-handler.ts`

#### C-071 · `JobHandler` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#handler-contract`
- **Replacement:** Handlers get payload only: JobRunner consumes meta (correlation id, trace context) before they run.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Handler contract
- **Original:**

~~~~ts
/**
 * SPEC 04 Data model, "Handler contract". Handlers receive `payload` only:
 * `meta` is consumed by the `JobRunner` before they run — the
 * `correlationId` is already in the logging context and the span already
 * open (step 7), so a handler never reads, forwards or knows about it.
 */
~~~~

#### C-072 · `JOB_HANDLERS` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/messaging-jobs.md#handler-contract`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** DI token for the multi-provider array of every registered JobHandler, consumed by the JobRunner. */
~~~~

### `src/application/jobs/payment-reconciliation.handler.ts`

#### C-074 · `RECONCILIATION_BATCH_SIZE` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#payment-reconciliation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Selection query's own LIMIT — a batch bounded run over run, not the whole backlog at once. */
~~~~

#### C-075 · `RECONCILIATION_GRACE_MINUTES` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#payment-reconciliation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Grace before reconciling: longer than the gateway's worst case (3 × 2 s + backoff). */
~~~~

#### C-076 · `PaymentReconciliationHandler` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#payment-reconciliation`
- **Replacement:**
  > Every minute: resolves payments still unsettled past the grace period via OrderSettlementService. Acts only on CAPTURED/DECLINED; FAILED/UNKNOWN are left to the reaper.
  > See knowledge/messaging-jobs.md#payment-reconciliation
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions; `specs/07-hardening-demo.md` › Scheduled jobs
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.2 — run every minute by the worker's
 * scheduler (queue-setup.ts's SCHEDULED_JOBS). Resolves every `payments`
 * row still unsettled past the grace period, through
 * `OrderSettlementService` so it can never race the saga's Phase 3 or the
 * reservation reaper.
 *
 * Acts only on a *definitive* answer — `CAPTURED`/`DECLINED`. `FAILED`
 * (the provider never saw this charge) and `UNKNOWN` are left to the
 * reaper: only it, after the reservation TTL, may conclude "never
 * charged" (Decisions — the two jobs overlap by design on the definitive
 * answers, and diverge on the ambiguous one).
 */
~~~~

#### C-077 · `selectUnsettledPayments` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#settlement-locking`
- **Replacement:** Selection only: this transaction's FOR UPDATE lock ends when the query returns. OrderSettlementService re-locks and re-checks each order in its own transaction.
- **Spec duplicate:** `specs/07-hardening-demo.md` › `OrderSettlementService`
- **Original:**

~~~~ts
  /**
   * Selection only — this transaction commits (and its `FOR UPDATE` lock
   * releases) the moment the query returns; `OrderSettlementService`
   * re-locks and re-checks each order's status itself, in its own
   * transaction, once this method's row is actually resolved
   * (specs/07-hardening-demo.md, same discipline as the reaper).
   */
~~~~

#### C-078 · `resolvePayment` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#payment-reconciliation`
- **Replacement:** FAILED/UNKNOWN aren't definitive — only the reaper, after the reservation TTL, may conclude "never charged".
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions ("only the reaper may conclude never charged")
- **Original:**

~~~~ts
    // FAILED (never charged) or UNKNOWN: neither is definitive enough for
    // reconciliation to act on — only the reaper, after the reservation
    // TTL, may conclude "never charged" (Decisions).
~~~~

### `src/application/jobs/reservation-reaper.handler.ts`

#### C-080 · `REAPER_BATCH_SIZE` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#reservation-reaper`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Selection query's own LIMIT — a batch bounded run over run, not the whole backlog at once. */
~~~~

#### C-081 · `REAPER_ALERT_AFTER_MINUTES` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#reservation-reaper`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Past expiry by this much and still UNKNOWN → alert on every run (the reaper keeps retrying after it alerts). */
~~~~

#### C-082 · `ReservationReaperHandler` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#reservation-reaper`
- **Replacement:**
  > Every minute: resolves PENDING_PAYMENT orders whose reservation expired, via OrderSettlementService. One order's failure is logged and doesn't abort the batch.
  > See knowledge/messaging-jobs.md#reservation-reaper
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions; `specs/07-hardening-demo.md` › Scheduled jobs
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.1 — run every minute by the worker's
 * scheduler (queue-setup.ts's SCHEDULED_JOBS). Resolves every
 * `PENDING_PAYMENT` order whose reservation has expired, through
 * `OrderSettlementService` so it can never race the saga's Phase 3 or
 * reconciliation. One order's failure is logged and does not abort the
 * batch (Decisions) — a crash mid-batch is simply the next minute's run.
 */
~~~~

#### C-083 · `selectExpiredReservations` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#settlement-locking`
- **Replacement:** Selection only: this transaction's FOR UPDATE lock ends when the query returns. OrderSettlementService re-locks and re-checks each order in its own transaction.
- **Spec duplicate:** `specs/07-hardening-demo.md` › `OrderSettlementService`
- **Original:**

~~~~ts
  /**
   * Selection only — this transaction commits (and its `FOR UPDATE` lock
   * releases) the moment the query returns; `OrderSettlementService`
   * re-locks and re-checks each order's status itself, in its own
   * transaction, once this method's row is actually resolved
   * (specs/07-hardening-demo.md).
   */
~~~~

#### C-085 · `resolveReservation` · **KEEP**

- **Category:** invariant, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#reservation-reaper`
- **Replacement:** UNKNOWN is never auto-released: releasing stock for a charge that did go through is worse than holding it until a human looks.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions
- **Original:**

~~~~ts
    // UNKNOWN: never auto-released — releasing stock for a charge that
    // did go through is worse than holding it until a human looks
    // (Decisions).
~~~~

### `src/application/jobs/shipment-create.handler.ts`

#### C-087 · `ShipmentCreateHandler` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#shipment-create`
- **Replacement:** Creates the shipment via ShipmentService. Errors (missing order, null warehouse_id) are left to pg-boss retry/dead-letter.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Scope; `engineering:documentation/infrastructure.md` › 3. One repo, two entrypoints
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: creates the shipment via `ShipmentService`
 * (`infrastructure.md` §3's own worked example for this exact handler).
 * A thrown error (order not found, null `warehouse_id`) is left to
 * pg-boss's retry/dead-letter mechanism (step 6) — this handler does not
 * catch it.
 */
~~~~

### `src/application/jobs/shipment.service.ts`

#### C-089 · `ShipmentService` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#shipment-create`
- **Replacement:**
  > ON CONFLICT (order_id) DO NOTHING makes retries idempotent (a retry discards its fresh values). Starts DISPATCHED with mock carrier/tracking data for local QA — a deliberate deviation.
  > See knowledge/messaging-jobs.md#shipment-create
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Scope (INSERT … ON CONFLICT); DISPATCHED deviation is NOT in any spec
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "INSERT INTO shipments … ON CONFLICT (order_id) DO
 * NOTHING … warehouse_id read from the order".
 * `ON CONFLICT (order_id) DO NOTHING` is the idempotency: running this
 * twice for the same order inserts once and errors never (R3.4) — a
 * pg-boss retry after a successful first insert simply discards its own
 * freshly-generated carrier/tracking values instead of overwriting them.
 *
 * Deliberate deviation from specs/04-queue-worker-observability.md
 * ("shipment lifecycle transitions beyond PENDING_DISPATCH... goes in its
 * own spec"): requested for local QA/demo so a shipment is inspectable as
 * dispatched immediately, without adding a delayed pg-boss job or any new
 * queue. `status` starts at `DISPATCHED` with a random-but-carrier-shaped
 * `carrier`/`tracking_number`/`dispatched_at` instead of `PENDING_DISPATCH`
 * with nulls. `delivered_at` stays null — only dispatch is mocked.
 */
~~~~

### `src/domain/ports/event-publisher.ts`

#### C-165 · `DomainEvent` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#transactional-outbox`
- **Replacement:** An event name plus payload (mirrors boss.send). `type` stays a plain string; publishers name concrete events.
- **Spec duplicate:** `specs/01-foundation.md` › Port interfaces, frozen
- **Original:**

~~~~ts
/**
 * A named event and its payload, bundled into one object — mirrors what
 * `boss.send(name, data, options)` needs, folded into the single argument
 * this port's `publish` takes. `type` stays a generic `string`, not a
 * literal union: P0 defines the envelope, P4 is the one that actually
 * constructs and names a concrete event (`order.confirmed`, FR-9).
 */
~~~~

#### C-166 · `TransactionContext` · **MOVE**

- **Category:** rationale, example, spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#transactional-outbox`
- **Replacement:**
  > Raw SQL executor bound to the caller's transaction, so the job insert commits or rolls back with it (transactional outbox). A plain function keeps the port framework-free.
  > See knowledge/messaging-jobs.md#transactional-outbox
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › Transactional outbox; `specs/04-queue-worker-observability.md` › Decisions › “The transactional outbox”
- **Original:**

~~~~ts
/**
 * A raw SQL executor bound to the caller's in-flight transaction — what
 * lets the pg-boss job insert join the *same* transaction as the order
 * update it accompanies (the transactional-outbox pattern,
 * architectural-requirements.md §"Transactional outbox"):
 *
 * ```ts
 * await dataSource.transaction(async (trx) => {
 *   await trx.update(Order, orderId, { status: 'CONFIRMED' });
 *   await eventPublisher.publish(event, { executeSql: (sql, values) => trx.query(sql, values) });
 * }); // one COMMIT: the order and the job are saved together, or neither is
 * ```
 *
 * Shaped as a plain function, not a TypeORM `QueryRunner`, so this port
 * stays framework-free — the P3 adapter is what knows how to wrap it into
 * pg-boss's own `{ db: { executeSql } }` option.
 */
~~~~

#### C-167 · `EventPublisher` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#transactional-outbox`
- **Replacement:** Publishes inside the caller's transaction when `tx` is given; omit `tx` to publish outside one.
- **Spec duplicate:** `specs/01-foundation.md` › Port interfaces, frozen; `engineering:documentation/architectural-requirements.md` › FR-9
- **Original:**

~~~~ts
/**
 * R0.6 (frozen contract). Implemented by P3 (pg-boss adapter) and consumed
 * by P4, which publishes `order.confirmed` inside the same transaction
 * that commits the order (FR-9). `tx` is optional: a caller publishing
 * outside a transaction (there isn't one for P0/P1) simply omits it.
 */
~~~~

### `src/infrastructure/messaging/event-routing.ts`

#### C-323 · `OrderConfirmedPayload` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#event-contract`
- **Replacement:** Deliberately minimal: handlers read current state from the DB, so a late job never acts on a stale copy.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The event contract”; `specs/04-queue-worker-observability.md` › Event contract
- **Original:**

~~~~ts
/**
 * SPEC 04 Data model, "Event contract" — the only event P3 defines. P4
 * publishes it; P3 routes and consumes it. Deliberately minimal: handlers
 * read whatever else they need from the database, so a job running a
 * minute late sees current state rather than a stale copy (Decisions,
 * "The event contract").
 */
~~~~

#### C-324 · `EVENT_ROUTING` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#event-routing`
- **Replacement:** Routing lives in code, not in pg-boss publish/subscribe: a missing subscribe() would silently drop events.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Queue topology and fan-out”
- **Original:**

~~~~ts
/**
 * SPEC 04 Decisions, "Queue topology and fan-out": routing lives in code, not
 * in pg-boss's own `publish`/`subscribe` table (see that section for why —
 * a `subscribe()` never called by a fresh worker would enqueue nothing and
 * report success, exactly the silent-drop FR-9 exists to prevent).
 */
~~~~

#### C-325 · `UnroutedEventError` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#event-routing`
- **Replacement:** (unchanged)
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Queue topology and fan-out”
- **Original:**

~~~~ts
/** A typo in an event type must fail loudly at publish time, not vanish. */
~~~~

### `src/infrastructure/messaging/job-envelope.ts`

#### C-326 · `JobMeta` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#job-envelope`
- **Replacement:** Captured by PgBossEventPublisher, restored by JobRunner; handlers never see meta.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Job body and routing
- **Original:**

~~~~ts
/**
 * SPEC 04 Data model, "Job body and routing". `correlationId`/`traceparent`
 * are captured by `PgBossEventPublisher` and restored by the `JobRunner`
 * (step 7) — a handler never sees `meta`, only `payload`
 * (`job-handler.ts`'s contract).
 */
~~~~

#### C-327 · `JobMeta > traceparent` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#job-envelope`
- **Replacement:** W3C trace context; null when no span is active.
- **Spec duplicate:** —
- **Original:**

~~~~ts
  /** W3C trace context; null when no span is active (before step 7 lands tracing, always null). */
~~~~

### `src/infrastructure/messaging/job-runner.integration.spec.ts`

#### C-334 · `describe('JobRunner — retries and dead-letter queu').it('realistic: order.confirmed for a non-exi')` · **SHORTEN**

- **Category:** verification-note, spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#dead-letter`
- **Replacement:** The original job stays as 'failed'; a separate copy lands in the DLQ.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”
- **Original:**

~~~~ts
      // The original shipment.create row is re-inserted terminally
      // 'failed' (not deleted) by pg-boss's failJobsBody — a *separate*
      // copy is what lands in shipment.create.dlq (insertDeadLetterJob,
      // SPEC 04 step 1 finding).
~~~~

### `src/infrastructure/messaging/job-runner.ts`

#### C-339 · `GRACEFUL_SHUTDOWN_TIMEOUT_MS` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/messaging-jobs.md#graceful-shutdown`
- **Replacement:** Must stay under compose's 30 s stop_grace_period so Docker never SIGKILLs mid-job.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The worker, its connections and shutdown”
- **Original:**

~~~~ts
/**
 * Stays under compose's 30 s `stop_grace_period` (step 10) so Docker never
 * SIGKILLs mid-job (SPEC 04 Decisions, "The worker, its connections and
 * shutdown").
 */
~~~~

#### C-340 · `JobRunner` · **MOVE**

- **Category:** rationale, narration
- **Knowledge target:** `knowledge/messaging-jobs.md#job-runner`
- **Replacement:**
  > Registers one boss.work() per handler. Per job: restores correlationId, opens a root `job <queue>` span linked to the publisher, runs the handler, then logs and rethrows failures so pg-boss retry/DLQ still runs.
  > See knowledge/messaging-jobs.md#job-runner
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Correlation and tracing”; `specs/04-queue-worker-observability.md` › Decisions › “Retries and dead-letter queues”
- **Original:**

~~~~ts
/**
 * Started from `main.worker.ts` (`await app.get(JobRunner).start()`,
 * `infrastructure.md` §3). Registers one `boss.work()` per handler in
 * `JOB_HANDLERS`. For each job: restores `correlationId` into
 * `correlationStorage` (read by the pino `mixin` and by
 * `PgBossEventPublisher` if the handler itself publishes), opens one
 * hand-written `job <queue>` span in its own trace — `root: true`, so it
 * is never accidentally nested under whatever context pg-boss's own fetch
 * loop happens to be running in — linked to the publishing span via the
 * envelope's `traceparent`, and runs the handler with that span active so
 * any `pg` spans the handler produces nest under it instead of appearing
 * as orphans. The handler receives `payload` only — it never sees `meta`.
 * A thrown error is recorded on the span, logged — `queue`, `jobId`,
 * `attempt`, `retryLimit`, `error`, `correlationId` — and re-thrown so
 * pg-boss's own retry/dead-letter transition still runs; this warn line is
 * the per-attempt failure history pg-boss itself does not keep (R3.5).
 * `start()` also registers the DLQ gauge (`dlq-gauge.ts`) — the worker is
 * the only process with a `PgBoss` instance worth sampling.
 */
~~~~

#### C-342 · `JobRunner.start` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#scheduled-jobs`
- **Replacement:** Scheduled jobs are born without meta — there's no request to restore context from.
- **Spec duplicate:** —
- **Original:**

~~~~ts
          // SPEC 07: a scheduled job (reservation.reap, payment.reconcile)
          // is published via boss.schedule(), not PgBossEventPublisher, so
          // it is born without meta — there is no publishing request to
          // restore a correlationId/traceparent from.
~~~~

#### C-344 · `JobRunner.start` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#scheduled-jobs`
- **Replacement:** Scheduled jobs, worker only. pg-boss dedupes cron ticks across instances.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions (pg-boss schedule())
- **Original:**

~~~~ts
    // SPEC 07 — scheduled jobs (R6.1/R6.2). Called from the worker only
    // (this file never runs in the api process); pg-boss's own scheduler
    // dedupes cron ticks across instances of the same process, so this is
    // safe even with more than one worker.
~~~~

### `src/infrastructure/messaging/pg-boss-event-publisher.ts`

#### C-350 · `PgBossEventPublisher` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#transactional-outbox`
- **Replacement:** publish() looks up EVENT_ROUTING and sends one job per target queue, through the caller's executeSql when tx is given, so the jobs commit or roll back with it.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Queue topology and fan-out”; `specs/04-queue-worker-observability.md` › Decisions › “The transactional outbox”
- **Original:**

~~~~ts
/**
 * SPEC 04 — replaces P0's no-op `EVENT_PUBLISHER` stub. Implements the
 * frozen `EventPublisher` port unchanged (R0.6): `publish()` looks the event
 * type up in `EVENT_ROUTING` and sends one job per target queue, all
 * through the same `db.executeSql` when `tx` is supplied, so the job
 * inserts commit or roll back with the caller's transaction (FR-9).
 */
~~~~

#### C-352 · `PgBossEventPublisher.publish` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#transactional-outbox`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // TransactionContext stays framework-free and returns `Promise<unknown>`
    // (domain/ports/event-publisher.ts); this is the one place that knows
    // pg-boss's own `Db.executeSql` shape (`{ rows }`) and bridges the two.
    // The port's own doc comment example wires `executeSql` straight to
    // TypeORM's `EntityManager.query()`, which resolves to the bare rows
    // array (`PostgresQueryRunner.query()`, `useStructuredResult: false`),
    // not `{ rows }` — that wrapping happens here.
~~~~

### `src/infrastructure/messaging/pg-boss-shutdown.hook.ts`

#### C-353 · `PgBossShutdownHook` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#graceful-shutdown`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Api-only cleanup for the api's own `PgBoss` instance. The worker's
 * (`JobRunner.onApplicationShutdown`) already stops its instance
 * gracefully, draining an in-flight job — registering this same hook
 * there too would call `boss.stop()` twice. The api's instance never
 * consumes anything, so a plain stop is enough: nothing to drain, just a
 * pool (and pg-boss's own internal timers) to not leak on shutdown.
 */
~~~~

### `src/infrastructure/messaging/pg-boss.provider.ts`

#### C-354 · `PG_BOSS` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/messaging-jobs.md#pgboss-roles`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** DI token — PgBoss is a third-party class, keyed by a symbol like the domain ports. */
~~~~

#### C-355 · `PgBossRole` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#pgboss-roles`
- **Replacement:** The api only publishes and reads queue state; the worker alone supervises, maintains and consumes.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The worker, its connections and shutdown”
- **Original:**

~~~~ts
/**
 * The api publishes and reads queue state for readiness; it must never
 * compete with the worker for maintenance or consume jobs. The worker is
 * the single process that supervises, maintains and consumes (SPEC 04
 * Scope). Everything that differs between the two processes' `PgBoss`
 * instance is decided here, from this one flag.
 */
~~~~

#### C-356 · `PGBOSS_POOL_SIZE_API` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#pgboss-roles`
- **Replacement:** pg-boss's own pool, separate from TypeORM's.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The worker, its connections and shutdown”
- **Original:**

~~~~ts
/** pg-boss's own pool, separate from TypeORM's (SPEC 04 Decisions, "The worker, its connections and shutdown"). */
~~~~

#### C-357 · `pgBossProvider` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/messaging-jobs.md#pgboss-roles`
- **Replacement:** One started PgBoss per process, queues created before any consumer sees it. role decides pool size, supervision, and LISTEN/NOTIFY (worker only).
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”
- **Original:**

~~~~ts
/**
 * One `PgBoss` instance per process, started and with its queues created
 * before anything else can observe it (`useFactory` may return a Promise —
 * Nest awaits it before resolving any consumer's constructor). `role`
 * decides pool size, whether this instance supervises/schedules maintenance,
 * and whether it holds the dedicated LISTEN/NOTIFY connection (`worker`
 * only — SPEC 04 step 1 finding on `useListenNotify`).
 */
~~~~

#### C-358 · `pgBossProvider.useFactory` · **KEEP**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/messaging-jobs.md#pgboss-roles`
- **Replacement:** PgBoss emits 'error' when its pool loses a connection; with no listener Node crashes the process (seen with postgres stopped). Keep this listener.
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // PgBoss extends EventEmitter and emits 'error' whenever its pool
      // loses a connection (e.g. Postgres restarting) — Node's own
      // EventEmitter convention throws an unhandled exception and crashes
      // the whole process if 'error' has no listener. Found the hard way:
      // GET /health/ready during `docker compose stop postgres` killed the
      // api outright instead of degrading, which R3.1 explicitly forbids
      // ("/health returns 200 while postgres is stopped").
~~~~

### `src/infrastructure/messaging/queue-setup.ts`

#### C-359 · `QUEUE_RETRY_LIMIT` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#retries-dlq`
- **Replacement:** pg-boss counts retries after the first attempt: retryLimit 4 = 5 attempts total.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Retries and dead-letter queues”
- **Original:**

~~~~ts
/**
 * R3.5 asks for a maximum of 5 attempts; pg-boss counts retries *after* the
 * first attempt, so `retryLimit: 4` is 5 attempts total (SPEC 04 Decisions,
 * "Retries and dead-letter queues").
 */
~~~~

#### C-360 · `DLQ_RETENTION_DAYS` · **SHORTEN**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/messaging-jobs.md#retries-dlq`
- **Replacement:** DLQ jobs have no consumer. A dead-lettered job takes its retention from the DLQ it lands in, not from its source queue.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”; `specs/04-queue-worker-observability.md` › Decisions › “Retries and dead-letter queues”
- **Original:**

~~~~ts
/**
 * DLQ jobs have no consumer, so pg-boss's ordinary maintenance would
 * eventually remove them. This is the DLQ *queue's own* `retentionSeconds`
 * — a dead-lettered job copies its retention (and retry) configuration from
 * the DLQ it lands in, not from the queue it failed out of (SPEC 04 step 1
 * finding, confirmed against `pg-boss@12.33.2`'s `insertDeadLetterJob` SQL).
 */
~~~~

#### C-361 · `QUEUE_TOPOLOGY` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#queue-topology`
- **Replacement:** Single source of truth, also read by JobRunner and the DLQ gauge.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Queue topology
- **Original:**

~~~~ts
/** SPEC 04 Data model, "Queue topology". Single source of truth: also read by the JobRunner (step 4) and the DLQ gauge (step 8). */
~~~~

#### C-362 · `SCHEDULED_JOBS` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#scheduled-jobs`
- **Replacement:** Reaper and reconciliation, every minute on the worker. No DLQ: a failed tick is just the next minute's run.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Scheduled jobs
- **Original:**

~~~~ts
/**
 * SPEC 07 — the reservation reaper (R6.1) and payment reconciliation
 * (R6.2), run every minute by the worker's own scheduler
 * (`JobRunner.start()`). No `deadLetter` here (below): a failed run is
 * simply the next minute's run — a dead-letter copy of an empty tick is
 * noise.
 */
~~~~

#### C-363 · `setupQueues` · **SHORTEN**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/messaging-jobs.md#queue-topology`
- **Replacement:** Runs at boot in both processes; idempotent. Each DLQ is created before the queue that references it (pg-boss requires it).
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”
- **Original:**

~~~~ts
/**
 * Runs at boot in both processes (api and worker). Idempotent:
 * `createQueue` is a no-op when the queue already exists (verified SPEC 04
 * step 1), so a restart of either process creates nothing new. Each DLQ is
 * created before the queue that references it — pg-boss rejects a
 * `deadLetter` pointing at a queue that does not exist yet.
 */
~~~~

### `src/main.worker.ts`

#### C-399 · `bootstrap` · **KEEP**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/messaging-jobs.md#graceful-shutdown`
- **Replacement:** Without shutdown hooks, SIGTERM skips JobRunner's graceful stop and cuts in-flight jobs off mid-handler.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The worker, its connections and shutdown”
- **Original:**

~~~~ts
  // Without this, SIGTERM (docker stop) kills the process directly and
  // JobRunner.onApplicationShutdown() (boss.stop({ graceful: true })) never
  // runs — an in-flight job would be cut off mid-handler instead of
  // finishing (SPEC 04 Decisions, "The worker, its connections and
  // shutdown").
~~~~

## observability

### `src/application/jobs/helpers/tracing.helper.ts`

#### C-069 · `tracer` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#job-spans`
- **Replacement:** Same tracer name as JobRunner's root span. Only a library label — nesting comes from the active OTel context.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Same tracer name as job-runner.ts's root `job <queue>` span — this is
 * purely the instrumentation-library label a trace backend shows, not a
 * parent/child link by itself (nesting comes from the active OTel context
 * job-runner.ts already opens around `handler.handle()`).
 */
~~~~

#### C-070 · `withJobSpan` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#job-spans`
- **Replacement:** Wraps one business step of a job handler in a child span. Always rethrows after marking the span errored; batch handlers catch around it themselves.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Wraps one named business step of a job handler in its own child span, so
 * a trace backend shows what happened ("select unsettled payments",
 * "resolve payment") nested under the job's root span, instead of only the
 * raw `pg`/`pg-pool` driver spans `@opentelemetry/instrumentation-pg`
 * produces on their own.
 *
 * Always rethrows on failure (after marking the span as an error, same
 * shape as job-runner.ts's own catch) — a handler that must not abort a
 * batch over one row's failure (payment-reconciliation, reservation-reap)
 * catches around this call itself, same as it already does today.
 */
~~~~

### `src/infrastructure/config/env.schema.ts`

#### C-189 · `envSchema` · **KEEP**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#logging`
- **Replacement:** Dev-only; off by default so containers emit JSON. z.enum, not z.coerce.boolean(): the latter treats "false" as true.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Dev-only readability toggle for pino.config.ts — off (raw JSON) by
    // default so docker-compose containers, which never set it, keep
    // emitting parseable JSON lines (specs/03-external-adapters.md:334).
    // z.enum, not z.coerce.boolean(): the latter's `Boolean(str)` treats
    // any non-empty string — including the literal "false" — as true.
~~~~

### `src/infrastructure/health/health.controller.ts`

#### C-271 · `HealthController` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#health-endpoints`
- **Replacement:**
  > /health is liveness only (no DB call) so a DB blip can't cause a restart storm; /health/ready checks the database and the queue.
  > See knowledge/observability.md#health-endpoints
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Health endpoints”; `specs/01-foundation.md` › Decisions › “Runtime and operations”
- **Original:**

~~~~ts
/**
 * R0.1 acceptance criterion 4: `GET /health` returns 200 on the api. Holds
 * under multiple api instances because each answers for itself — no shared
 * state (specs/01-foundation.md, Decisions).
 *
 * SPEC 04 step 9 (Decisions, "Health endpoints") splits liveness from
 * readiness: a liveness probe that pings the database restarts every
 * healthy api instance during a 30 s database blip, turning a recoverable
 * outage into a restart storm. `/health` answers with no database call at
 * all — the process responding *is* the liveness signal — and
 * `/health/ready` takes over the database and queue checks P0's original
 * single endpoint used to run.
 */
~~~~

### `src/infrastructure/health/pg-boss.health-indicator.ts`

#### C-272 · `PgBossHealthIndicator` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#health-endpoints`
- **Replacement:** Reported separately from the database check: a real round-trip through the api's own pg-boss pool.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Scope
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "GET /health/ready checks the database and the queue" —
 * reported separately from `TypeOrmHealthIndicator`'s `database` key
 * (R3.1) even though both usually fail together, since both go through
 * Postgres. A genuine round-trip through the api's own `PgBoss` pool
 * (separate from TypeORM's, `infrastructure.md` §7) rather than assuming
 * DI resolving this provider at boot still means it is reachable now.
 */
~~~~

### `src/infrastructure/health/worker-healthcheck.ts`

#### C-273 · `main` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#health-endpoints`
- **Replacement:** Docker healthcheck for the port-less worker: readiness file plus a bare pg.Client (lighter than a DataSource).
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The worker, its connections and shutdown”
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: the worker "having no HTTP port, is checked by `node
 * dist/infrastructure/health/worker-healthcheck.js`" — this is that
 * script, wired as `docker-compose.yml`'s worker `healthcheck:`. Bare
 * `pg.Client`, not `AppDataSource`: Docker runs this on an interval
 * (`docker compose ps`, R3.8) and a lighter connection than a full
 * TypeORM `DataSource` is what a healthcheck should cost.
 */
~~~~

#### C-274 · `main` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/observability.md#health-endpoints`
- **Replacement:** (unchanged) (directive — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // eslint-disable-next-line no-console -- Docker HEALTHCHECK output; this bare script has no pino logger.
~~~~

### `src/infrastructure/health/worker-readiness.ts`

#### C-275 · `WORKER_READINESS_FILE_PATH` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/observability.md#health-endpoints`
- **Replacement:** Written at boot, removed on shutdown; checked by worker-healthcheck. A constant, not env.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Scope
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "The worker, having no HTTP port, is checked by `node
 * dist/infrastructure/health/worker-healthcheck.js`, which verifies the
 * readiness file the worker writes at boot and removes on shutdown, plus
 * database connectivity." Not an env var — nobody tunes this per
 * deployment (references/coding-conventions.md).
 */
~~~~

### `src/infrastructure/http/redaction.ts`

#### C-309 · `(module)` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** No card number or secret may reach a log line. redact() runs on every log call and on every adapter's rawResponse before it crosses a port. Pure: returns a redacted deep copy, never mutates, survives cycles.
- **Spec duplicate:** `specs/03-external-adapters.md` › Redaction rules; `specs/03-external-adapters.md` › Decisions › “Redaction and logging”
- **Original:**

~~~~ts
/**
 * SPEC 03: no card number or secret may reach a log line. `redact()` is the
 * single function every log call is run through (via the `nestjs-pino`
 * logger, see `main.ts`), and every adapter passes its `rawResponse`
 * through it before it crosses a port.
 *
 * Pure: returns a redacted deep copy, never mutates its input, and
 * survives circular references (a `WeakMap` remembers what has already
 * been cloned).
 */
~~~~

#### C-310 · `CARD_NUMBER_VALUE_PATTERN` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** (unchanged)
- **Spec duplicate:** `specs/03-external-adapters.md` › Redaction rules
- **Original:**

~~~~ts
/**
 * 13–19 digits, optionally separated by single spaces or dashes between
 * digits. Matches PANs pasted into free text; the Luhn check below filters
 * out order numbers, timestamps and other digit runs that are not cards.
 */
~~~~

#### C-311 · `redactError` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * `name`, `message` and `stack` are non-enumerable on a plain `Error`, so a
 * generic `Object.entries` walk (as `redactObject` does) would silently
 * drop them. Pulled out explicitly, then the same by-key/by-value rules
 * apply to `message` and `stack` as to any other string — an error message
 * can carry a PAN pasted from a request body.
 */
~~~~

### `src/infrastructure/logging/pino.config.ts`

#### C-314 · `PinoHttpOptions` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#logging`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * `pino-http`-only option, not part of pino's own `LoggerOptions` — see
 * the `wrapSerializers` comment below for why it has to be set.
 */
~~~~

#### C-315 · `pinoOptions` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** Every log line (Nest logger, pino-http, bootstrap catch) goes through redact() before serialisation — PANs/secrets never reach stdout. formatters.log is the choke point; mixin runs first, so redact() still has the final say over correlationId.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Redaction and logging”; `specs/04-queue-worker-observability.md` › Risks
- **Original:**

~~~~ts
/**
 * SPEC 03 step 2: every log line — Nest's own logger, `pino-http`'s
 * request/response logging on the api, and the bootstrap `catch` in
 * `main.ts`/`main.worker.ts` — runs through `redact()` before it is
 * serialised, so a PAN or a secret can never reach stdout.
 *
 * `formatters.log` is pino's own hook for the object passed to a call like
 * `logger.info(object)`, run before pino adds `level`/`time`/`pid` and
 * serialises to JSON — the single choke point this relies on. Shared by
 * `LoggerModule.forRoot()` in `SharedModule` and by this file's own test,
 * which builds a raw `pino()` instance over an in-memory stream with these
 * same options.
 *
 * SPEC 04 step 7: `mixin` runs first and pino merges its return value into
 * the log object *before* `formatters.log` sees it, so `redact()` still
 * has the final say over the whole line — `correlationId` is the only
 * field this ever adds, and it is always either the sanitised inbound
 * header or a generated UUID (`correlation.middleware.ts`), never
 * arbitrary data (SPEC 04 Risks, "The pino mixin adds fields that bypass
 * redact()"). `trace_id`/`span_id` come from `PinoInstrumentation`
 * (`tracing.ts`), not from here.
 */
~~~~

#### C-317 · `pinoOptions` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#logging`
- **Replacement:** Off by default so containers emit JSON; pino-pretty only for local dev.
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // LOG_PRETTY (env.schema.ts) — off by default so docker-compose
  // containers keep emitting raw JSON; only a local dev shell that sets it
  // gets pino-pretty's colorized, HH:MM:ss output.
~~~~

#### C-318 · `pinoOptions.hooks` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** formatters.log only sees the merge object; message strings, interpolation args and positional Errors bypass it, and logMethod covers those. A merge object at position 0 is skipped: redact() isn't idempotent, so redacting twice corrupts it.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions (pino hooks.logMethod); `specs/07-hardening-demo.md` › Fix A — redaction
- **Original:**

~~~~ts
    // SPEC 07 Fix A: `formatters.log` only sees the merge object — the
    // message string (`logger.info('… 4242… failed')`), printf-style
    // interpolation values, and an `Error` passed positionally all bypass
    // it. `logMethod` is pino's hook over the raw positional arguments,
    // before it builds the line, so together with `formatters.log` above
    // it covers the whole line.
    //
    // A plain merging object at position 0 (`logger.info({ cardNumber },
    // 'msg')`) is left alone here: `formatters.log` already redacts it once
    // it is merged into the log object, and `redact()`'s key-based masking
    // is not idempotent (`maskCardValue` strips the mask's own `*`
    // characters as "not a digit" and remasks just the last four), so
    // redacting it twice corrupts it.
~~~~

### `src/infrastructure/messaging/job-runner.ts`

#### C-338 · `tracer` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#job-spans`
- **Replacement:** Each job gets its own trace, linked to the publishing span (OTel messaging convention). The tracer name is cosmetic.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Correlation and tracing”
- **Original:**

~~~~ts
/**
 * SPEC 04 Decisions, "Correlation and tracing": each job gets its own
 * trace, linked to the publishing span, rather than being a child span of
 * the request — OpenTelemetry's messaging convention. The tracer name is
 * cosmetic (shows up as the instrumentation library in a trace backend).
 */
~~~~

#### C-343 · `JobRunner.start` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** The span status message isn't an attribute, so the span exporter doesn't redact it — redact it here.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Fix A — redaction
- **Original:**

~~~~ts
                // SPEC 07 Fix A: the status message is not a span
                // attribute, so RedactingSpanExporter does not cover it —
                // redact it here instead.
~~~~

#### C-345 · `JobRunner.start` · **KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/observability.md#health-endpoints`
- **Replacement:** Write the readiness file only once every queue has a worker and the gauge is live — the healthcheck treats its existence as ready.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Boot is only "done" once every queue has a registered worker and the
    // gauge is live — worker-healthcheck.js (R3.8) treats this file's mere
    // existence as "ready".
~~~~

### `src/infrastructure/messaging/pg-boss-event-publisher.ts`

#### C-349 · `captureTraceparent` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#trace-propagation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Injects the active OTel span (if any) into a plain carrier via the
 * globally-registered W3C propagator (`tracing.ts`'s `NodeSDK` registers
 * it), then reads back the `traceparent` field it wrote — `null` when no
 * span is active, matching `JobMeta.traceparent`'s own contract.
 */
~~~~

#### C-351 · `PgBossEventPublisher.publish` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#correlation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // getCorrelationId() reads the AsyncLocalStorage the api's
    // CorrelationMiddleware (or the JobRunner, when a handler itself
    // publishes) already populated; a publish from outside any tracked
    // context (a script) still gets a fresh id rather than "undefined".
~~~~

### `src/infrastructure/observability/correlation.middleware.ts`

#### C-364 · `CORRELATION_ID_MAX_LENGTH` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/observability.md#correlation`
- **Replacement:** (none)
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Named constants
- **Original:**

~~~~ts
/** SPEC 04 Named constants — correlation middleware. */
~~~~

#### C-365 · `CorrelationMiddleware` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#correlation`
- **Replacement:** Honours a valid inbound X-Correlation-Id, else generates one; stores it for the request and echoes it back.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Correlation and tracing”
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: honours an inbound `X-Correlation-Id` when valid
 * (`isValidCorrelationId`), generates a UUID otherwise, stores it in
 * `correlationStorage` for the rest of the request, and echoes it back —
 * so a client or gateway that already has its own identifier can search
 * its logs and ours with the same string (Decisions, "Correlation and
 * tracing").
 */
~~~~

### `src/infrastructure/observability/correlation.ts`

#### C-366 · `CorrelationStore` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/observability.md#correlation`
- **Replacement:** Written by the correlation middleware and JobRunner; read by the pino mixin and PgBossEventPublisher.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Correlation context
- **Original:**

~~~~ts
/**
 * SPEC 04 Data model, "Correlation context". Written by the api's
 * correlation middleware and by the `JobRunner` (restoring a job's
 * publishing-time id); read by the pino `mixin` and by
 * `PgBossEventPublisher`.
 */
~~~~

### `src/infrastructure/observability/dlq-gauge.ts`

#### C-369 · `registerDlqGauge` · **MOVE**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/observability.md#dlq-gauge`
- **Replacement:**
  > queue.dlq.size{queue} gauge, sampled by the metric reader. Uses getQueueStats({ force: true }) because getQueue() is stale; the 60 s throttle matches the sampling interval.
  > See knowledge/observability.md#dlq-gauge
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Scope; `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "One OTel observable gauge, `queue.dlq.size{queue}`, read
 * from pg-boss's queue statistics — the single deliberate exception to
 * 'no business metrics'." Sampled by `tracing.ts`'s `PeriodicExportingMetricReader`
 * (`DLQ_GAUGE_INTERVAL_MS`), which is what actually decides when this
 * callback runs — nothing here schedules its own timer.
 *
 * `getQueueStats(name, { force: true })`, not `getQueue(name)`: SPEC 04
 * step 1 finding — `getQueue()` reads a column on `pgboss.queue` that
 * pg-boss's own monitor refreshes on its own cadence, stale by tens of
 * seconds; `getQueueStats({ force: true })` recomputes from the job table
 * on demand. It does throttle repeated calls to once per 60 s per queue
 * (`QUEUE_STATS_FORCE_TTL_SECONDS`), which is exactly this gauge's own
 * sampling cadence, so every scheduled collection here gets a genuinely
 * fresh read — the throttle only bites a *tighter* poll loop than this
 * one (confirmed the hard way in `job-runner.integration.spec.ts`, step 6).
 */
~~~~

### `src/infrastructure/observability/redacting-span-exporter.ts`

#### C-370 · `RedactingSpanExporter` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** Redacts every span and event attribute at export, including auto-instrumented ones. Span status messages aren't attributes — job-runner redacts those itself.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions (redaction at the span exporter); `specs/07-hardening-demo.md` › Fix A — redaction
- **Original:**

~~~~ts
/**
 * SPEC 07 Fix A: `formatters.log`/`hooks.logMethod` (`pino.config.ts`) cover
 * every log line, but spans have no redaction at all — `job-runner.ts`'s
 * `span.recordException(error)` stores the raw exception message and stack
 * as event attributes, and an auto-instrumented span (`HttpInstrumentation`,
 * `PgInstrumentation`) can carry a PAN or a secret in an attribute too.
 * Wrapping the exporter is one choke point for every span and event
 * attribute, including ones this codebase never explicitly sets.
 *
 * A span's status `message` is not an attribute — it is not covered here;
 * `job-runner.ts` redacts it itself before calling `span.setStatus()`.
 */
~~~~

#### C-371 · `redactSpan` · **KEEP** · **MUST-KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** (unchanged)
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions ("No: a SpanProcessor.onEnd…")
- **Original:**

~~~~ts
/**
 * `ReadableSpan.spanContext` (and any other method the concrete span class
 * defines) lives on the prototype, not as an own property — a plain object
 * spread would drop it, and the OTLP serializer calls `spanContext()` on
 * every span it exports. `Object.create` preserves the prototype chain;
 * `Object.assign` then copies the own properties over it, and `attributes`/
 * `events` are overwritten with their redacted versions.
 */
~~~~

### `src/infrastructure/observability/tracing.ts`

#### C-372 · `DLQ_GAUGE_INTERVAL_MS` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/observability.md#dlq-gauge`
- **Replacement:** How often the DLQ gauge is sampled (drives the metric reader's export interval).
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Named constants
- **Original:**

~~~~ts
/**
 * SPEC 04 Named constants — observability: how often the DLQ gauge
 * (`dlq-gauge.ts`) is sampled. Drives the metrics pipeline's own export
 * interval, since an OTel observable instrument is only ever read when
 * its reader asks for a collection.
 */
~~~~

#### C-373 · `isWorker` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#tracing-bootstrap`
- **Replacement:** Must be the first import of main.ts/main.worker.ts: auto-instrumentation patches http/pg on require(), so anything imported earlier stays un-instrumented, and no lint rule can catch it. Reads process.env directly (runs before ConfigModule).
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Risks
- **Original:**

~~~~ts
/**
 * SPEC 04 Scope: "OpenTelemetry Node SDK with auto-instrumentation for
 * HTTP, pg and pino, exporting OTLP to OTEL_EXPORTER_OTLP_ENDPOINT.
 * Imported as the first line of main.ts and main.worker.ts, before any
 * other import." It must stay first: auto-instrumentation works by
 * patching the `http`/`pg` modules the moment they are `require()`d, so
 * anything imported earlier that pulls those modules in first (Nest,
 * TypeORM, pg-boss...) leaves them silently un-instrumented (SPEC 04
 * Risks) — no `no-restricted-imports` rule can catch an import *order*
 * mistake, only a reviewer reading this comment can.
 *
 * `OTLPTraceExporter` and `NodeSDK`'s defaults already read
 * `OTEL_EXPORTER_OTLP_ENDPOINT`/other `OTEL_*` env vars directly — this
 * file runs before `ConfigModule` exists, so it reads `process.env` the
 * same way env.schema.ts's own validation will, a few lines later once
 * `main.ts`/`main.worker.ts` actually boot Nest.
 */
~~~~

#### C-374 · `sdk` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#tracing-bootstrap`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // Metrics only on the worker: it's the only process that registers the
  // DLQ gauge (dlq-gauge.ts, called from JobRunner.start()). The api
  // never creates an observable instrument, so a reader here would just
  // export empty collections on a timer for nothing.
~~~~

#### C-375 · `sdk.instrumentations` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/observability.md#tracing-bootstrap`
- **Replacement:** disableLogSending: logs stay on stdout; this only injects trace_id/span_id into pino lines.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Correlation and tracing ("No: exporting logs to Loki")”
- **Original:**

~~~~ts
    // disableLogSending: true — logs stay on stdout only (Decisions, "No:
    // exporting logs to Loki"); this instrumentation's job here is only
    // to inject trace_id/span_id into every pino line (its default
    // logKeys already match those field names).
~~~~

#### C-376 · `(module)` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/observability.md#tracing-bootstrap`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
// NodeSDK's own doc comment: "Use the shutdown handler to ensure your
// telemetry is exported before the process exits." The worker already
// waits out an in-flight job on SIGTERM (JobRunner.onApplicationShutdown,
// GRACEFUL_SHUTDOWN_TIMEOUT_MS) — this makes sure that job's own spans
// still reach the collector instead of being dropped mid-batch.
~~~~

### `src/main.ts`

#### C-384 · `(module)` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#tracing-bootstrap`
- **Replacement:** Must be the first import — see tracing.ts.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Risks
- **Original:**

~~~~ts
// SPEC 04 step 7: must be the first import — see tracing.ts's own comment
// on why (auto-instrumentation patches http/pg by hooking their
// require(), so anything imported before this leaves them
// un-instrumented).
~~~~

#### C-388 · `bootstrap` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** Every log line from here on goes through redact().
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Redaction and logging”
- **Original:**

~~~~ts
  // SPEC 03 step 2: every log line from here on — app logs, and
  // pino-http's own request/response logging — goes through redact()
  // (SharedModule's LoggerModule.forRoot(pinoOptions)).
~~~~

#### C-395 · `bootstrap` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** (unchanged) (directive — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
~~~~

### `src/main.worker.ts`

#### C-396 · `(module)` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#tracing-bootstrap`
- **Replacement:** Must be the first import — see tracing.ts.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Risks
- **Original:**

~~~~ts
// SPEC 04 step 7: must be the first import — see tracing.ts's own comment
// on why (auto-instrumentation patches http/pg by hooking their
// require(), so anything imported before this leaves them
// un-instrumented).
~~~~

#### C-398 · `bootstrap` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** Same redacting pino logger as the api.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Redaction and logging”
- **Original:**

~~~~ts
  // SPEC 03 step 2: same redacting pino logger as the api (SharedModule's
  // LoggerModule.forRoot(pinoOptions)).
~~~~

#### C-401 · `bootstrap` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** (unchanged) (directive — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // eslint-disable-next-line no-console -- last resort: the pino logger may not exist yet if boot itself failed. redact() still guards this line.
~~~~

### `src/modules/shared.module.ts`

#### C-404 · `SharedModule.register.imports` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/observability.md#redaction`
- **Replacement:** Every log object runs through redact() before serialisation.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Redaction and logging”
- **Original:**

~~~~ts
        // SPEC 03 step 2: every log object — Nest's own logger, pino-http's
        // request/response logging, and future adapters — runs through
        // redact() before it is serialised (pinoOptions).
~~~~

## http-payments

### `payments-mock/src/card.ts`

#### C-000 · `cardLast4` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Last four digits of a PAN — the only part of the card this service ever stores or returns. */
~~~~

### `payments-mock/src/charge.service.ts`

#### C-001 · `IDEMPOTENCY_KEY_REUSED` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** `422 idempotency_key_reused`: the key was already used with a different body. */
~~~~

#### C-002 · `ChargeService` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** In-memory store of charges plus a map of in-flight promises (a second request with the same key awaits the first). One instance per process; state is lost on restart — accepted for a mock.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “`payments-mock` semantics”
- **Original:**

~~~~ts
/**
 * SPEC 03: the mock's whole state machine — an in-memory `Map` of stored
 * charges, a second `Map` of in-flight promises for "a second request with
 * the same key awaits the first one's result", and the card-keyed outcome
 * table. One instance per process; state is lost on restart, accepted as a
 * mock limitation (spec's Risks).
 */
~~~~

#### C-003 · `ChargeService.process` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** Other cards replay the stored response instantly for a repeated key. A different body under the same key is a reuse (422), not a replay.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “`payments-mock` semantics”
- **Original:**

~~~~ts
    // Every other card replays its stored response for a repeated key —
    // instantly, no re-delay, no reprocessing. A different body under the
    // same key is a reuse, not a replay.
~~~~

#### C-004 · `ChargeService > processCard0004` · **MOVE**

- **Category:** rationale, invariant
- **Knowledge target:** `knowledge/http-payments.md#card-0004`
- **Replacement:**
  > Card 0004: recorded as approved on arrival, then delays on every request (replays included); the body-mismatch check runs only after the delay.
  > See knowledge/http-payments.md#card-0004
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “`payments-mock` semantics”
- **Original:**

~~~~ts
  /**
   * `0004`: the delay is checked before the idempotency lookup. The charge
   * is recorded as approved the moment it arrives — before the delay —
   * so a concurrent `GET` already sees it while this `POST` is still
   * pending. The delay then runs unconditionally, on every request for
   * this key, replays included: the normal "already stored, replay
   * instantly" shortcut above never applies to this card. Only once the
   * delay is over does it check whether this request's body still matches
   * what was recorded — a same-key-different-body request against `0004`
   * still ends in `422`, just after paying the delay first.
   */
~~~~

### `payments-mock/src/constants.ts`

#### C-005 · `CARD_DECLINED_LAST4` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** Outcomes are keyed on the card's last four digits. Mock-local literals: this package never imports from the main app's src/.
- **Spec duplicate:** `specs/03-external-adapters.md` › `payments-mock` wire contract; `engineering:documentation/infrastructure.md` › 4. Why `payments-mock` is its own container
- **Original:**

~~~~ts
/**
 * SPEC 03 (wire contract): outcomes are keyed on the card's last four
 * digits. These are the mock's own literals, distinct from
 * `PAYMENT_FAILURE_CODES` in the main app — this package never imports
 * from `src/` (it is a separate provider, `infrastructure.md` §4).
 */
~~~~

#### C-006 · `CARD_0004_DELAY_MS` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#card-0004`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * How long a `0004` charge hangs before answering, on every request —
 * first attempt and every replay. Overridable per `buildServer()` call so
 * tests do not wait 30 s for real.
 */
~~~~

#### C-007 · `APPROVED_DELAY_MIN_MS` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** Simulated latency for an ordinary approval (200–600 ms).
- **Spec duplicate:** `specs/03-external-adapters.md` › `payments-mock` wire contract
- **Original:**

~~~~ts
/** Simulated latency for an ordinary approval: "200–600 ms" per the spec. */
~~~~

### `payments-mock/src/hash.ts`

#### C-008 · `computeRequestHash` · **KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * The fingerprint behind `422 idempotency_key_reused`: `sha256` of
 * `last4|amountCents|currency|description`. The full card number is never
 * part of it — nor stored anywhere in this service.
 */
~~~~

### `payments-mock/src/main.ts`

#### C-009 · `(module)` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged) (directive — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // eslint-disable-next-line no-console -- payments-mock has no card data reaching this line, and no redacting logger of its own (it is a standalone mock, not part of the main app).
~~~~

### `payments-mock/src/server.ts`

#### C-011 · `buildServer` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** App builder: tests build a fresh instance per test with injectable delays (fastify.inject(), no socket); main.ts builds the one that listens.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Packaging, tests and CI”
- **Original:**

~~~~ts
/**
 * SPEC 03: the app builder, so tests build a fresh instance per test with
 * injectable delays (via `fastify.inject()`, no listening socket needed)
 * and `main.ts` builds one production instance that actually listens.
 */
~~~~

### `payments-mock/src/types.ts`

#### C-012 · `ChargeRecord` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** What the store keeps for a completed, stored charge (never a `500`). */
~~~~

#### C-013 · `ChargeResponseBody` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** `POST /charge`'s 200/402 response body. */
~~~~

#### C-014 · `ChargeStatusResponseBody` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/http-payments.md#payments-mock`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** `GET /charge/:idempotencyKey`'s 200 response body. */
~~~~

### `src/domain/ports/payment-failure-codes.ts`

#### C-172 · `PAYMENT_FAILURE_CODES` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#failure-codes`
- **Replacement:** Pins ChargeResult.failureCode values. In the domain so the application never imports infrastructure.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Payment outcome classification”; `references/layering.md`
- **Original:**

~~~~ts
/**
 * SPEC 03: pins `ChargeResult.failureCode`'s values. Additive, beside the
 * frozen `payment-gateway.ts` port — P4 imports it from here, never from
 * `src/infrastructure/**` (`references/layering.md`: the application layer
 * cannot import infrastructure).
 */
~~~~

### `src/domain/ports/payment-gateway.ts`

#### C-173 · `ChargeCommand` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#port`
- **Replacement:** Flat primitives, not Money: this crosses to an external HTTP provider that expects wire-format JSON.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-4 — Payment (mocked)
- **Original:**

~~~~ts
/**
 * FR-4's exact field list: `charge({ cardNumber, amountMinor, currency,
 * description, idempotencyKey })`. Flat primitives, not a `Money` value
 * object — this crosses the boundary to an external HTTP payment provider
 * that expects wire-format JSON, not a domain type.
 */
~~~~

#### C-174 · `ChargeCommand > idempotencyKey` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/http-payments.md#port`
- **Replacement:** Derived from order id + attempt so a retry can never double-charge.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
  /** Derived from the order id + attempt (FR-5) so a retry can never double-charge. */
~~~~

#### C-175 · `ChargeResult` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/http-payments.md#port`
- **Replacement:** Enough to persist a payments row and choose the next transition. UNKNOWN (e.g. timeout) is resolved later by reconciliation.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-4; `engineering:documentation/architectural-requirements.md` › FR-5
- **Original:**

~~~~ts
/**
 * Enough to persist a `payments` row and decide the order's next
 * transition. `status` reuses the domain's own PaymentStatus — including
 * `UNKNOWN` for a provider timeout, resolved later by reconciliation
 * (FR-4/FR-5).
 */
~~~~

#### C-176 · `ChargeResult > rawResponse` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/http-payments.md#port`
- **Replacement:** Redacted gateway payload, opaque to the domain — never the full PAN.
- **Spec duplicate:** `specs/03-external-adapters.md` › Redaction rules
- **Original:**

~~~~ts
  /** Redacted gateway payload, opaque to the domain — never the full PAN (FR-4). */
~~~~

#### C-177 · `PaymentGateway` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/http-payments.md#port`
- **Replacement:** Implemented by HttpPaymentGateway; used by the saga's charge phase and by reconciliation. (Current text names a non-existent MockPaymentGateway.)
- **Spec duplicate:** `specs/01-foundation.md` › Port interfaces, frozen
- **Original:**

~~~~ts
/**
 * R0.6 (frozen contract). Implemented by P2 (`MockPaymentGateway`,
 * deterministic by card number per FR-4's outcome table) and consumed by
 * P4's payment phase and the reconciliation job (FR-5).
 */
~~~~

### `src/infrastructure/geocoding/geoapify-geocoding.provider.ts`

#### C-258 · `ATTEMPT_TIMEOUT_MS` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/http-payments.md#resilience`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** payments, geoapify — the per-attempt `AbortSignal.timeout`. */
~~~~

### `src/infrastructure/http/circuit-breaker.ts`

#### C-276 · `CircuitOpenError` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/http-payments.md#circuit-breaker`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Thrown by `execute()` when the breaker rejects a call outright. Infrastructure-internal — never crosses a port. */
~~~~

#### C-277 · `CircuitBreaker` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#circuit-breaker`
- **Replacement:**
  > Three-state breaker, one per provider. Counts every failed attempt (not every call); whatever the operation throws is a failure, so callers resolve non-failures like 402/404.
  > See knowledge/http-payments.md#circuit-breaker
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Circuit breaker”
- **Original:**

~~~~ts
/**
 * SPEC 03: hand-written, three states, one breaker per provider
 * (`HttpPaymentGateway`'s `charge()`/`getStatus()` share one; Geoapify has
 * its own). Counts each failed *attempt* — every `execute()` call whose
 * operation throws — not each exhausted retry loop; `retry.ts` calls
 * `execute()` once per attempt, so five failed attempts can come from as
 * few as two orders (Decisions).
 *
 * `execute()` takes no failure classifier: whatever the operation throws
 * counts as a failure, whatever it resolves counts as a success. The
 * caller (`HttpPaymentGateway`/`GeoapifyGeocodingProvider`) decides what
 * that means — a 402 or a 404 from `getStatus` resolves normally and
 * never reaches here as a failure, only a 5xx, a network error or a
 * timeout does.
 */
~~~~

#### C-278 · `CircuitBreaker.execute` · **KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/http-payments.md#circuit-breaker`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Exactly one probe through; a concurrent second call is rejected
      // outright — set synchronously, before the first `await`, so two
      // calls made back to back can never both see it unset.
~~~~

### `src/infrastructure/http/fetch-errors.ts`

#### C-296 · `classifyFetchError` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#fetch-errors`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Classifies whatever `fetch`/`AbortSignal.timeout` throws. Deliberately
 * duck-typed (`.name`, `.cause.code`) instead of `instanceof
 * DOMException`/`instanceof Error`: Node's native `fetch` (undici) and a
 * test runner's sandboxed global scope (Jest's `jest-environment-node`
 * gives each test file its own realm) can disagree on which `Error`/
 * `DOMException` constructor an error was built with, making `instanceof`
 * unreliable across that boundary — property reads are not. Shared by
 * `HttpPaymentGateway` and `GeoapifyGeocodingProvider`, the two adapters
 * that call `fetch` directly.
 */
~~~~

#### C-297 · `classifyFetchError` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#fetch-errors`
- **Replacement:** Unknown shapes fall back to network_error; callers map that to UNKNOWN, so the fallback is safe.
- **Spec duplicate:** `specs/03-external-adapters.md` › Risks
- **Original:**

~~~~ts
  // Unknown shapes fall back to network_error — the caller still maps
  // this to its own UNKNOWN/PROVIDER_UNAVAILABLE-style outcome, so the
  // fallback is safe (Risks).
~~~~

### `src/infrastructure/http/retry.ts`

#### C-312 · `MAX_ATTEMPTS` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#resilience`
- **Replacement:** Full-jitter exponential backoff, retrying only what the caller's isTransient marks transient. CircuitOpenError needs no special case: not transient means immediate return.
- **Spec duplicate:** `specs/03-external-adapters.md` › Resilience primitives; `specs/03-external-adapters.md` › Decisions › “Retries and timeouts”
- **Original:**

~~~~ts
/**
 * SPEC 03: up to `maxAttempts`, full-jitter exponential backoff, retrying
 * only what the caller's `isTransient` predicate marks transient. Used by
 * both `HttpPaymentGateway` and `GeoapifyGeocodingProvider`, each with its
 * own predicate and its own `circuit-breaker.ts` instance.
 *
 * `CircuitOpenError` (circuit-breaker.ts) needs no special case here: a
 * caller's `isTransient` simply returns `false` for it, and "not transient"
 * already means an immediate return with no further attempt and no delay —
 * which is exactly the early exit the breaker requires.
 */
~~~~

#### C-313 · `withRetry` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#resilience`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Runs `operation`, retrying it while `isTransient` says the last result —
 * a resolved value or a thrown error — was worth retrying. The last
 * attempt always surfaces its own outcome, transient or not: a resolved
 * value is returned, a thrown error is rethrown. There is no wrapping
 * "gave up after N attempts" error — the caller already gets the exact
 * outcome its own classification produced.
 */
~~~~

### `src/infrastructure/payments/card.ts`

#### C-377 · `describeCard` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#card-description`
- **Replacement:** Derived from the PAN locally: provider responses are missing on exactly the rows reconciliation needs. Keep the prefix-range list.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Card data and the idempotency key”; `specs/03-external-adapters.md` › Card description
- **Original:**

~~~~ts
/**
 * SPEC 03: `cardLast4`/`cardBrand` are derived locally from the PAN, not
 * read off the provider's response — the alternative leaves them `null`
 * on exactly the rows reconciliation needs (a timeout, a `500`, an open
 * breaker), since no response ever arrived to read them from.
 *
 * Prefix ranges: Visa `4` · Mastercard `51`–`55`, `2221`–`2720` · Amex
 * `34`, `37` · Discover `6011`, `644`–`649`, `65` · anything else
 * `'unknown'`.
 */
~~~~

### `src/infrastructure/payments/http-payment-gateway.ts`

#### C-380 · `ATTEMPT_TIMEOUT_MS` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/http-payments.md#resilience`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** payments, geoapify — the per-attempt `AbortSignal.timeout`. */
~~~~

#### C-381 · `RetryableProviderError` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/http-payments.md#resilience`
- **Replacement:** Transient fetch failures that retry.ts recognises. CircuitOpenError isn't one: retrying it is pointless.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Circuit breaker”
- **Original:**

~~~~ts
/**
 * Base for every failure `fetch` itself can produce — the shared marker
 * `retry.ts`'s `isTransient` recognises. `CircuitOpenError`
 * (`circuit-breaker.ts`) is deliberately not one of these: it is not
 * transient, so retrying it would be pointless (Decisions).
 */
~~~~

#### C-382 · `HttpPaymentGateway` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/http-payments.md#http-payment-gateway`
- **Replacement:** Never throws on a provider failure — every branch resolves a ChargeResult, so callers need no try/catch. charge() and getStatus() share one breaker and retry policy.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Payment outcome classification”; `specs/03-external-adapters.md` › Decisions › “Circuit breaker”
- **Original:**

~~~~ts
/**
 * SPEC 03. Implements P0's `PaymentGateway` against `payments-mock` (or any
 * provider speaking its wire contract) with native `fetch`. Never throws on
 * a provider failure — every branch below resolves to a `ChargeResult`,
 * classification is total, so P4 can switch on `status` without a
 * `try/catch` that might swallow a programming error (Decisions).
 *
 * `charge()` and `getStatus()` share one breaker and one retry policy:
 * they hit the same host, and per-attempt counting means five failed
 * attempts can come from as few as two orders.
 */
~~~~

#### C-383 · `mapStatusResponse` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/http-payments.md#http-payment-gateway`
- **Replacement:** Only recognised answers map to CAPTURED/DECLINED; anything unexpected is UNKNOWN, never a guess — reconciliation trusts this.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions; `specs/07-hardening-demo.md` › Fix B — `getStatus()` classification
- **Original:**

~~~~ts
/**
 * SPEC 07 Fix B: every non-`404` answer used to map to `CAPTURED` — a
 * `400`, `401`, `422`, `429` or a `200` with an unexpected body all read as
 * "the customer was charged". Reconciliation (R6.2) trusts this function,
 * so an unrecognised answer must be `UNKNOWN`, never a guess (Decisions).
 */
~~~~

## database

### `src/infrastructure/database/data-source.ts`

#### C-193 · `config` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#data-source`
- **Replacement:** TypeORM CLI entrypoint (migration:*). Runs outside Nest, so it validates process.env with the same Zod schema.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * TypeORM CLI entrypoint — `npm run migration:run` / `migration:generate` /
 * `migration:revert` all point here via `typeorm-ts-node-commonjs -d
 * <this file>`. Runs standalone, outside Nest's DI container, so it
 * validates `process.env` directly through the same Zod schema the app
 * uses at boot (env.schema.ts) rather than duplicating a second, looser
 * check.
 */
~~~~

#### C-194 · `AppDataSource > synchronize` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** synchronize: false everywhere — migrations are the only way the schema changes.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Migrations and schema”
- **Original:**

~~~~ts
  // R0.4: synchronize: false in every environment. Migrations are the only
  // way the schema changes.
~~~~

### `src/infrastructure/database/entities/customer.orm-entity.ts`

#### C-195 · `CustomerOrmEntity` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Reference data: read, never mutated. Used directly, no domain class.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”; `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
/**
 * Mirrors `customers` (migration, step 7). Pre-existing reference data —
 * read but never mutated by this service (data-model.dbml note). No domain
 * mirror: R0.5 keeps only Order/OrderItem as rich domain classes; this
 * table is used directly, no mapper.
 */
~~~~

### `src/infrastructure/database/entities/idempotency-key.orm-entity.ts`

#### C-196 · `IdempotencyState` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Mirrors the idempotency_state enum. Infrastructure-only, not a domain enum.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * Mirrors the `idempotency_state` Postgres enum (migration, step 7). Not a
 * domain enum-type: never part of R0.5's frozen list.
 */
~~~~

#### C-197 · `IdempotencyKeyOrmEntity` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** No domain class: insert-first / replay-on-duplicate lives in idempotency.repository.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * Mirrors `idempotency_keys` (migration, step 8). No domain mirror (R0.5):
 * its own mechanics — insert-first, replay on duplicate — live in a small
 * repository (FR-6), not an in-memory domain class.
 */
~~~~

### `src/infrastructure/database/entities/inventory-movement.orm-entity.ts`

#### C-198 · `InventoryMovementType` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Mirrors the inventory_movement_type enum. Infrastructure-only, not a domain enum.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * Mirrors the `inventory_movement_type` Postgres enum (migration, step 7).
 * Not a domain enum-type: this audit ledger has no mirror in
 * src/domain/enum-types/ — it was never part of R0.5's frozen list, unlike
 * order/payment/shipment status and product condition.
 */
~~~~

#### C-199 · `InventoryMovementOrmEntity` · **KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Append-only ledger: never updated, never deleted.
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes); `references/data-integrity.md`
- **Original:**

~~~~ts
/**
 * Mirrors `inventory_movements` (migration, step 8) — an append-only
 * ledger, never updated, never deleted (data-model.dbml note). No domain
 * mirror (R0.5): written inside the inventory repository, not an
 * in-memory invariant.
 */
~~~~

#### C-200 · `InventoryMovementOrmEntity > id` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // Matches the migration's `bigint GENERATED ALWAYS AS IDENTITY`. TypeORM
  // returns bigint columns as strings, since a real bigint can exceed
  // Number.MAX_SAFE_INTEGER — left as string, no bigintNumberTransformer
  // here: unlike the money columns, this ID has no reason to stay within
  // safe-integer range.
~~~~

### `src/infrastructure/database/entities/order-item.orm-entity.ts`

#### C-202 · `OrderItemOrmEntity` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Maps to OrderItem via order.mapper. quantity > 0 is enforced by a CHECK and by OrderItem's constructor.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Mirrors `order_items` (migration, step 8) column for column. Maps to the
 * OrderItem domain class (src/domain/entities/order-item.ts) via
 * order.mapper.ts — `quantity > 0` is enforced by the CHECK constraint in
 * the migration and, independently, by OrderItem's own constructor guard.
 */
~~~~

### `src/infrastructure/database/entities/order.orm-entity.ts`

#### C-203 · `ORDER_STATUS_VALUES` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Runtime mirror of order_status (TypeORM's enum option needs an array). Also used by ListOrdersQueryDto.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Runtime mirror of the `order_status` enum (migration, step 7) — TypeORM's `enum` column option needs an actual array, not just a type. Exported so `ListOrdersQueryDto` (specs/06-read-side.md) can validate `status` against it without duplicating the enum. */
~~~~

#### C-204 · `OrderOrmEntity` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** No business rules here; Order owns the state machine (converted by order.mapper). shippingLocation is a GeoPoint (see geo-point.ts).
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Mirrors `orders` (migration, step 8) column for column. No business
 * rules here — the Order domain class (src/domain/entities/order.ts) is
 * the one with the state machine; order.mapper.ts converts between them.
 *
 * `shippingLocation` is a GeoPoint — see geo-point.ts and
 * warehouse.orm-entity.ts's `location` for what TypeORM actually
 * returns/accepts here, verified directly against a live database.
 */
~~~~

### `src/infrastructure/database/entities/payment.orm-entity.ts`

#### C-205 · `PAYMENT_STATUS_VALUES` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Runtime mirror of payment_status (TypeORM's enum option needs an array).
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Runtime mirror of the `payment_status` enum (migration, step 7) — TypeORM's `enum` column option needs an actual array, not just a type. */
~~~~

#### C-206 · `PaymentOrmEntity` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** No domain class; only a status update beyond the insert.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * Mirrors `payments` (migration, step 8). No domain mirror (R0.5):
 * inserted, never mutated by this service's own logic beyond a status
 * update — "folded into orders" per R0.5's table.
 */
~~~~

### `src/infrastructure/database/entities/product.orm-entity.ts`

#### C-207 · `PRODUCT_CONDITION_VALUES` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Runtime mirror of product_condition (TypeORM's enum option needs an array).
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Runtime mirror of the `product_condition` enum (migration, step 7) — TypeORM's `enum` column option needs an actual array, not just a type. */
~~~~

#### C-208 · `ProductOrmEntity` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** No domain class: only read inside other queries.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * Mirrors `products` (migration, step 7). No domain mirror (R0.5): read
 * inside other queries, no invariant of its own to guard in memory.
 */
~~~~

### `src/infrastructure/database/entities/shipment.orm-entity.ts`

#### C-209 · `SHIPMENT_STATUS_VALUES` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** Runtime mirror of shipment_status (TypeORM's enum option needs an array).
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Runtime mirror of the `shipment_status` enum (migration, step 7) — TypeORM's `enum` column option needs an actual array, not just a type. */
~~~~

#### C-210 · `ShipmentOrmEntity` · **SHORTEN**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/database.md#entities`
- **Replacement:** No domain class: UNIQUE(order_id) is what makes the shipment handler idempotent.
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
/**
 * Mirrors `shipments` (migration, step 8). No domain mirror (R0.5): its
 * only rule is the `UNIQUE(order_id)` constraint in the migration, which
 * is what makes the worker's handler idempotent, not in-memory logic.
 */
~~~~

### `src/infrastructure/database/entities/warehouse.orm-entity.ts`

#### C-211 · `WarehouseOrmEntity` · **SHORTEN**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/database.md#geography-columns`
- **Replacement:** location is a GeoPoint (see geo-point.ts). latitude/longitude are GENERATED columns — insert/update false because Postgres rejects writes to them.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Migrations and schema”
- **Original:**

~~~~ts
/**
 * Mirrors `warehouses` (migration, step 7). No domain mirror (R0.5): this
 * is the selection-query repository's table (P1), not an in-memory
 * invariant.
 *
 * `location` is a GeoPoint — see geo-point.ts for what TypeORM actually
 * returns/accepts for a `geography` column once `spatialFeatureType`/`srid`
 * are declared, verified directly against a live database.
 *
 * `latitude`/`longitude` are `insert: false, update: false`: Postgres
 * itself rejects writes to them (GENERATED ALWAYS ... STORED, verified in
 * step 7/8), so TypeORM is told the same thing up front rather than
 * discovering it from a rejected query.
 */
~~~~

### `src/infrastructure/database/interfaces/geo-point.ts`

#### C-212 · `GeoPoint` · **MOVE**

- **Category:** verification-note, rationale, invariant
- **Knowledge target:** `knowledge/database.md#geography-columns`
- **Replacement:**
  > TypeORM returns/accepts geography(Point, 4326) as a GeoJSON Point once spatialFeatureType/srid are set. Order is [longitude, latitude].
  > See knowledge/database.md#geography-columns
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * The shape TypeORM's postgres driver actually returns (and accepts on
 * write, via `repository.save()`) for a `geography(Point, 4326)` column
 * once `spatialFeatureType`/`srid` are declared on the `@Column()` — a
 * plain GeoJSON Point, not raw EWKB hex. Verified directly against a live
 * migrated database: a warehouse inserted with `coordinates: [lng, lat]`
 * read back byte-for-byte identical, both through `find()` and via the
 * generated `latitude`/`longitude` columns.
 *
 * Coordinate order is `[longitude, latitude]` — GeoJSON's own convention
 * (x, y), the reverse of how coordinates are normally spoken. Same
 * ordering risk Coordinates.of()'s named-argument fix (step 4) guards
 * against on the domain side; there is no equivalent guard here since
 * this shape is GeoJSON's, not this codebase's to redesign.
 */
~~~~

### `src/infrastructure/database/mappers/order.mapper.ts`

#### C-216 · `orderToDomain` · **SHORTEN**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/database.md#mapper`
- **Replacement:** Only Order/OrderItem have domain classes, so this is the only mapper. shippingLocation ↔ GeoPoint (see geo-point.ts).
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Layering and contracts”
- **Original:**

~~~~ts
/**
 * R0.5: the one mapper this spec builds — Order/OrderItem are the only
 * domain classes with a TypeORM entity to convert to and from. Everything
 * else in src/infrastructure/database/entities/** is used directly.
 *
 * `shippingLocation` converts to/from GeoPoint (geo-point.ts) — verified
 * directly against a live database that TypeORM decodes/encodes a
 * `geography` column as plain GeoJSON once `spatialFeatureType`/`srid` are
 * declared, both through `find()` and `repository.save()`.
 */
~~~~

#### C-217 · `orderToDomain` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/database.md#mapper`
- **Replacement:** Trusts the shape written at order creation; this read path doesn't validate it.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Trusts the shape written at order-creation time (FR-1's request
    // contract); this is a read path, not where that shape gets validated.
~~~~

#### C-218 · `orderToPersistence` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#mapper`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // createdAt/updatedAt: not read back from Order (no getter for the
    // former was needed by any caller so far); the DB's own defaults and
    // trigger-free `updated_at` handling own these on insert.
~~~~

#### C-219 · `orderItemToDomain` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#mapper`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
    // order_items has no currency column of its own (data-model.dbml) —
    // this system deals exclusively in USD (data-model.dbml, project
    // note), which is Money.of's own default.
~~~~

#### C-220 · `OrderItemPersistenceFields` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#mapper`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** order_items has no updated_at (insert-only); createdAt is the DB's DEFAULT now(), not read back from OrderItem. */
~~~~

### `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts`

#### C-221 · `InitialSchema1789596059697` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** Hand-written SQL: PostGIS geography, generated columns, the GiST index and the partial unique index aren't reliably produced by migration:generate.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Migrations and schema”
- **Original:**

~~~~ts
/**
 * R0.4 (frozen contract): the full schema from data-model.dbml, hand-written
 * as raw SQL rather than generated — PostGIS geography columns, generated
 * columns, the GiST index and the partial unique index are not reliably
 * produced by `migration:generate` (see specs/01-foundation.md, Decisions).
 *
 * Built across two steps of the same spec, in one file: step 7 created the
 * extension, the six enums and the three reference tables (customers,
 * products, warehouses); step 8 added the remaining seven tables, every
 * CHECK constraint and index named in the DBML, and completed `down`.
 */
~~~~

#### C-222 · `InitialSchema1789596059697.up` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** PostGIS first — every geography column depends on it.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // R0.4: PostGIS first — every geography column below depends on it.
~~~~

#### C-223 · `InitialSchema1789596059697.up` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** Warehouses are seeded, never geocoded at request time. latitude/longitude are generated from location so they can't drift.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-3; `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
    // Coordinates are fixed reference data, seeded once. Warehouses are
    // never geocoded at request time — only the shipping address is (FR-3).
    // latitude/longitude are generated columns derived from location, so
    // they are readable in a plain SELECT without ever being able to drift
    // out of sync (data-model.dbml note).
~~~~

#### C-224 · `InitialSchema1789596059697.up` · **KEEP** · **MUST-KEEP**

- **Category:** invariant
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** (unchanged)
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes); `specs/02-fulfilment-core.md` › Decisions › “Locking and concurrency”
- **Original:**

~~~~ts
    // Rows are locked with SELECT ... FOR UPDATE ORDER BY product_id during
    // reservation. CHECK constraints are the backstop: application logic is
    // never trusted alone to prevent overselling (data-model.dbml note).
~~~~

#### C-225 · `InitialSchema1789596059697.up` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** Written by the worker on order.confirmed; UNIQUE(order_id) makes that handler idempotent.
- **Spec duplicate:** `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
    // Created asynchronously by the worker on order.confirmed (P3). UNIQUE
    // (order_id) is what makes that handler idempotent (data-model.dbml note).
~~~~

#### C-226 · `InitialSchema1789596059697.up` · **KEEP** · **MUST-KEEP**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** Inserted before any work begins, so the unique constraint serialises duplicate requests.
- **Spec duplicate:** `engineering:documentation/architectural-requirements.md` › FR-6; `engineering:documentation/data-model.dbml` (table notes)
- **Original:**

~~~~ts
    // Inserted BEFORE any work begins (FR-6), so the unique constraint is
    // what serialises duplicate requests (data-model.dbml note).
~~~~

#### C-227 · `InitialSchema1789596059697.down` · **SHORTEN**

- **Category:** narration, spec-ref
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** Reverse order: tables holding foreign keys drop before the tables they reference.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Reverse order throughout: tables before the tables/enums they
    // reference. The seven tables step 8 added are dropped first, since
    // they hold the foreign keys into the three reference tables below.
~~~~

#### C-228 · `InitialSchema1789596059697.down` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Not dropping the postgis extension: it is shared, cluster-wide
    // infrastructure, and other objects may depend on it by the time this
    // ever runs for real.
~~~~

### `src/infrastructure/database/migrations/1790028652771-OrderNumberSequence.ts`

#### C-229 · `OrderNumberSequence1790028652771` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** One global counter (no per-year reset). The CNL-<year>-<6 digits> format is built in generateOrderNumber().
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Nueva migración; `specs/05-order-creation-saga.md` › Decisions
- **Original:**

~~~~ts
/**
 * SPEC 05: one global counter (not per-year — avoids fragile reset logic).
 * The `CNL-<year>-<6 digits>` format is assembled at generation time in
 * `generateOrderNumber()`, not stored in the sequence itself.
 */
~~~~

### `src/infrastructure/database/persistence-entities.ts`

#### C-230 · `PERSISTENCE_ENTITIES` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#data-source`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Shared between data-source.ts (the TypeORM CLI entrypoint) and
 * shared.module.ts (the app's own TypeOrmModule wiring), so the entity
 * list has exactly one place to define. Deliberately has no dependency on
 * env.schema.ts or anything else with a side effect at import time —
 * shared.module.ts must be able to import this without transitively
 * triggering data-source.ts's own validateEnv(process.env) call.
 *
 * Resolved from this file's own __dirname, not the importer's, so it is
 * correct regardless of which of the two files imports it.
 */
~~~~

### `src/infrastructure/database/seed.ts`

#### C-245 · `(module)` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/database.md#seed`
- **Replacement:** Hardcoded UUIDs + ON CONFLICT DO NOTHING: idempotent, and ids can be referenced directly. Raw SQL because TypeORM's upsert() does DO UPDATE.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Runtime and operations”
- **Original:**

~~~~ts
/**
 * R0.8 (frozen contract). Hardcoded UUIDs + `ON CONFLICT DO NOTHING`:
 * idempotent, so running this twice never duplicates a row, and later
 * phases' tests can reference these ids directly without querying for
 * them first (specs/01-foundation.md, Decisions).
 *
 * Raw SQL, not repository.save()/upsert() — TypeORM's upsert() does
 * "ON CONFLICT DO UPDATE", not "DO NOTHING"; getting the exact conflict
 * behaviour this file needs means writing the SQL directly, same as the
 * migration does for the same reason.
 */
~~~~

#### C-246 · `CUSTOMER` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/database.md#seed`
- **Replacement:** Fixed customer, so an orders row can be inserted without inventing one per test.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Cross-phase notes”
- **Original:**

~~~~ts
// P1's fixed customer (specs/02-fulfilment-core.md, Scope + Decisions):
// exists so an `orders` row can be inserted without inventing a customer
// per test. Hardcoded UUID, ON CONFLICT DO NOTHING like every other
// seeded row. P4 reuses it for its demo.
~~~~

#### C-247 · `PRODUCTS` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#seed`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
// Prices and storage tiers checked against current listings (September
// 2026) — see the commit message for sources. Deliberately stays on the
// iPhone 16/17 generation, not 18, per an explicit request; the newest
// generation at seed-writing time was left out on purpose, not missed.
~~~~

#### C-248 · `INVENTORY` · **SHORTEN**

- **Category:** spec-ref, example
- **Knowledge target:** `knowledge/database.md#seed`
- **Replacement:** Same table with the scenario list kept, minus requirement/phase IDs (e.g. "the boundary case the concurrency proof needs").
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Runtime and operations”
- **Original:**

~~~~ts
// warehouse index -> { product index -> quantity_available }. Indexes are
// 0-based into WAREHOUSES / PRODUCTS above.
//
// R0.8's four required scenarios, by product:
//   [13] AirPods Pro 3        -> scenario 1: exactly one warehouse (Newark) has it
//   [3]  iPhone 17            -> scenario 2: three warehouses spread across the
//                                 country (Newark/LA/Miami), so "nearest" is
//                                 unambiguous for any reasonable shipping address
//   [9]  MacBook Pro 16" Pro  -> scenario 3: 2 units everywhere, no single
//                                 warehouse can fill a request for more than 2 —
//                                 and orders never split across warehouses (C-6)
//   [12] iPad Pro 11"         -> scenario 4: exactly 5 units, Newark only — the
//                                 boundary case P6's concurrency proof needs
~~~~

### `src/infrastructure/database/transformers/bigint-number.transformer.ts`

#### C-249 · `bigintNumberTransformer` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#bigint-money`
- **Replacement:** pg returns bigint as a string. Money columns (cents) sit far below MAX_SAFE_INTEGER, so convert to number to match Money. Money columns only.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Postgres `bigint` columns come back from `pg` as JS strings by default —
 * a real bigint can exceed `Number.MAX_SAFE_INTEGER`. Every money column
 * here stores cents for an Apple-reseller order, nowhere near that
 * ceiling, so converting to a real `number` matches the domain's own
 * `Money` value object (src/domain/value-objects/money.ts), which is
 * built on `number`, not `bigint` or `string`. Applied only to money
 * columns — `inventory_movements.id` stays a plain bigint/string, it is
 * not a quantity the domain does arithmetic on.
 */
~~~~

### `src/infrastructure/database/verify-schema.ts`

#### C-251 · `CheckResult` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/database.md#verify-schema`
- **Replacement:** Automates the schema acceptance checks against a migrated and seeded stack. Rejection checks run in a transaction that is always rolled back.
- **Spec duplicate:** `specs/01-foundation.md` › Acceptance criteria
- **Original:**

~~~~ts
/**
 * Automates the psql-based acceptance criteria from specs/01-foundation.md
 * — the checks this project's earlier steps ran by hand against a live
 * database, now repeatable. Assumes a fully migrated AND seeded stack
 * (`docker compose up`, or migration:run + seed run manually); it does not
 * bring anything up itself.
 *
 * Every check that proves a rejection (a CHECK constraint, the partial
 * unique index) runs inside one transaction that is always rolled back,
 * success or failure, so this script never leaves a trace in real data —
 * it does not even need the seed's own rows for its throwaway
 * customer/order, only a real seeded warehouse and product to satisfy
 * foreign keys.
 */
~~~~

#### C-252 · `checkRejectionsInARolledBackTransaction` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/database.md#verify-schema`
- **Replacement:** Rejection checks need real seeded warehouse/product rows; all run in one always-rolled-back transaction.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Everything that proves a rejection — negative inventory, a zero
 * order_items.quantity, a second CAPTURED payment — needs a real
 * warehouse/product (from the seed) and a throwaway customer/order to
 * satisfy foreign keys. All of it happens in one transaction, rolled back
 * at the end regardless of outcome.
 */
~~~~

#### C-253 · `checkRejectionsInARolledBackTransaction` · **SHORTEN**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/database.md#savepoints`
- **Replacement:** A failed statement aborts the whole Postgres transaction; a SAVEPOINT scopes the failure to the one statement expected to fail.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // A failed statement poisons the whole transaction in Postgres — every
    // later query errors with "current transaction is aborted" even if it
    // is perfectly valid, until a ROLLBACK. A SAVEPOINT scopes that damage
    // to just the one statement expected to fail, so the transaction can
    // keep going for the checks after it. (Found this the hard way: the
    // first version of this function had no savepoints and every check
    // after the first expected failure reported a false negative.)
~~~~

### `src/modules/shared.module.ts`

#### C-405 · `SharedModule.register.imports.useFactory` · **KEEP**

- **Category:** spec-ref, invariant
- **Knowledge target:** `knowledge/database.md#migrations`
- **Replacement:** Migrations run only from the one-shot migrate service, never from the app.
- **Spec duplicate:** `specs/01-foundation.md` › Decisions › “Migrations and schema”
- **Original:**

~~~~ts
            // R0.4/R0.7: migrations run from exactly one place, the one-shot
            // `migrate` compose service (step 11) — never from the app itself.
~~~~

## geocoding

### `src/domain/ports/geocoding-errors.ts`

#### C-169 · `GeocodingFailureReason` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/geocoding.md#errors`
- **Replacement:** Lives in the domain, beside the port, so the application maps it to 422 without importing infrastructure.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Geocoding”; `references/layering.md`
- **Original:**

~~~~ts
/**
 * SPEC 03: additive, beside the frozen `geocoding-provider.ts` port, so
 * P4 maps it to a `422` without importing infrastructure
 * (`references/layering.md`).
 */
~~~~

### `src/domain/ports/geocoding-provider.ts`

#### C-170 · `GeocodingProvider` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/geocoding.md#port`
- **Replacement:** Only the shipping address is geocoded; warehouse coordinates are seeded reference data. The driver is chosen by GEOCODING_DRIVER.
- **Spec duplicate:** `specs/01-foundation.md` › Port interfaces, frozen; `engineering:documentation/architectural-requirements.md` › FR-3
- **Original:**

~~~~ts
/**
 * R0.6 (frozen contract). Implemented by P2 (`GeoapifyGeocodingProvider` and
 * a `StaticGeocodingProvider` stub, selected by `GEOCODING_DRIVER`) and
 * consumed by P4 when creating an order (FR-3): only the shipping address
 * is geocoded — warehouse coordinates are fixed reference data, seeded
 * once, never geocoded at request time.
 */
~~~~

### `src/infrastructure/geocoding/caching-geocoding.provider.ts`

#### C-255 · `GEOCODE_CACHE_MAX_ENTRIES` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/geocoding.md#cache`
- **Replacement:** No TTL: static results never change and Geoapify's terms allow storing results.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Caching”
- **Original:**

~~~~ts
/** No TTL: a static result never changes, and Geoapify's terms permit storing results (Decisions). */
~~~~

#### C-256 · `CachingGeocodingProvider` · **SHORTEN**

- **Category:** spec-ref, rationale, invariant
- **Knowledge target:** `knowledge/geocoding.md#cache`
- **Replacement:** In-memory LRU around the selected driver; caches address → coordinates only, keyed by sha256 of the normalised address (recipient excluded). Map insertion order gives LRU. Failures are never cached.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Caching”
- **Original:**

~~~~ts
/**
 * SPEC 03: an in-memory LRU decorator around whichever driver
 * `SharedModule` selects — it caches address -> coordinates only, never
 * warehouse selection or distance, which are recomputed on every order
 * (Decisions). Keyed by `sha256` of the normalised address, excluding
 * `recipient` — two people at one address are at one cache entry.
 *
 * Hand-written with no dependency: a `Map` already iterates in insertion
 * order, so re-inserting a key on every hit (`delete` then `set`) keeps
 * it at the "most recently used" end, and evicting the first key evicts
 * the least recently used one.
 *
 * A failed lookup is never stored: `this.delegate.geocode(address)`
 * rejecting propagates straight out of this method, before the `set()`
 * below ever runs — a Geoapify outage must not mark an address as bad
 * after the provider recovers.
 */
~~~~

### `src/infrastructure/geocoding/geoapify-geocoding.provider.ts`

#### C-259 · `GeoapifyRetryableError` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/geocoding.md#geoapify`
- **Replacement:** Transient failures (5xx, 429, fetch errors) that retry.ts retries. 401/403 resolve instead: a bad key isn't an outage and must not open the breaker.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Geocoding”
- **Original:**

~~~~ts
/**
 * Base for every failure worth retrying — `5xx` and `429` (transient),
 * plus `fetch` failures (timeout, network). The shared marker
 * `retry.ts`'s `isTransient` recognises. `401`/`403` are deliberately
 * NOT one of these: they resolve instead of throwing (Decisions — "a bad
 * key is not an outage, must not open the breaker"), so `retry.ts` never
 * retries them and `circuit-breaker.ts` never counts them.
 */
~~~~

#### C-260 · `GeoapifyGeocodingProvider` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/geocoding.md#geoapify`
- **Replacement:** Opt-in provider over Geoapify's structured search (fields already arrive separate). Own breaker, shared retry policy.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Geocoding”
- **Original:**

~~~~ts
/**
 * SPEC 03: opt-in `GeocodingProvider` over Geoapify's structured
 * `/v1/geocode/search` — the address already arrives as separate fields,
 * so free-text parsing would only add ambiguity (Decisions). Its own
 * `'geoapify'` breaker, the shared retry policy.
 */
~~~~

### `src/infrastructure/geocoding/normalisation.ts`

#### C-261 · `STATE_NAME_TO_CODE` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/geocoding.md#normalisation`
- **Replacement:** Full state name → USPS code (50 states plus DC).
- **Spec duplicate:** `specs/03-external-adapters.md` › Geocoding
- **Original:**

~~~~ts
/** Full state name -> two-letter USPS code. 50 states plus DC, per SPEC 03. */
~~~~

#### C-262 · `normalizeText` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/geocoding.md#normalisation`
- **Replacement:** NFD with diacritics stripped, trimmed, whitespace collapsed, lower-cased. Shared by the static lookup, the jitter and the cache key.
- **Spec duplicate:** `specs/03-external-adapters.md` › Geocoding
- **Original:**

~~~~ts
/**
 * Unicode NFD with diacritics stripped, trimmed, internal whitespace
 * collapsed, lower-cased. Shared by the static lookup, the jitter and the
 * cache key (SPEC 03).
 */
~~~~

#### C-263 · `canonicalizeStateCode` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/geocoding.md#normalisation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * A two-letter code stays as-is (upper-cased); a full name ("New York")
 * is resolved through the 51-entry table. Returns `undefined` for
 * anything else — neither the static provider's ambiguity rule nor
 * `buildNormalisedAddress` treat that as fatal on its own; the city
 * lookup is what ultimately decides.
 */
~~~~

#### C-264 · `buildNormalisedAddress` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/geocoding.md#normalisation`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * `line1|line2|city|state|postalCode|country`, empty string for an
 * absent field, every field normalised — `state` first canonicalised to
 * its two-letter code (so `"NY"` and `"New York"` produce the identical
 * string), then lower-cased like everything else. The `recipient` is
 * deliberately excluded: two people at one address are at one point.
 */
~~~~

### `src/infrastructure/geocoding/static-geocoding.provider.ts`

#### C-265 · `STATIC_JITTER_DEGREES` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/geocoding.md#static-provider`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Up to ±0.05° of jitter around a city's centre — about 5 km, irrelevant when warehouses are hundreds of km apart. */
~~~~

#### C-266 · `StaticGeocodingProvider` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/geocoding.md#static-provider`
- **Replacement:** Default provider, demo/test only: ~30-city table plus deterministic sha256 jitter (±0.05°) from the normalised address. No network.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Geocoding”
- **Original:**

~~~~ts
/**
 * SPEC 03: the default `GeocodingProvider`, for demo and test use only
 * (Decisions: a real provider is Geoapify's job, opt-in). A ~30-city
 * table plus a `sha256` jitter of up to ±0.05° computed from the
 * normalised address (excluding `recipient`) — deterministic across
 * runs and processes, never a network call.
 */
~~~~

#### C-267 · `StaticGeocodingProvider > geocode` · **KEEP** · **MUST-KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/geocoding.md#static-provider`
- **Replacement:** (unchanged) (directive + its explanation — never touched)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // async, with no await inside: a thrown GeocodingFailedError must reach
  // the caller as a rejected promise, matching PaymentGateway's async
  // methods and every other driver behind this port (Geoapify genuinely
  // awaits a fetch) — this driver alone does no I/O.
  // eslint-disable-next-line @typescript-eslint/require-await
~~~~

#### C-268 · `resolveCityCentre` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/geocoding.md#static-provider`
- **Replacement:** (unchanged)
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Geocoding”
- **Original:**

~~~~ts
/**
 * With a state, an exact `city|STATE` match or nothing. Without one, a
 * match on city alone only when the name is unique in the table —
 * tolerant, but it never guesses on ambiguity (e.g. `Portland`).
 */
~~~~

### `src/infrastructure/geocoding/us-cities.ts`

#### C-269 · `US_CITIES` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/geocoding.md#static-provider`
- **Replacement:** Keyed by normalised city|STATE. Includes the warehouse cities (matching seed.ts) and both Portlands to exercise the ambiguity rule.
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Geocoding”
- **Original:**

~~~~ts
/**
 * SPEC 03: ~30 entries, keyed by normalised `city|STATE` (city lower-cased
 * via `normalizeText`, state the two-letter USPS code). Includes the five
 * warehouse cities — coordinates match `seed.ts`'s `WAREHOUSES`, so "a
 * static result for a New York address returns Newark first" holds
 * against the seeded data — plus `portland|OR` and `portland|ME`
 * deliberately, to exercise the ambiguity rule (no state -> more than one
 * match -> `UNKNOWN_ADDRESS`).
 */
~~~~

#### C-270 · `US_CITIES` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/geocoding.md#static-provider`
- **Replacement:** (none)
- **Spec duplicate:** `specs/03-external-adapters.md` › Geocoding
- **Original:**

~~~~ts
  // Required by SPEC 03's "Geocoding" scope bullet.
~~~~

## testing

### `payments-mock/src/server.spec.ts`

#### C-010 · `buildTestServer` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#payments-mock-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // card0004DelayMs / approvedDelay* are recorded verbatim by the delay
  // spy but never actually waited for real — the spy substitutes its own
  // short real wait, so these values stay distinguishable in assertions
  // without slowing the suite down.
~~~~

### `src/application/allocation/allocate-inventory.use-case.integration.spec.ts`

#### C-040 · `describe('AllocateInventoryUseCase (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — same prerequisites as the sibling
 * inventory.service.integration.spec.ts: DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Builds its own customer/products/warehouses fixtures, not seed.ts.
 */
~~~~

#### C-041 · `describe('AllocateInventoryUseCase (integration)') > insertMockOrder` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#allocation-tests`
- **Replacement:** The stand-in order that onBeforeReserve inserts.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Scope
- **Original:**

~~~~ts
  /** The "mock order" onBeforeReserve inserts, per specs/02-fulfilment-core.md, Scope. */
~~~~

#### C-042 · `describe('AllocateInventoryUseCase (integration)').it('lands the reservation on the second cand').onBeforeReserve` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#allocation-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
        // Simulates a concurrent order draining the near warehouse's
        // stock between the selection query (already run) and this
        // attempt's own reserve() call, still inside this attempt's
        // transaction — reserve()'s own lock will see it as 0.
~~~~

#### C-043 · `describe('AllocateInventoryUseCase (integration)').it('lands the reservation on the second cand')` · **SHORTEN**

- **Category:** narration
- **Knowledge target:** `knowledge/testing.md#allocation-tests`
- **Replacement:** Nothing from the failed first attempt survives: its whole transaction rolled back.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // No partial write survives from the failed first attempt: the whole
    // attempt-1 transaction (mock order insert, the stock-zeroing UPDATE,
    // and reserve()'s own work) rolled back together.
~~~~

### `src/application/allocation/inventory.service.integration.spec.ts`

#### C-058 · `describe('InventoryService (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — same prerequisites as
 * warehouse-selection.repository.integration.spec.ts: DATABASE_URL (+
 * PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated
 * Postgres reachable. Builds its own customer/product/warehouse/order
 * fixtures (randomUUID-scoped), not seed.ts — the CI integration job
 * does not run the seed.
 */
~~~~

#### C-059 · `describe('InventoryService (integration)').describe('release and commit').it('commit is idempotent: calling it twice c')` · **SHORTEN**

- **Category:** invariant, spec-ref
- **Knowledge target:** `knowledge/testing.md#allocation-tests`
- **Replacement:** commit never touches quantity_available — it stays at the post-reserve value, 5 - 3 = 2.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Ledger and idempotency”
- **Original:**

~~~~ts
      // commit never touches quantity_available (specs/02-fulfilment-core.md,
      // Decisions) — it stays at the post-reserve value, 5 - 3 = 2.
~~~~

### `src/application/jobs/payment-reconciliation.handler.integration.spec.ts`

#### C-073 · `describe('PaymentReconciliationHandler (integratio')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.2 — integration test: DATABASE_URL,
 * PAYMENTS_URL and OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated
 * Postgres reachable. Builds its own unsettled-payment fixtures directly
 * (randomUUID-scoped).
 */
~~~~

### `src/application/jobs/reservation-reaper.handler.integration.spec.ts`

#### C-079 · `describe('ReservationReaperHandler (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.1 — integration test: DATABASE_URL,
 * PAYMENTS_URL and OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated
 * Postgres reachable. Builds its own expired-reservation fixtures
 * directly (randomUUID-scoped), one per outcome the table in the spec
 * describes.
 */
~~~~

### `src/application/jobs/shipment-create.handler.integration.spec.ts`

#### C-086 · `describe('ShipmentCreateHandler (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * SPEC 04 step 5 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable, same prerequisites as every other
 * `*.integration.spec.ts` in this repo.
 */
~~~~

### `src/application/orders/create-order-idempotent.service.integration.spec.ts`

#### C-091 · `describe('CreateOrderIdempotentService (integratio')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#saga-tests`
- **Replacement:** Asserts idempotency_keys.order_id is recorded for a 402 even though the 402 body carries no orderId.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Decisions (orderId only on the 502)
- **Original:**

~~~~ts
/**
 * SPEC 07 Fix C — integration test: DATABASE_URL, PAYMENTS_URL
 * (`payments-mock` reachable, `docker compose up`) and
 * OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated Postgres reachable.
 * Asserts idempotency_keys.order_id is recorded for a 402, even though
 * the 402 response body itself carries no `orderId` extension member
 * (Decisions — only the 502 does).
 */
~~~~

### `src/application/orders/create-order.use-case.integration.spec.ts`

#### C-105 · `describe('CreateOrderUseCase (integration) — full ')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — DATABASE_URL, PAYMENTS_URL (`payments-mock`
 * reachable, `docker compose up`) and OTEL_EXPORTER_OTLP_ENDPOINT
 * exported, a migrated Postgres reachable. Builds its own
 * customer/product/warehouse fixtures (randomUUID-scoped), not seed.ts.
 * Exercises all three phases: reserve, charge, settle.
 */
~~~~

#### C-108 · `describe('CreateOrderUseCase (integration) — full ').it('CAPTURED: reserves, charges, settles to ')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#saga-tests`
- **Replacement:** settled_at is set for a definitive outcome.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Saga — `payments.settled_at`
- **Original:**

~~~~ts
    // SPEC 07: settled_at is set for a definitive outcome.
~~~~

#### C-110 · `describe('CreateOrderUseCase (integration) — full ').it('CAPTURED: reserves, charges, settles to ')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#saga-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // PgBossEventPublisher fans `order.confirmed` out into its three
    // routed queues (event-routing.ts) — there is no job literally named
    // `order.confirmed`.
~~~~

#### C-111 · `describe('CreateOrderUseCase (integration) — full ').it('DECLINED: releases stock back to quantit')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#saga-tests`
- **Replacement:** settled_at is set for a definitive outcome.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Saga — `payments.settled_at`
- **Original:**

~~~~ts
    // SPEC 07: settled_at is set for a definitive outcome.
~~~~

#### C-112 · `describe('CreateOrderUseCase (integration) — full ').it('UNKNOWN: leaves payments.settled_at NULL')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#saga-tests`
- **Replacement:** UNKNOWN leaves settled_at NULL — that's how reconciliation finds this row.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Saga — `payments.settled_at`
- **Original:**

~~~~ts
    // SPEC 07: an UNKNOWN outcome leaves settled_at NULL — R6.2's
    // reconciliation query (`settled_at IS NULL`) is how it finds this row.
~~~~

### `src/application/orders/get-order.service.integration.spec.ts`

#### C-126 · `describe('GetOrderService (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Builds its own customer/order (randomUUID-scoped) rather than
 * depending on seed.ts (references/testing.md).
 */
~~~~

### `src/application/orders/helpers/order-number.helpers.integration.spec.ts`

#### C-130 · `describe('generateOrderNumber (integration)')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#order-number-tests`
- **Replacement:** order_number_seq is shared and never reset, so assert the format and +1 increments, never an absolute value.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * `order_number_seq` (SPEC 05 step 1) is a real Postgres sequence, shared
 * and never reset across the whole test run (and across prior runs) —
 * other integration tests/e2e specs call `generateOrderNumber` too, so
 * this asserts the format and the "next call increments by exactly one"
 * behaviour, never an absolute starting value.
 */
~~~~

### `src/application/orders/idempotency.repository.integration.spec.ts`

#### C-132 · `describe('idempotency.repository (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Each test uses its own randomUUID()-scoped idempotency key.
 */
~~~~

### `src/application/orders/order-settlement.service.integration.spec.ts`

#### C-143 · `describe('OrderSettlementService (integration)')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#saga-tests`
- **Replacement:** Fixtures are built directly: this service only settles existing PENDING_PAYMENT orders.
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, step 6 — integration test: DATABASE_URL,
 * PAYMENTS_URL and OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated
 * Postgres reachable. Builds `orders`/`order_items`/`inventory` fixtures
 * directly (randomUUID-scoped) — this service never creates an order
 * itself, only settles one that already exists at `PENDING_PAYMENT`.
 */
~~~~

### `src/domain/value-objects/coordinates.spec.ts`

#### C-179 · `describe('Coordinates').it('holds a valid latitude/longitude pair')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#domain-tests`
- **Replacement:** Newark, NJ — one of the seed warehouses.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Newark, NJ — one of the seed warehouses (P0's seed script, step 12).
~~~~

### `src/infrastructure/database/data-source.integration.spec.ts`

#### C-191 · `describe('AppDataSource')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a Postgres reachable with the migration already applied. Not one of the
 * "no database" tests (Money, the order state machine) — this is what the
 * `verify` script (step 13) running against a compose stack is for.
 */
~~~~

#### C-192 · `describe('AppDataSource').it('queries every entity against the migrate')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#database-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // A wrong column name or type in an entity's @Column() would make
    // TypeORM emit SQL referencing something that does not exist in the
    // real table — this is what actually proves the mapping, not just
    // that the decorators parsed into metadata objects.
~~~~

### `src/infrastructure/database/mappers/order.mapper.integration.spec.ts`

#### C-213 · `describe('order.mapper (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — same prerequisites as data-source.spec.ts:
 * DATABASE_URL (+ PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) exported, a
 * migrated Postgres reachable. Proves the mapper round-trips through the
 * real database, not just that the two directions type-check against each
 * other.
 */
~~~~

#### C-214 · `describe('order.mapper (integration)').beforeAll` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#database-tests`
- **Replacement:** Newark, NJ — same coordinates as the seed's Newark warehouse.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Newark, NJ — same coordinates as the seed's Newark warehouse (step 12).
~~~~

#### C-215 · `describe('order.mapper (integration)').it('round-trips an Order through orderToPers').original` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#database-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // San Jose, CA — deliberately different from the warehouse's
      // coordinates, so a lat/lng swap in either direction would surface
      // as a wrong value, not an accidental match.
~~~~

### `src/infrastructure/database/repositories/orders-read.explain.integration.spec.ts`

#### C-231 · `describe('OrdersReadRepository.findPage query plan')` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/testing.md#explain-tests`
- **Replacement:** The base-case listing must use idx_orders_keyset. EXPLAINs the exact SQL findPage sent (captured via a spy), so it can't drift.
- **Spec duplicate:** `specs/06-read-side.md` › Acceptance criteria
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, AC #4 — the base-case listing query (no filters)
 * must show `idx_orders_keyset` in use. Captures the exact SQL/params
 * `findPage` sends by spying on `AppDataSource.query`, then re-runs that
 * captured statement prefixed with `EXPLAIN (FORMAT JSON)` — never a
 * hand-duplicated copy of the WHERE/ORDER BY, so this cannot drift from
 * what the repository actually executes. Integration test — same
 * prerequisites as the sibling `orders-read.repository.integration.spec.ts`.
 */
~~~~

#### C-232 · `describe('OrdersReadRepository.findPage query plan').it('drives ORDER BY created_at DESC, id DESC')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#explain-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Enough rows for the planner's statistics to matter — not the
    // hundreds warehouse-selection.explain uses (that query joins on
    // selectivity; this one only needs the index to look worthwhile
    // against a plain ORDER BY + LIMIT).
~~~~

### `src/infrastructure/database/repositories/orders-read.repository.integration.spec.ts`

#### C-233 · `describe('OrdersReadRepository (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Builds its own customer/product/orders (randomUUID-scoped) rather than
 * depending on seed.ts (references/testing.md).
 */
~~~~

### `src/infrastructure/database/repositories/warehouse-selection.explain.integration.spec.ts`

#### C-238 · `describe('select-warehouse.sql query plan (integra').it('either drives the ORDER BY off idx_wareh')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#explain-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // A realistic, partial selectivity: roughly a third of the
      // synthetic warehouses can actually supply the product, not all
      // and not none — the shape a real catalogue would have.
~~~~

### `src/infrastructure/database/repositories/warehouse-selection.repository.integration.spec.ts`

#### C-240 · `describe('WarehouseSelectionRepository (integratio')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Integration test — same prerequisites as order.mapper.integration.spec.ts:
 * DATABASE_URL (+ PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) exported, a
 * migrated Postgres reachable. Deliberately builds its own products,
 * warehouses and inventory rows per test (randomUUID-scoped) rather than
 * depending on seed.ts — CI's integration job (tests.yml) runs migrations
 * but not the seed, and this suite must pass there unmodified.
 */
~~~~

### `src/infrastructure/database/verify-ledger.integration.spec.ts`

#### C-250 · `describe('verify-ledger.sql (integration)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md, step 7. Integration test — same
 * prerequisites as the other `*.integration.spec.ts` files: DATABASE_URL
 * (+ PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated
 * Postgres reachable. Builds its own customer/product/warehouse/order
 * fixtures, not seed.ts.
 */
~~~~

### `src/infrastructure/geocoding/caching-geocoding.provider.spec.ts`

#### C-254 · `describe('CachingGeocodingProvider').it('evicts the least recently used entry onc')` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/testing.md#geocoding-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // B was evicted -> miss. Re-inserting it pushes the cache over
    // capacity again, evicting C this time (A is protected — it was
    // touched more recently than C).
~~~~

### `src/infrastructure/geocoding/geoapify-geocoding.provider.spec.ts`

#### C-257 · `describe('GeoapifyGeocodingProvider').it('throws after exactly one request on a 40')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#geocoding-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // BREAKER_FAILURE_THRESHOLD is 5. If a 401 counted against the
    // breaker, five of them would open it and this sixth call would be
    // rejected before ever reaching the server (request count stuck at
    // 5). It reaching the server for a 6th time proves 401 never counted.
~~~~

### `src/infrastructure/http/dto/create-order.dto.spec.ts`

#### C-283 · `describe('CreateOrderDto')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#dto-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Exercises the exact global pipe config from main.ts
 * (`{ whitelist: true, forbidNonWhitelisted: true }`) directly against
 * `CreateOrderDto`, without booting Nest — `ValidationPipe` is usable
 * standalone.
 */
~~~~

### `src/infrastructure/http/dto/list-orders-query.dto.spec.ts`

#### C-290 · `describe('ListOrdersQueryDto')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#dto-tests`
- **Replacement:** Same pipe config the controller passes (transform: true, unlike the global pipe).
- **Spec duplicate:** `specs/06-read-side.md` › Decisions
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, step 10 — the same pipe config the controller
 * passes to `@Query(...)` (`transform: true` is what makes `pageSize`
 * arrive as a `number`, unlike the global pipe in main.ts).
 */
~~~~

### `src/infrastructure/http/filters/problem-details.filter.spec.ts`

#### C-298 · `describe('ProblemDetailsFilter')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#http-tests`
- **Replacement:** One case per error-mapping row, calling .catch() directly without booting Nest.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md, step 8 — one case per row of R4.5's
 * table, isolated: each exception is passed to `.catch()` directly,
 * without booting Nest.
 */
~~~~

### `src/infrastructure/messaging/correlation-and-tracing.integration.spec.ts`

#### C-319 · `FAST_POLLING_INTERVAL_SECONDS` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#observability-tests`
- **Replacement:** Registers its own NodeTracerProvider + InMemorySpanExporter; tracing.ts never loads in a test process.
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * SPEC 04 step 7 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable. Registers its own `NodeTracerProvider`
 * with an `InMemorySpanExporter` — the real `tracing.ts` never runs in a
 * test process (nothing here imports `main.ts`/`main.worker.ts`), so
 * nothing else registers a tracer provider or propagator first.
 */
~~~~

#### C-320 · `describe('correlation and tracing (integration)').it('restores the publishing correlationId in')` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#shared-queues`
- **Replacement:** Filter by this run's orderId: queues are shared with other integration specs that leave jobs behind.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Filtered by this run's own orderId: the same real queue names are
    // shared with every other *.integration.spec.ts file, some of which
    // leave a job unconsumed (e.g. pg-boss-event-publisher.integration.spec.ts's
    // "still enqueues without a tx" case) — an unfiltered handler here
    // would also observe those leftovers when the whole suite runs
    // together, not just the job this test itself published.
~~~~

#### C-321 · `describe('correlation and tracing (integration)').it('restores the publishing correlationId in')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#observability-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Mirrors what CorrelationMiddleware + HttpInstrumentation set up
    // together for a real request: a correlationId in AsyncLocalStorage
    // and an active span, both live while publish() runs.
~~~~

#### C-322 · `describe('correlation and tracing (integration)').it('restores the publishing correlationId in')` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#shared-queues`
- **Replacement:** Filter by this run's job ids: queues are shared with other integration specs that leave jobs behind.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Filtered by this run's own job ids (`messaging.message.id`,
    // job-runner.ts) — the same real queues are shared with every other
    // *.integration.spec.ts file, so an unfiltered read here would also
    // pick up job spans another test's leftover job produced when the
    // whole suite runs together.
~~~~

### `src/infrastructure/messaging/job-runner.integration.spec.ts`

#### C-328 · `FAST_POLLING_INTERVAL_SECONDS` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:**
  > Fast poll interval so five attempts take seconds. Temporarily speeds up the real shipment.create queue — stop any local worker first or it will race.
  > See knowledge/testing.md#job-runner-tests
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Risks
- **Original:**

~~~~ts
/**
 * SPEC 04 step 6 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable. Both tests run with a fast poll interval
 * (`FAST_CONFIG_SERVICE`) so five attempts take seconds, not minutes
 * (Risks: "the shipped values are asserted once by a test that reads back
 * the queue configuration created at boot" — see the last `it()` below;
 * QUEUE_RETRY_LIMIT/_DELAY_SECONDS/_DELAY_MAX_SECONDS themselves are never
 * redefined for the test).
 *
 * The realistic test temporarily speeds up the *real* `shipment.create`
 * queue's retry timing via `updateQueue`, then restores it — safe here
 * because the integration CI job runs only `postgres`, no live worker
 * consuming the same queues (`.github/workflows/tests.yml`). Running this
 * file locally against a `docker compose up`'d worker will race it —
 * `docker compose stop worker` first.
 */
~~~~

#### C-330 · `describe('JobRunner — retries and dead-letter queu').beforeAll` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:** Dead-lettering happens on pg-boss's supervise pass (default 60 s); sped up so the DLQ row lands within the test budget.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // pg-boss's own dead-lettering (the "retries and DLQ" tests below)
    // happens on its background supervise pass, not on job pickup —
    // default superviseIntervalSeconds is 60s, so without this override
    // the DLQ row can land anywhere from ~0s to ~60s after the last
    // attempt fails, racing this file's 20s waitUntil budget. Sped up
    // the same way FAST_CONFIG_SERVICE already speeds up JobRunner's own
    // poll interval.
~~~~

#### C-331 · `describe('JobRunner — retries and dead-letter queu').it('synthetic: a handler that always throws ')` · **SHORTEN**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:** source_retry_count is 0-indexed at the final attempt; +1 gives the attempt count.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Retries and dead-letter queues”
- **Original:**

~~~~ts
    // source_retry_count is the retryCount at the terminal (5th) attempt,
    // 0-indexed (SPEC 04 step 6 — traced against plans.js's failJobsBody/
    // fetch SQL): +1 gives the attempt count R3.5 asks for.
~~~~

#### C-332 · `describe('JobRunner — retries and dead-letter queu').it('realistic: order.confirmed for a non-exi')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Speed up only the retry timing of the real queue for this test —
    // QUEUE_RETRY_LIMIT (attempt count) is untouched. Integer seconds only
    // (pg-boss validation) — 1 is the fastest this can go.
~~~~

#### C-333 · `describe('JobRunner — retries and dead-letter queu').it('realistic: order.confirmed for a non-exi')` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:** Wait for the full end state, scoped to this run's orderId: queues poll independently, and older DLQ rows carry the same data.
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Wait for the full expected end-state, not just the DLQ landing:
      // shipment.create's 5 attempts (with backoff) take noticeably longer
      // than customer.notify/analytics.record's single successful
      // attempt, but each queue polls independently — asserting the
      // instant the DLQ row appears raced the other two on their own next
      // poll tick. Scoped to this run's own orderId (not a bare
      // dlqRowCount) so a DLQ row left over from an earlier local run
      // can't satisfy it early — the dead-lettered copy carries the same
      // `data` as the original job, orderId included.
~~~~

#### C-335 · `describe('JobRunner — retries and dead-letter queu').it('realistic: order.confirmed for a non-exi')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Scoped by orderId (not the generic dlqRow()) so a DLQ row left
      // over from an earlier local run of this same test can't be picked
      // up instead of this run's own.
~~~~

#### C-337 · `describe('JobRunner — scheduled jobs (SPEC 07 step').it('a job with { payload: {} } and no meta r')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#job-runner-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // Mirrors exactly what boss.schedule(queue, cron, { payload: {} })
    // inserts — no meta field at all, the same shape a scheduled job's
    // own tick produces.
~~~~

### `src/infrastructure/messaging/pg-boss-event-publisher.integration.spec.ts`

#### C-346 · `describe('PgBossEventPublisher (integration)')` · **MOVE**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/testing.md#pgboss-esm-jest`
- **Replacement:**
  > Critical gate: if the rollback assertion fails, the outbox guarantee is false. pg-boss is ESM-only, so test/jest-integration.json un-ignores it.
  > See knowledge/testing.md#pgboss-esm-jest
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “The transactional outbox”; `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”
- **Original:**

~~~~ts
/**
 * SPEC 04 step 3 — the critical gate (R3.2). If the rollback assertion
 * fails, FR-9's outbox argument is false and nothing further in P3 or P4 is
 * sound (Implementation plan, step 3). Requires DATABASE_URL (+
 * PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation)
 * exported and a migrated Postgres reachable — same prerequisites as
 * data-source.integration.spec.ts.
 *
 * This is the first test file to construct `PgBoss` for real (every other
 * P3 file only ever imports its *type*, which TypeScript erases). pg-boss@12
 * is ESM-only (SPEC 04 step 1 finding); Jest's default
 * `transformIgnorePatterns` skips `node_modules`, so without
 * `test/jest-integration.json` un-ignoring it, `require('pg-boss')` inside
 * Jest's CJS sandbox throws `ERR_REQUIRE_ESM` even though the built app's
 * plain `node dist/main.worker.js` loads it fine (Node's own
 * `require(esm)`, which Jest's VM-sandboxed module loader does not use).
 */
~~~~

#### C-347 · `describe('PgBossEventPublisher (integration)') > orderFixture` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#messaging-tests`
- **Replacement:** Minimal orders row standing in for the order update done alongside publish.
- **Spec duplicate:** —
- **Original:**

~~~~ts
  /**
   * A minimal, valid `orders` row — not built through OrderMapper/domain
   * entities, since this test only needs a row TX2 can write and later
   * find by id, standing in for "the order update TX2 does alongside the
   * publish" (event-publisher.ts's own module doc comment example).
   */
~~~~

### `src/infrastructure/messaging/pg-boss-event-publisher.spec.ts`

#### C-348 · `describe('PgBossEventPublisher').it('wraps a supplied TransactionContext into')` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#messaging-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // TransactionContext.executeSql resolves whatever EntityManager.query()
    // returns — a bare rows array, per event-publisher.ts's own doc comment
    // example (`trx.query(sql, values)`), not `{ rows }`.
~~~~

### `src/infrastructure/observability/dlq-gauge.integration.spec.ts`

#### C-367 · `describe('DLQ gauge (integration)')` · **SHORTEN**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/testing.md#observability-tests`
- **Replacement:** Own MeterProvider + in-memory exporter. getQueueStats({ force: true }) is throttled, so it's called once here; the baseline uses count(*). See knowledge/investigations.md#pgboss-queue-stats-throttle
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * SPEC 04 step 8 — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a migrated Postgres reachable. Registers its own `MeterProvider` with an
 * `InMemoryMetricExporter` (nothing in a test process ever imports
 * `tracing.ts`) and drives collection on demand via `forceFlush()` instead
 * of waiting out `DLQ_GAUGE_INTERVAL_MS`.
 *
 * `readGaugeByQueue()` is called at most **once** in this whole file:
 * `getQueueStats(name, { force: true })` (`dlq-gauge.ts`) throttles to one
 * real recomputation per queue per 60 s (step 1 finding, hit again here —
 * a second call moments later silently returned the pre-probe snapshot).
 * The baseline instead comes from a plain `count(*)` against `pgboss.job`,
 * which is never throttled.
 */
~~~~

#### C-368 · `describe('DLQ gauge (integration)').it('reports one queue.dlq.size data point pe')` · **SHORTEN**

- **Category:** verification-note
- **Knowledge target:** `knowledge/testing.md#observability-tests`
- **Replacement:** Back-date pgboss.queue.monitor_on to defeat the 60 s stats cache deterministically.
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Deterministically defeat getQueueStats({force:true})'s 60s cache
      // (step 1 finding) instead of racing it or sleeping for real: back-date
      // pgboss.queue's own monitor_on so the read below is guaranteed to
      // see a stale cache and genuinely recompute.
~~~~

### `src/infrastructure/payments/http-payment-gateway.spec.ts`

#### C-378 · `TEST_TIMEOUT_MS` · **KEEP**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/testing.md#http-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
// 50ms was too tight on loaded CI runners and caused spurious retries on
// tests that expect exactly one request; the hanging-handler test below
// deliberately keeps its own short timeout since it must trip TIMEOUT.
~~~~

#### C-379 · `describe('HttpPaymentGateway — shared breaker').it` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/testing.md#http-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Call 2: attempt 1 -> failure #4 (still CLOSED). Attempt 2 -> failure
      // #5, the breaker opens right here. Attempt 3 (still this same call)
      // hits the now-open breaker and is rejected before any network call.
~~~~

### `test/app.e2e-spec.ts`

#### C-409 · `describe('ApiModule (e2e)')` · **DROP**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#integration-prereqs`
- **Replacement:** (none)
- **Spec duplicate:** `references/testing.md`
- **Original:**

~~~~ts
/**
 * Requires DATABASE_URL (+ PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) and a
 * migrated Postgres reachable — ApiModule pulls in SharedModule's real
 * TypeOrmModule connection. Same prerequisites as the integration tests
 * under src/infrastructure/database/.
 */
~~~~

### `test/hardening.e2e-spec.ts`

#### C-410 · `describe('HTTP hardening (e2e)')` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** createTestingModule doesn't run bootstrap(), so helmet/CORS/body-parser are re-applied exactly as main.ts does; the throttler is already an APP_GUARD.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.6 — e2e: DATABASE_URL, PAYMENTS_URL and
 * OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated Postgres reachable.
 * `Test.createTestingModule` does not run main.ts's `bootstrap()`, so
 * helmet/CORS/body-parser are re-applied here exactly as main.ts applies
 * them — the throttler guard itself is already wired through ApiModule
 * (APP_GUARD), needing no re-application.
 */
~~~~

#### C-411 · `describe('HTTP hardening (e2e)') > itLocalOnly` · **KEEP**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // Fires 601 truly concurrent connections (Promise.all, no keepAlive) at an
  // in-memory server — reliable on a local machine, but GitHub Actions'
  // shared runner has tighter socket/backlog limits and the connect burst
  // itself trips ECONNRESET before the app ever gets to answer 429. Local
  // only until the request-firing mechanics are made CI-safe (a shared
  // keep-alive agent, most likely).
~~~~

### `test/orders-read.e2e-spec.ts`

#### C-412 · `describe('GET /orders, GET /orders/:id (e2e)')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** Acceptance coverage over real HTTP; the EXPLAIN check lives in orders-read.explain.integration.spec.ts. Query spies target the app's own DataSource.
- **Spec duplicate:** `specs/06-read-side.md` › Acceptance criteria
- **Original:**

~~~~ts
/**
 * specs/06-read-side.md, step 11 — acceptance coverage for the 8 AC below,
 * through real HTTP requests against a fully booted `ApiModule`. AC #4
 * (`EXPLAIN` on the base-case listing query) is covered separately in
 * `orders-read.explain.integration.spec.ts`, next to the repository — it
 * needs a query runner/transaction, not HTTP.
 *
 * Requires DATABASE_URL, PAYMENTS_URL (`payments-mock` reachable, `docker
 * compose up`) and OTEL_EXPORTER_OTLP_ENDPOINT exported, and a migrated
 * Postgres reachable. `AppDataSource` builds fixtures directly
 * (randomUUID-scoped, not seed.ts); the real HTTP requests go through the
 * booted Nest app's own connection (`app.get(DataSource)`), which is what
 * every query-spy assertion below spies on.
 */
~~~~

#### C-413 · `describe('GET /orders, GET /orders/:id (e2e)').it('1/2/3: paginates 50 seeded orders with 0')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** Insert a newer order between pages: it must not leak into an in-flight cursor walk.
- **Spec duplicate:** `specs/06-read-side.md` › Acceptance criteria
- **Original:**

~~~~ts
      // AC2: insert a brand-new order — newer than every seeded row, so it
      // would sort first if pagination restarted — right after page 1,
      // before fetching page 2. It must not leak into a later page of an
      // in-flight cursor walk.
~~~~

### `test/orders.e2e-spec.ts`

#### C-414 · `describe('POST /orders (e2e)')` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** Acceptance coverage for POST /orders over real HTTP. Not covered here: payments-mock down → 502 (the breaker is global in-process state) and "no card numbers in logs" (checked by grepping logs).
- **Spec duplicate:** `specs/05-order-creation-saga.md` › Risks
- **Original:**

~~~~ts
/**
 * specs/05-order-creation-saga.md, step 13 — acceptance coverage for
 * R4.5's 7 error rows plus the happy path and idempotency semantics, all
 * through real HTTP requests against a fully booted `ApiModule`.
 *
 * Requires DATABASE_URL, PAYMENTS_URL (`payments-mock` reachable,
 * `docker compose up`) and OTEL_EXPORTER_OTLP_ENDPOINT exported, and a
 * migrated Postgres reachable. `AppDataSource` builds/asserts fixtures
 * directly (randomUUID-scoped, not seed.ts); the real HTTP requests go
 * through the booted Nest app's own connection.
 *
 * Not covered here, by design:
 * - `docker stop payments-mock` -> 502 + open circuit breaker (AC row 5):
 *   the breaker is global, in-process state — running it here would
 *   contaminate every other test's payment calls (Risks table,
 *   specs/05). It belongs in its own isolated run, same as P2 already
 *   decided.
 * - "no card number in logs/traces": verified by grepping
 *   `npm run events-check`'s own output, not a jest assertion.
 */
~~~~

#### C-415 · `describe('POST /orders (e2e)').it('409/422: two concurrent orders racing fo')` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** The loser gets 422 or 409 depending on interleaving, which can't be forced here; the deterministic 409 proof is in allocate-inventory.use-case.integration.spec.ts. This test asserts no double-booking.
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Risks
- **Original:**

~~~~ts
    // Which status the loser gets depends on exactly how the two
    // in-process requests interleave: if the winner's whole Phase 1 (incl.
    // its commit) finishes before the loser's own selection query runs,
    // the loser sees zero candidates (422, NO_CANDIDATES); if both select
    // the same candidate first and only one wins the row lock, the loser
    // exhausts its failover loop instead (409, RESERVATION_RACE_LOST).
    // `Promise.all()` over two in-process HTTP calls cannot force either
    // interleaving deterministically — same lesson as
    // specs/02-fulfilment-core.md's Risks table draws for
    // concurrency-check.ts ("the harness reports N successes while
    // actually running sequentially, proving nothing"). The deterministic,
    // timing-independent proof that RESERVATION_RACE_LOST maps to 409
    // lives in allocate-inventory.use-case.integration.spec.ts, which
    // forces the exact interleaving via a test seam. This test only
    // proves the HTTP-level invariant that actually matters here: no
    // double-booking.
~~~~

#### C-416 · `describe('POST /orders (e2e)').it('502: card ...0004 times out at the provi')` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/testing.md#e2e-tests`
- **Replacement:** The 502 body carries orderId so the client polls GET /orders/:id instead of retrying with a new key.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Fix C — `502` body
- **Original:**

~~~~ts
    // SPEC 07 Fix C: the 502 body carries orderId, pointing the client at
    // GET /orders/:id instead of a retry with a new Idempotency-Key.
~~~~

## scripts

### `scripts/concurrency-check.ts`

#### C-015 · `DEFAULT_N` · **KEEP** · **MUST-KEEP**

- **Category:** spec-ref, rationale, invariant
- **Knowledge target:** `knowledge/scripts.md#concurrency-check`
- **Replacement:**
  > Own DataSource with poolSize 30: TypeORM's default pool of 10 would queue attempts on the pool instead of the row lock, proving nothing about reserve's locking.
  > Every successful reserve is committed so the run can end at available = 0 and reserved = 0. N is an argument (default 5); the fixture is reset each run.
  > See knowledge/scripts.md#concurrency-check
- **Spec duplicate:** `specs/02-fulfilment-core.md` › Decisions › “Verification”; `specs/02-fulfilment-core.md` › Implementation plan (step 9)
- **Original:**

~~~~ts
/**
 * specs/02-fulfilment-core.md, step 9 — the concurrency proof. Own
 * `DataSource`, `poolSize: 30`: TypeORM's default pool of 10 would queue
 * most of the N + 20 attempts in the pool rather than on the row lock,
 * and the run would prove nothing about `reserve`'s locking (Decisions).
 * Fires from one process with `Promise.all` against a shared start
 * signal, so every attempt contends on the same `inventory` row rather
 * than on connection availability or being spread out by scheduling.
 *
 * Every successful reserve is immediately committed (simulates payment
 * succeeding for that order) — the only way the run's final state can
 * reach `quantity_available = 0` *and* `quantity_reserved = 0`
 * (acceptance criteria): reserve alone would leave N units sitting in
 * `quantity_reserved`, never zero.
 *
 * `N` is an argument (default 5); the script resets the harness
 * product's stock and clears its prior movements itself, so re-running
 * — including at a different `N`, e.g. `-- 50` — always starts clean and
 * gives the same shape of result.
 */
~~~~

#### C-016 · `resetFixtures` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#concurrency-check`
- **Replacement:** Resets this harness's own fixture. The append-only ledger rule applies to src/ only, not to this dev script.
- **Spec duplicate:** `references/data-integrity.md`
- **Original:**

~~~~ts
  // Clears prior movements for this specific harness fixture — outside
  // src/, the append-only-ledger rule (no UPDATE/DELETE against
  // inventory_movements anywhere in src/) does not apply to this dev
  // harness resetting its own test data between local runs.
~~~~

### `scripts/concurrency-e2e.ts`

#### C-017 · `DEFAULT_N` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/scripts.md#concurrency-e2e`
- **Replacement:**
  > End-to-end concurrency proof: fires real POST /orders at a running api. Setup/verification only via its own DataSource; N is an argument (default 5) and the fixture is reset each run.
  > See knowledge/scripts.md#concurrency-e2e
- **Spec duplicate:** `specs/07-hardening-demo.md` › Implementation plan (R6.3)
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.3 — the concurrency proof through the
 * full HTTP stack: `scripts/concurrency-check.ts` (P1) exercises
 * `InventoryService.reserve` in-process; this one fires real
 * `POST /orders` requests at a running `api` (`docker compose up`,
 * `API_URL`, default `http://localhost:3000`) and proves the same
 * guarantee end to end — through `AllocateInventoryUseCase`'s failover
 * loop, the saga's three phases and `OrderSettlementService`.
 *
 * Own fixture, own `DataSource` for setup/verification only — the script
 * never touches `InventoryService` itself, every reservation happens
 * through the api. `N` is an argument (default 5); the script resets its
 * own harness product/warehouse every run, so re-running — including at
 * a different `N`, e.g. `-- 50` — always starts clean.
 */
~~~~

#### C-018 · `HARNESS_CUSTOMER_ID` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#harness-fixtures`
- **Replacement:** Fixed ids distinct from the other harness scripts, so they never contend on the same rows.
- **Spec duplicate:** —
- **Original:**

~~~~ts
// Fixed ids, distinct from concurrency-check.ts's `d0...` and
// events-check.ts's `e0...` harnesses — the three scripts never contend
// on the same rows.
~~~~

### `scripts/demo/harness.ts`

#### C-019 · `API_URL` · **SHORTEN**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** Mechanical helpers shared by the demo scenarios (HTTP, DB, docker compose, polling). Each scenario's expectations stay in scenarios.ts.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Implementation plan (R6.4)
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.4 — every mechanical piece the ten
 * scenarios (`scenarios.ts`) share: the api's HTTP surface, direct DB
 * access for setup/verification, `docker compose` control, and polling.
 * Nothing here decides a scenario's own expected/actual — that stays in
 * `scenarios.ts` (references/coding-conventions.md).
 */
~~~~

#### C-020 · `CARD_0004_MOCK_DELAY_MS` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** The mock's own fixed delay before a `...0004` charge finally answers (payments-mock/src/constants.ts). */
~~~~

#### C-021 · `TEST_CARD_NUMBERS` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Every test PAN this demo ever sends — scenario 10 greps compose logs for each, raw, and expects zero matches. */
~~~~

#### C-023 · `pollOrderStatus` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** Polls `getOrder` every `intervalMs` until `predicate` matches its `status`, or throws after `timeoutMs`. */
~~~~

#### C-024 · `createFixture` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** A fresh, randomUUID-scoped customer/warehouse/product — never reused across runs, so a demo run never depends on a prior one's leftovers. */
~~~~

#### C-025 · `expireReservation` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** The demo shortcut: expires an order's reservation immediately so the next reaper tick (≤60s) picks it up, instead of waiting out the real 15-minute TTL. */
~~~~

#### C-026 · `startPaymentsMockAndWait` · **SHORTEN**

- **Category:** rationale, spec-ref
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** Restarts payments-mock and waits for its /health; a fresh container has an empty in-memory charge store.
- **Spec duplicate:** `specs/03-external-adapters.md` › Risks
- **Original:**

~~~~ts
/** Restarts payments-mock and waits for its own /health to answer — a fresh container has an empty in-memory charge store (Risks). */
~~~~

#### C-027 · `getComposeLogsSince` · **KEEP**

- **Category:** narration
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/** `docker compose logs`, scoped to everything logged since `sinceIso` — never the full history of an old stack. */
~~~~

### `scripts/demo/index.ts`

#### C-028 · `INITIAL_STOCK` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:**
  > `npm run demo`: walks every failure path against a live stack, printing expected vs actual, and ends with a log grep for card numbers/secrets. Each scenario is isolated so one failure doesn't stop the rest.
  > See knowledge/scripts.md#demo
- **Spec duplicate:** `specs/07-hardening-demo.md` › Implementation plan (R6.4); `specs/07-hardening-demo.md` › Rehearsal notes
- **Original:**

~~~~ts
/**
 * specs/07-hardening-demo.md, R6.4 — `npm run demo`. Walks every failure
 * path from README.md's own table through a live `api`/`worker`/
 * `payments-mock`/`postgres` stack (`docker compose up`), printing each
 * scenario's expected outcome beside what actually happened, and ends
 * with the log grep (AC 7) — no test card number or secret anywhere in
 * `docker compose logs`.
 *
 * One own fixture (`createFixture`, `INITIAL_STOCK` units), shared by
 * scenarios 1-8; scenario 9 (`concurrency-e2e`) and its own fixture are
 * entirely separate. Every scenario is independently try/caught
 * (`scenarios.ts`'s `run()`) so one failure still lets the rest — and the
 * final summary — run to completion.
 */
~~~~

### `scripts/demo/scenarios.ts`

#### C-030 · `REAPER_WAIT_TIMEOUT_MS` · **SHORTEN**

- **Category:** spec-ref
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** Reaper cron tick (≤ 60 s) plus margin for the mock's 30 s delay to have elapsed.
- **Spec duplicate:** `specs/07-hardening-demo.md` › Implementation plan
- **Original:**

~~~~ts
/** ≤ 75 s per specs/07-hardening-demo.md, step 13.4 — the reaper's own cron tick (≤ 60 s) plus margin for the mock's background 30 s delay to have already elapsed. */
~~~~

#### C-031 · `REAPER_WAIT_AFTER_BREAKER_TRIP_MS` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** Scenario 5 tripped the shared payments breaker; the reaper reads CIRCUIT_OPEN until it cools down (30 s), so allow two ticks plus the cooldown.
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Scenario 6's own order shares the payments breaker scenario 5 just
 * tripped (http-payment-gateway.ts: charge() and getStatus() share one
 * breaker) — the reaper's own getStatus() call reads CIRCUIT_OPEN (not
 * the true 404) until BREAKER_OPEN_MS (30 s) has elapsed, which can push
 * its resolution out to a second cron tick. Two ticks plus the cooldown,
 * with margin.
 */
~~~~

#### C-032 · `DemoContext` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * Carries what a later scenario needs from an earlier one — the demo's
 * own narrative state, not a general-purpose bag (each field is read by
 * exactly the scenario named in its comment).
 */
~~~~

#### C-033 · `scenario8DuplicateKey` · **KEEP**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#demo`
- **Replacement:** (unchanged)
- **Spec duplicate:** —
- **Original:**

~~~~ts
      // Field-for-field, not literal JSON bytes: the replay comes back out
      // of idempotency_keys.response_body (jsonb), which normalises key
      // order rather than preserving it — the API contract is the same
      // fields and values, not the same serialised byte string.
~~~~

### `scripts/events-check.ts`

#### C-034 · `TIMEOUT_MS` · **MOVE**

- **Category:** spec-ref, rationale
- **Knowledge target:** `knowledge/scripts.md#events-check`
- **Replacement:**
  > Publishes order.confirmed for a fixture order and waits for the three jobs and the shipment. Does not start a JobRunner: a real worker must be consuming, so a stopped worker turns this red.
  > See knowledge/scripts.md#events-check
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Demonstrating the phase without P4”; `specs/04-queue-worker-observability.md` › Implementation plan (step 11)
- **Original:**

~~~~ts
/**
 * specs/04-queue-worker-observability.md step 11 — the phase's own
 * "small driver script" (SPEC 03's `payments-check.ts` precedent):
 * publishes `order.confirmed` for a fixture order against the real queues
 * and proves the whole HTTP-shaped path end to end without a browser —
 * `npm run verify`'s replacement for eyeballing Grafana. Deliberately does
 * *not* start a `JobRunner`: a real worker (compose, or whatever process
 * is running `test:integration`'s migrations against) must already be
 * consuming, so a stopped worker is exactly what turns this red.
 */
~~~~

#### C-035 · `HARNESS_CUSTOMER_ID` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#harness-fixtures`
- **Replacement:** Fixed ids, idempotent upsert each run; distinct from the other harness scripts' fixtures.
- **Spec duplicate:** —
- **Original:**

~~~~ts
// Fixed ids: idempotent upsert of the same customer/warehouse fixture
// every run, distinct from concurrency-check.ts's own harness (d0...) so
// the two scripts never contend on the same rows.
~~~~

#### C-036 · `seedFixtureOrder > orderId` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#events-check`
- **Replacement:** A fresh order each run (order_number is UNIQUE). warehouse_id must be set or shipment.create dead-letters.
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // A fresh order every run (order_number is UNIQUE) — ShipmentService
  // reads `warehouse_id` straight off this row (shipment.service.ts), so
  // it must be set here for shipment.create to succeed rather than
  // dead-letter.
~~~~

#### C-037 · `main > boss` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#events-check`
- **Replacement:** supervise/schedule off: the running worker owns maintenance and consumption.
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // supervise/schedule: false — this script only publishes and reads, the
  // real worker (whoever is running) owns maintenance and consumption
  // (pg-boss.provider.ts's own role split).
~~~~

### `scripts/payments-check.ts`

#### C-038 · `DEFAULT_PAYMENTS_URL` · **MOVE**

- **Category:** spec-ref, verification-note
- **Knowledge target:** `knowledge/scripts.md#payments-check`
- **Replacement:**
  > Runs the four test cards through HttpPaymentGateway against the live payments-mock with production timeouts (~7 s total, card 0004 dominates).
  > See knowledge/scripts.md#payments-check
- **Spec duplicate:** `specs/03-external-adapters.md` › Decisions › “Packaging, tests and CI”; `specs/03-external-adapters.md` › Implementation plan (step 10)
- **Original:**

~~~~ts
/**
 * SPEC 03 step 10 — the phase's "small driver script" until P4 exposes
 * `curl` on the api itself. Runs the four deterministic test cards
 * (README, step 15) through `HttpPaymentGateway` against the running
 * `payments-mock`, using the adapter's own default timeout/retry
 * constants — not sped up, so this genuinely takes the ~6.6 s worst case
 * for card `0004` alone (about 7 s total for all four).
 */
~~~~

#### C-039 · `main` · **SHORTEN**

- **Category:** rationale
- **Knowledge target:** `knowledge/scripts.md#payments-check`
- **Replacement:** Fresh gateway (and breaker) per card: 0003 and 0004 together exceed the breaker threshold and would turn 0004's last attempt into CIRCUIT_OPEN instead of TIMEOUT.
- **Spec duplicate:** —
- **Original:**

~~~~ts
    // A fresh gateway (and so a fresh, CLOSED breaker) per card: 0003 and
    // 0004 each fail all 3 attempts on their own, 6 failures together —
    // over BREAKER_FAILURE_THRESHOLD (5) if they shared one breaker, which
    // would flip 0004's last attempt to CIRCUIT_OPEN instead of TIMEOUT.
    // Each card here demonstrates its own classification in isolation, the
    // way the real app's breaker tripping across orders (Decisions) does
    // not need to.
~~~~

## investigations

### `scripts/demo/harness.ts`

#### C-022 · `fetchWithNetworkBlipRetry` · **MOVE**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/investigations.md#docker-port-blip`
- **Replacement:**
  > Retries once on a bare `fetch failed` (Docker Desktop port-forward blip after compose stop/start). A real HTTP response is never retried.
  > See knowledge/investigations.md#docker-port-blip
- **Spec duplicate:** —
- **Original:**

~~~~ts
/**
 * A `docker compose stop`/`start` a moment earlier can cause the host's
 * own port-forwarding to blip for an instant (observed against this
 * repo's Docker Desktop setup) — a `fetch failed` TypeError with no HTTP
 * response at all, nothing to do with the api or payments-mock
 * themselves. One retry, after a short pause, is enough to ride it out;
 * a real HTTP response (even a 500) is never retried here.
 */
~~~~

### `scripts/demo/index.ts`

#### C-029 · `warmUpBeforeConcurrency` · **MOVE**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/investigations.md#demo-warmup`
- **Replacement:**
  > Warms the api→payments-mock path with a few sequential orders so the concurrent burst doesn't hit cold-start timeouts and trip the shared breaker.
  > See knowledge/investigations.md#demo-warmup
- **Spec duplicate:** `specs/07-hardening-demo.md` › Rehearsal notes
- **Original:**

~~~~ts
/**
 * Scenario 6 just restarted payments-mock (startPaymentsMockAndWait — its
 * own /health answering does not mean the api<->payments-mock path is
 * warm: OTEL instrumentation JIT, the outbound fetch connection pool,
 * payments-mock's own first-request compilation). Firing
 * concurrency-e2e's 5-way-simultaneous burst at that cold path risks one
 * attempt genuinely exceeding ATTEMPT_TIMEOUT_MS (2 s), which alone is
 * enough to trip the shared payments breaker and cascade-fail the others
 * — observed empirically (a `TIMEOUT`, not a `CONNECTION_REFUSED`, and
 * unaffected by an idle sleep in its place; only real traffic warms this
 * up). A few *sequential* real orders exercise the exact same code path
 * concurrency-e2e is about to hit concurrently.
 */
~~~~

### `src/application/jobs/shipment.service.ts`

#### C-088 · `INSERT_SHIPMENT_SQL` · **MOVE**

- **Category:** rationale, verification-note, spec-ref, invariant
- **Knowledge target:** `knowledge/investigations.md#not-null-before-fk`
- **Replacement:**
  > warehouse_id comes from a subquery on $1, so a missing order still reaches the INSERT and fails warehouse_id NOT NULL — no partial row, no app branching.
  > See knowledge/investigations.md#not-null-before-fk
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Retries and dead-letter queues ("Deviation, step 6")”
- **Original:**

~~~~ts
/**
 * `warehouse_id` comes from a subquery against the *same* `$1` rather than
 * `INSERT ... SELECT ... FROM orders`, so a non-existent `orderId` still
 * reaches the `INSERT` instead of the `SELECT` silently matching zero rows
 * and writing nothing at all. Nothing is ever written — no partial row
 * (R3.4) — no application-level branching either
 * (`references/layering.md`'s domain-service test — shipments.orm-entity.ts's
 * own comment: "its only rule is the UNIQUE(order_id) constraint... not
 * in-memory logic"):
 * - `orderId` exists but its `warehouse_id` is `NULL` → the subquery
 *   returns `NULL`, and the insert violates `warehouse_id NOT NULL`.
 * - `orderId` does not exist in `orders` → the subquery *also* returns
 *   `NULL` (no matching row), so this hits the exact same `warehouse_id
 *   NOT NULL` violation, not `order_id`'s `REFERENCES orders (id)` —
 *   verified directly in psql: Postgres checks `NOT NULL` constraints
 *   (`ExecConstraints`, before the row is even built) ahead of `FOREIGN
 *   KEY` triggers (which only run on a row that has already been
 *   inserted), so a `NOT NULL` violation always wins when both would
 *   otherwise fire. There is no query shape that reaches the `order_id`
 *   foreign key here without first resolving a non-null `warehouse_id` —
 *   which a genuinely missing order can never supply (SPEC 04 step 6,
 *   deviation from the phase's literal "foreign-key violation" wording;
 *   the mechanism it exists to prove — fails without a partial row, the
 *   other two queues unaffected — holds regardless of which `NOT NULL`
 *   database constraint reports it).
 */
~~~~

### `src/infrastructure/logging/pino.config.ts`

#### C-316 · `pinoOptions > wrapSerializers` · **MOVE**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/investigations.md#pino-wrapserializers`
- **Replacement:**
  > Custom req/res serializers (the defaults are noisy). wrapSerializers: false is required — otherwise pino-http's default res serializer runs first and reports statusCode null.
  > See knowledge/investigations.md#pino-wrapserializers
- **Spec duplicate:** —
- **Original:**

~~~~ts
  // `pino-http`'s default req/res serializers (`pino-std-serializers`) dump
  // every header and Express routing internal (`params.splat`) — noise
  // nobody reads a QA log line for; `correlationId`/`trace_id`/`span_id`
  // already identify the request. Replaced with just what a human scans
  // for.
  //
  // `wrapSerializers: false` is required for the `res` one to actually
  // work: by default `pino-http` runs its own `res` serializer FIRST and
  // feeds its *output* into ours (`pino-std-serializers`'
  // `wrapResponseSerializer`) — and that default serializer has its own
  // bug, reporting `statusCode: null` whenever it runs before
  // `res.headersSent` flips true (verified: happens on every request
  // here, not just some). With `wrapSerializers: false`, `pino-http`
  // hands our functions the raw `req`/`res` objects directly, so
  // `res.statusCode` below reads the real code pino-http already has by
  // the time it logs (on the `finish` event).
~~~~

### `src/infrastructure/messaging/job-runner.integration.spec.ts`

#### C-329 · `dlqRowCount` · **MOVE**

- **Category:** rationale, verification-note
- **Knowledge target:** `knowledge/investigations.md#pgboss-queue-stats-throttle`
- **Replacement:**
  > Reads pgboss.job directly: getQueueStats({ force: true }) recomputes at most once per queue per 60 s and would starve this poll loop.
  > See knowledge/investigations.md#pgboss-queue-stats-throttle
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”
- **Original:**

~~~~ts
/**
 * Reads `pgboss.job` directly rather than `boss.getQueueStats(name, {
 * force: true })`: that call throttles to one real recomputation per
 * *queue* per 60 s (`QUEUE_STATS_FORCE_TTL_SECONDS` in
 * `node_modules/pg-boss/dist/manager.js`) and serves the cached result to
 * every call inside that window — fine for step 8's gauge, which only ever
 * samples once every `DLQ_GAUGE_INTERVAL_MS` (60 s), but it silently
 * starves a tight poll loop like this one (found by this test timing out
 * at exactly its 20 s deadline despite the row landing 9 s in). None of
 * this repo's queues set `partition: true`, so every job — including a
 * dead-lettered one — lives in the one shared `pgboss.job` table.
 */
~~~~

#### C-336 · `describe('JobRunner — retries and dead-letter queu').it('realistic: order.confirmed for a non-exi')` · **SHORTEN**

- **Category:** verification-note, spec-ref
- **Knowledge target:** `knowledge/investigations.md#not-null-before-fk`
- **Replacement:** Surfaces as a NOT NULL violation, not the order_id FK — see knowledge/investigations.md#not-null-before-fk.
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “Retries and dead-letter queues ("Deviation, step 6")”
- **Original:**

~~~~ts
      // Not literally "foreign key": Postgres checks NOT NULL constraints
      // (ExecConstraints, before the row is even inserted) ahead of FK
      // triggers (which only fire on an already-inserted row) — verified
      // directly in psql. shipment.service.ts's warehouse_id subquery
      // resolves NULL for a missing order exactly like it does for an
      // existing order with no warehouse_id, so this scenario surfaces as
      // the same not-null violation, never the order_id FK (SPEC 04
      // Decisions, "The event contract" — deviation recorded there).
~~~~

### `src/infrastructure/messaging/job-runner.ts`

#### C-341 · `JobRunner.start` · **MOVE**

- **Category:** verification-note, spec-ref
- **Knowledge target:** `knowledge/investigations.md#pgboss-notify-polling`
- **Replacement:**
  > Set both poll intervals to the same value: once LISTEN/NOTIFY is up, the backstop poll is notifyPollingIntervalSeconds.
  > See knowledge/investigations.md#pgboss-notify-polling
- **Spec duplicate:** `specs/04-queue-worker-observability.md` › Decisions › “pg-boss@12 API — step 1 findings”; `engineering:documentation/infrastructure.md` › Decided configuration: 15 s poll + LISTEN/NOTIFY
- **Original:**

~~~~ts
    // SPEC 04 step 1 finding: `notify: true` on a queue only changes which
    // *backstop* poll applies once the LISTEN/NOTIFY listener is up
    // (`notifyPollingIntervalSeconds`) — the base `pollingIntervalSeconds`
    // is what's used otherwise. infrastructure.md §7 commits to a 15 s
    // worst case for a retried or scheduled job regardless of listener
    // state, so both fields are set here, to the same value.
~~~~
