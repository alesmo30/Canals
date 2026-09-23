# Code knowledge

Centralised documentation of what the code comments used to carry:
design rationale, invariants, third-party quirks and verification notes,
organised by topic and indexed by file and symbol. Code comments keep only
a short *why* and, where useful, one `See knowledge/<topic>.md#<anchor>`
pointer into these files (see the "Comments" rule in
[references/coding-conventions.md](../references/coding-conventions.md#comments)).

These files explain the code as it is. The *decisions* behind it live in
the approved specs under [specs/](../specs/) (each has a `## Decisions`
section); these docs link to them instead of copying them. Project-management
ids (phase, requirement and step numbers) are deliberately not used here.

## Topic map

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | Layers, ports and DI tokens, config validation, api/worker entrypoints (bootstrap options, tracing import order, shutdown hooks), HTTP hardening, `SharedModule` / `WorkerModule`. |
| [domain.md](domain.md) | Order state machine, `Order` / `OrderItem`, enums, `Coordinates`, `Money`, `ShippingAddress`. |
| [allocation.md](allocation.md) | Warehouse selection SQL and its captured plan, failover loop, transaction ownership, locking, inventory ledger, reservation TTL, allocation errors. |
| [orders-saga.md](orders-saga.md) | `POST /orders` three-phase saga, `OrderSettlementService`, idempotency keys, error contract (RFC 9457), request validation, read side (`GET /orders`). |
| [messaging-jobs.md](messaging-jobs.md) | Transactional outbox, event routing, queue topology, retries and DLQ, `JobRunner`, scheduled jobs (reaper, reconciliation), shipment creation (including the `DISPATCHED` deviation), pg-boss roles, graceful shutdown. |
| [observability.md](observability.md) | Redaction guarantee (logs and spans), logging, correlation id, tracing bootstrap, job spans, DLQ gauge, health endpoints. |
| [http-payments.md](http-payments.md) | Payment port, `HttpPaymentGateway`, failure codes, retry / timeout / circuit breaker, fetch error classification, card description, `payments-mock` (and card `0004`). |
| [database.md](database.md) | Data source, migrations, ORM entities, geography columns, the order mapper, bigint money, seed, `verify-schema`, savepoints. |
| [geocoding.md](geocoding.md) | Geocoding port and errors, address normalisation, static provider, Geoapify, LRU cache. |
| [testing.md](testing.md) | Prerequisites per suite (env vars, services, "stop the worker"), and the reasoning behind specific unit, integration and e2e tests. |
| [scripts.md](scripts.md) | `concurrency-check`, `concurrency-e2e`, `payments-check`, `events-check`, harness fixture ids, `npm run demo`. |
| [investigations.md](investigations.md) | Verified behaviour and third-party quirks: NOT NULL before FK, pino `wrapSerializers`, pg-boss notify polling and stats throttle, Docker port blip, demo warm-up, and more. |

`_inventory.md` is the working inventory of comment blocks that these docs
were built from (one entry per comment, with its original text).

## Symbol index

Alphabetical by symbol. `A.b` means member `b` of `A`. Test-file comments
(`describe` / `it` blocks) are not listed here; see [testing.md](testing.md),
which is organised by test file.

| Symbol | File | Doc |
|---|---|---|
| `AllocateInventoryUseCase` | `src/application/allocation/allocate-inventory.use-case.ts` | [allocation.md#failover-loop](allocation.md#failover-loop) |
| `AllocateInventoryUseCase.execute` | `src/application/allocation/allocate-inventory.use-case.ts` | [allocation.md#failover-loop](allocation.md#failover-loop) |
| `AnalyticsRecordHandler` | `src/application/jobs/analytics-record.handler.ts` | [messaging-jobs.md#event-handlers](messaging-jobs.md#event-handlers) |
| `API_URL` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `AppDataSource.synchronize` | `src/infrastructure/database/data-source.ts` | [database.md#migrations](database.md#migrations) |
| `APPROVED_DELAY_MIN_MS` | `payments-mock/src/constants.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `assertValidOrderTransition` | `src/domain/entities/order-status.transitions.ts` | [domain.md#order-state-machine](domain.md#order-state-machine) |
| `ATTEMPT_TIMEOUT_MS` | `src/infrastructure/geocoding/geoapify-geocoding.provider.ts` | [http-payments.md#resilience](http-payments.md#resilience) |
| `ATTEMPT_TIMEOUT_MS` | `src/infrastructure/payments/http-payment-gateway.ts` | [http-payments.md#resilience](http-payments.md#resilience) |
| `bigintNumberTransformer` | `src/infrastructure/database/transformers/bigint-number.transformer.ts` | [database.md#bigint-money](database.md#bigint-money) |
| `BODY_LIMIT` | `src/main.ts` | [architecture.md#http-hardening](architecture.md#http-hardening) |
| `bootstrap` | `src/main.ts` | [observability.md#redaction](observability.md#redaction) |
| `bootstrap` | `src/main.ts` | [architecture.md#bootstrap](architecture.md#bootstrap) |
| `bootstrap` | `src/main.ts` | [architecture.md#configuration](architecture.md#configuration) |
| `bootstrap` | `src/main.worker.ts` | [architecture.md#bootstrap](architecture.md#bootstrap) |
| `bootstrap` | `src/main.worker.ts` | [messaging-jobs.md#graceful-shutdown](messaging-jobs.md#graceful-shutdown) |
| `bootstrap` | `src/main.worker.ts` | [observability.md#redaction](observability.md#redaction) |
| `bootstrap.app` | `src/main.ts` | [architecture.md#bootstrap](architecture.md#bootstrap) |
| `bootstrap.app` | `src/main.worker.ts` | [architecture.md#bootstrap](architecture.md#bootstrap) |
| `bootstrap.defaultHelmet` | `src/main.ts` | [architecture.md#http-hardening](architecture.md#http-hardening) |
| `bootstrap.openApiDocument` | `src/main.ts` | [architecture.md#http-hardening](architecture.md#http-hardening) |
| `buildChargeIdempotencyKey` | `src/application/orders/charge-idempotency-key.ts` | [orders-saga.md#charge-idempotency-key](orders-saga.md#charge-idempotency-key) |
| `buildNormalisedAddress` | `src/infrastructure/geocoding/normalisation.ts` | [geocoding.md#normalisation](geocoding.md#normalisation) |
| `buildProblem` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `buildServer` | `payments-mock/src/server.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `buildTestServer` | `payments-mock/src/server.spec.ts` | [testing.md#payments-mock-tests](testing.md#payments-mock-tests) |
| `CachingGeocodingProvider` | `src/infrastructure/geocoding/caching-geocoding.provider.ts` | [geocoding.md#cache](geocoding.md#cache) |
| `canonicalizeStateCode` | `src/infrastructure/geocoding/normalisation.ts` | [geocoding.md#normalisation](geocoding.md#normalisation) |
| `captureTraceparent` | `src/infrastructure/messaging/pg-boss-event-publisher.ts` | [observability.md#trace-propagation](observability.md#trace-propagation) |
| `CARD_0004_DELAY_MS` | `payments-mock/src/constants.ts` | [http-payments.md#card-0004](http-payments.md#card-0004) |
| `CARD_0004_MOCK_DELAY_MS` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `CARD_DECLINED_LAST4` | `payments-mock/src/constants.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `CARD_NUMBER_PATTERN` | `src/infrastructure/http/dto/create-order.dto.ts` | [orders-saga.md#validation](orders-saga.md#validation) |
| `CARD_NUMBER_VALUE_PATTERN` | `src/infrastructure/http/redaction.ts` | [observability.md#redaction](observability.md#redaction) |
| `cardLast4` | `payments-mock/src/card.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `ChargeCommand` | `src/domain/ports/payment-gateway.ts` | [http-payments.md#port](http-payments.md#port) |
| `ChargeCommand.idempotencyKey` | `src/domain/ports/payment-gateway.ts` | [http-payments.md#port](http-payments.md#port) |
| `ChargeOrderResult` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `ChargeRecord` | `payments-mock/src/types.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `ChargeResponseBody` | `payments-mock/src/types.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `ChargeResult` | `src/domain/ports/payment-gateway.ts` | [http-payments.md#port](http-payments.md#port) |
| `ChargeResult.rawResponse` | `src/domain/ports/payment-gateway.ts` | [http-payments.md#port](http-payments.md#port) |
| `ChargeService` | `payments-mock/src/charge.service.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `ChargeService.process` | `payments-mock/src/charge.service.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `ChargeService.processCard0004` | `payments-mock/src/charge.service.ts` | [http-payments.md#card-0004](http-payments.md#card-0004) |
| `ChargeStatusResponseBody` | `payments-mock/src/types.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `checkRejectionsInARolledBackTransaction` | `src/infrastructure/database/verify-schema.ts` | [database.md#savepoints](database.md#savepoints) |
| `checkRejectionsInARolledBackTransaction` | `src/infrastructure/database/verify-schema.ts` | [database.md#verify-schema](database.md#verify-schema) |
| `CheckResult` | `src/infrastructure/database/verify-schema.ts` | [database.md#verify-schema](database.md#verify-schema) |
| `CircuitBreaker` | `src/infrastructure/http/circuit-breaker.ts` | [http-payments.md#circuit-breaker](http-payments.md#circuit-breaker) |
| `CircuitBreaker.execute` | `src/infrastructure/http/circuit-breaker.ts` | [http-payments.md#circuit-breaker](http-payments.md#circuit-breaker) |
| `CircuitOpenError` | `src/infrastructure/http/circuit-breaker.ts` | [http-payments.md#circuit-breaker](http-payments.md#circuit-breaker) |
| `classifyFetchError` | `src/infrastructure/http/fetch-errors.ts` | [http-payments.md#fetch-errors](http-payments.md#fetch-errors) |
| `computeRequestFingerprint` | `src/application/orders/idempotency.repository.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `computeRequestHash` | `payments-mock/src/hash.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `config` | `src/infrastructure/database/data-source.ts` | [database.md#data-source](database.md#data-source) |
| `ConfigModule` | `src/infrastructure/config/config.module.ts` | [architecture.md#configuration](architecture.md#configuration) |
| `ConfigModule.envFilePath` | `src/infrastructure/config/config.module.ts` | [architecture.md#configuration](architecture.md#configuration) |
| `Coordinates` | `src/domain/value-objects/coordinates.ts` | [domain.md#coordinates](domain.md#coordinates) |
| `Coordinates.of` | `src/domain/value-objects/coordinates.ts` | [domain.md#coordinates](domain.md#coordinates) |
| `CORRELATION_ID_MAX_LENGTH` | `src/infrastructure/observability/correlation.middleware.ts` | [observability.md#correlation](observability.md#correlation) |
| `CorrelationMiddleware` | `src/infrastructure/observability/correlation.middleware.ts` | [observability.md#correlation](observability.md#correlation) |
| `CorrelationStore` | `src/infrastructure/observability/correlation.ts` | [observability.md#correlation](observability.md#correlation) |
| `createFixture` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `CreateOrderCommand` | `src/application/orders/create-order.types.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `CreateOrderIdempotentService` | `src/application/orders/create-order-idempotent.service.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `CreateOrderIdempotentService.assertValidIdempotencyKey` | `src/application/orders/create-order-idempotent.service.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `CreateOrderIdempotentService.beginIdempotentRequest` | `src/application/orders/create-order-idempotent.service.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `CreateOrderIdempotentService.runAndRecord` | `src/application/orders/create-order-idempotent.service.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `CreateOrderResult` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `CreateOrderUseCase` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `CreateOrderUseCase.chargeOrder` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `CreateOrderUseCase.chargeOrder.payment` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#settlement](orders-saga.md#settlement) |
| `CreateOrderUseCase.reserveOrder` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#order-number](orders-saga.md#order-number) |
| `CreateOrderUseCase.reserveOrder` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `CreateOrderUseCase.settleOrder` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#settlement](orders-saga.md#settlement) |
| `CUSTOMER` | `src/infrastructure/database/seed.ts` | [database.md#seed](database.md#seed) |
| `CustomerNotFoundError` | `src/application/orders/create-order.errors.ts` | [orders-saga.md#errors](orders-saga.md#errors) |
| `CustomerNotifyHandler` | `src/application/jobs/customer-notify.handler.ts` | [messaging-jobs.md#event-handlers](messaging-jobs.md#event-handlers) |
| `CustomerOrmEntity` | `src/infrastructure/database/entities/customer.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `DEFAULT_N` | `scripts/concurrency-check.ts` | [scripts.md#concurrency-check](scripts.md#concurrency-check) |
| `DEFAULT_N` | `scripts/concurrency-e2e.ts` | [scripts.md#concurrency-e2e](scripts.md#concurrency-e2e) |
| `DEFAULT_PAYMENTS_URL` | `scripts/payments-check.ts` | [scripts.md#payments-check](scripts.md#payments-check) |
| `DemoContext` | `scripts/demo/scenarios.ts` | [scripts.md#demo](scripts.md#demo) |
| `DLQ_GAUGE_INTERVAL_MS` | `src/infrastructure/observability/tracing.ts` | [observability.md#dlq-gauge](observability.md#dlq-gauge) |
| `DLQ_RETENTION_DAYS` | `src/infrastructure/messaging/queue-setup.ts` | [messaging-jobs.md#retries-dlq](messaging-jobs.md#retries-dlq) |
| `dlqRowCount` | `src/infrastructure/messaging/job-runner.integration.spec.ts` | [investigations.md#pgboss-queue-stats-throttle](investigations.md#pgboss-queue-stats-throttle) |
| `DOCS_PATH_PREFIX` | `src/main.ts` | [architecture.md#http-hardening](architecture.md#http-hardening) |
| `DomainEvent` | `src/domain/ports/event-publisher.ts` | [messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox) |
| `encodeCursor` | `src/application/orders/helpers/cursor.helpers.ts` | [orders-saga.md#read-side](orders-saga.md#read-side), [orders-saga.md#cursor-precision](orders-saga.md#cursor-precision) |
| `OrderCursor` | `src/application/orders/helpers/cursor.helpers.ts` | [orders-saga.md#cursor-precision](orders-saga.md#cursor-precision) |
| `OrderPageRow` | `src/infrastructure/database/repositories/orders-read.repository.ts` | [orders-saga.md#cursor-precision](orders-saga.md#cursor-precision) |
| `envSchema` | `src/infrastructure/config/env.schema.ts` | [architecture.md#configuration](architecture.md#configuration) |
| `envSchema` | `src/infrastructure/config/env.schema.ts` | [observability.md#logging](observability.md#logging) |
| `EVENT_PUBLISHER` | `src/domain/ports/event-publisher.ts` | [architecture.md#ports](architecture.md#ports) |
| `EVENT_ROUTING` | `src/infrastructure/messaging/event-routing.ts` | [messaging-jobs.md#event-routing](messaging-jobs.md#event-routing) |
| `EventPublisher` | `src/domain/ports/event-publisher.ts` | [messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox) |
| `expireReservation` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `ExposedHttpError` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `extractValidationErrors` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `FAST_POLLING_INTERVAL_SECONDS` | `src/infrastructure/messaging/correlation-and-tracing.integration.spec.ts` | [testing.md#observability-tests](testing.md#observability-tests) |
| `FAST_POLLING_INTERVAL_SECONDS` | `src/infrastructure/messaging/job-runner.integration.spec.ts` | [testing.md#job-runner-tests](testing.md#job-runner-tests) |
| `fetchWithNetworkBlipRetry` | `scripts/demo/harness.ts` | [investigations.md#docker-port-blip](investigations.md#docker-port-blip) |
| `findActiveByKey` | `src/application/orders/idempotency.repository.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `FIRST_PAYMENT_ATTEMPT` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#charge-idempotency-key](orders-saga.md#charge-idempotency-key) |
| `formatCentsAsDollars` | `src/infrastructure/http/dto/helpers/money-format.helper.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `formatDistance` | `src/infrastructure/http/dto/helpers/distance-format.helper.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `generateOrderNumber` | `src/application/orders/helpers/order-number.helpers.ts` | [orders-saga.md#order-number](orders-saga.md#order-number) |
| `generateTrackingNumber` | `src/application/jobs/helpers/shipment-mock.helpers.ts` | [messaging-jobs.md#shipment-create](messaging-jobs.md#shipment-create) |
| `GeoapifyGeocodingProvider` | `src/infrastructure/geocoding/geoapify-geocoding.provider.ts` | [geocoding.md#geoapify](geocoding.md#geoapify) |
| `GeoapifyRetryableError` | `src/infrastructure/geocoding/geoapify-geocoding.provider.ts` | [geocoding.md#geoapify](geocoding.md#geoapify) |
| `GEOCODE_CACHE_MAX_ENTRIES` | `src/infrastructure/geocoding/caching-geocoding.provider.ts` | [geocoding.md#cache](geocoding.md#cache) |
| `GEOCODING_PROVIDER` | `src/domain/ports/geocoding-provider.ts` | [architecture.md#ports](architecture.md#ports) |
| `GeocodingFailureReason` | `src/domain/ports/geocoding-errors.ts` | [geocoding.md#errors](geocoding.md#errors) |
| `GeocodingProvider` | `src/domain/ports/geocoding-provider.ts` | [geocoding.md#port](geocoding.md#port) |
| `GeoPoint` | `src/infrastructure/database/interfaces/geo-point.ts` | [database.md#geography-columns](database.md#geography-columns) |
| `getComposeLogsSince` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `GetOrderService` | `src/application/orders/get-order.service.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | `src/infrastructure/messaging/job-runner.ts` | [messaging-jobs.md#graceful-shutdown](messaging-jobs.md#graceful-shutdown) |
| `HARNESS_CUSTOMER_ID` | `scripts/concurrency-e2e.ts` | [scripts.md#harness-fixtures](scripts.md#harness-fixtures) |
| `HARNESS_CUSTOMER_ID` | `scripts/events-check.ts` | [scripts.md#harness-fixtures](scripts.md#harness-fixtures) |
| `HealthController` | `src/infrastructure/health/health.controller.ts` | [observability.md#health-endpoints](observability.md#health-endpoints) |
| `HttpPaymentGateway` | `src/infrastructure/payments/http-payment-gateway.ts` | [http-payments.md#http-payment-gateway](http-payments.md#http-payment-gateway) |
| `IDEMPOTENCY_KEY_REUSED` | `payments-mock/src/charge.service.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `IDEMPOTENCY_KEY_TTL_HOURS` | `src/application/orders/idempotency.repository.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `IdempotencyCheckResult` | `src/application/orders/idempotency.types.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `IdempotencyKeyOrmEntity` | `src/infrastructure/database/entities/idempotency-key.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `IdempotencyState` | `src/infrastructure/database/entities/idempotency-key.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `INITIAL_STOCK` | `scripts/demo/index.ts` | [scripts.md#demo](scripts.md#demo) |
| `InitialSchema1789596059697` | `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` | [database.md#migrations](database.md#migrations) |
| `InitialSchema1789596059697.down` | `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` | [database.md#migrations](database.md#migrations) |
| `InitialSchema1789596059697.up` | `src/infrastructure/database/migrations/1789596059697-InitialSchema.ts` | [database.md#migrations](database.md#migrations) |
| `INSERT_SHIPMENT_SQL` | `src/application/jobs/shipment.service.ts` | [investigations.md#not-null-before-fk](investigations.md#not-null-before-fk) |
| `insertInProgress` | `src/application/orders/idempotency.repository.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `insertMovement` | `src/application/allocation/helpers/inventory.helpers.ts` | [allocation.md#ledger](allocation.md#ledger) |
| `InsufficientStockError` | `src/application/allocation/errors.ts` | [allocation.md#errors](allocation.md#errors) |
| `InvalidCursorError` | `src/application/orders/helpers/cursor.helpers.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `INVENTORY` | `src/infrastructure/database/seed.ts` | [database.md#seed](database.md#seed) |
| `InventoryMovementOrmEntity` | `src/infrastructure/database/entities/inventory-movement.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `InventoryMovementOrmEntity.id` | `src/infrastructure/database/entities/inventory-movement.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `InventoryMovementType` | `src/infrastructure/database/entities/inventory-movement.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `InventoryOrmEntity` | `src/infrastructure/database/entities/inventory.orm-entity.ts` | [allocation.md#locking](allocation.md#locking) |
| `InventoryService` | `src/application/allocation/inventory.service.ts` | [allocation.md#transaction-ownership](allocation.md#transaction-ownership) |
| `InventoryService.commit` | `src/application/allocation/inventory.service.ts` | [allocation.md#ledger](allocation.md#ledger) |
| `InventoryService.release` | `src/application/allocation/inventory.service.ts` | [allocation.md#ledger](allocation.md#ledger) |
| `InventoryService.reserve` | `src/application/allocation/inventory.service.ts` | [allocation.md#locking](allocation.md#locking) |
| `InventoryService.reserve` | `src/application/allocation/inventory.service.ts` | [allocation.md#ledger](allocation.md#ledger) |
| `isDefinitiveOutcome` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#settlement](orders-saga.md#settlement) |
| `isLockTimeout` | `src/application/allocation/helpers/inventory.helpers.ts` | [allocation.md#locking](allocation.md#locking) |
| `isWorker` | `src/infrastructure/observability/tracing.ts` | [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap) |
| `JOB_HANDLERS` | `src/application/jobs/job-handler.ts` | [messaging-jobs.md#handler-contract](messaging-jobs.md#handler-contract) |
| `JobHandler` | `src/application/jobs/job-handler.ts` | [messaging-jobs.md#handler-contract](messaging-jobs.md#handler-contract) |
| `JobMeta` | `src/infrastructure/messaging/job-envelope.ts` | [messaging-jobs.md#job-envelope](messaging-jobs.md#job-envelope) |
| `JobMeta.traceparent` | `src/infrastructure/messaging/job-envelope.ts` | [messaging-jobs.md#job-envelope](messaging-jobs.md#job-envelope) |
| `JobRunner` | `src/infrastructure/messaging/job-runner.ts` | [messaging-jobs.md#job-runner](messaging-jobs.md#job-runner) |
| `JobRunner.start` | `src/infrastructure/messaging/job-runner.ts` | [observability.md#health-endpoints](observability.md#health-endpoints) |
| `JobRunner.start` | `src/infrastructure/messaging/job-runner.ts` | [investigations.md#pgboss-notify-polling](investigations.md#pgboss-notify-polling) |
| `JobRunner.start` | `src/infrastructure/messaging/job-runner.ts` | [observability.md#redaction](observability.md#redaction) |
| `JobRunner.start` | `src/infrastructure/messaging/job-runner.ts` | [messaging-jobs.md#scheduled-jobs](messaging-jobs.md#scheduled-jobs) |
| `ListOrdersService` | `src/application/orders/list-orders.service.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `ListOrdersService.decodeCursorOrThrow` | `src/application/orders/list-orders.service.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `LOCK_TIMEOUT` | `src/application/allocation/helpers/inventory.helpers.ts` | [allocation.md#locking](allocation.md#locking) |
| `lockInventoryRows` | `src/application/allocation/helpers/inventory.helpers.ts` | [allocation.md#locking](allocation.md#locking) |
| `main` | `scripts/payments-check.ts` | [scripts.md#payments-check](scripts.md#payments-check) |
| `main` | `src/infrastructure/health/worker-healthcheck.ts` | [observability.md#health-endpoints](observability.md#health-endpoints) |
| `main.boss` | `scripts/events-check.ts` | [scripts.md#events-check](scripts.md#events-check) |
| `mapStatusResponse` | `src/infrastructure/payments/http-payment-gateway.ts` | [http-payments.md#http-payment-gateway](http-payments.md#http-payment-gateway) |
| `markCompleted` | `src/application/orders/idempotency.repository.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `MAX_ATTEMPTS` | `src/infrastructure/http/retry.ts` | [http-payments.md#resilience](http-payments.md#resilience) |
| `(module)` | `payments-mock/src/main.ts` | [http-payments.md#payments-mock](http-payments.md#payments-mock) |
| `(module)` | `src/infrastructure/database/seed.ts` | [database.md#seed](database.md#seed) |
| `(module)` | `src/infrastructure/http/redaction.ts` | [observability.md#redaction](observability.md#redaction) |
| `(module)` | `src/infrastructure/observability/tracing.ts` | [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap) |
| `(module)` | `src/main.ts` | [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap) |
| `(module)` | `src/main.worker.ts` | [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap) |
| `Money` | `src/domain/value-objects/money.ts` | [domain.md#money](domain.md#money) |
| `NoFulfilmentPossibleError` | `src/application/allocation/errors.ts` | [allocation.md#errors](allocation.md#errors) |
| `NoFulfilmentPossibleReason` | `src/application/allocation/errors.ts` | [allocation.md#errors](allocation.md#errors) |
| `normalizeText` | `src/infrastructure/geocoding/normalisation.ts` | [geocoding.md#normalisation](geocoding.md#normalisation) |
| `OnBeforeReserveParams` | `src/application/allocation/allocation.types.ts` | [allocation.md#failover-loop](allocation.md#failover-loop) |
| `Order` | `src/domain/entities/order.ts` | [domain.md#order-entity](domain.md#order-entity) |
| `Order.confirm` | `src/domain/entities/order.ts` | [domain.md#order-state-machine](domain.md#order-state-machine) |
| `Order.markPaid` | `src/domain/entities/order.ts` | [domain.md#order-state-machine](domain.md#order-state-machine) |
| `Order.markPaymentFailed` | `src/domain/entities/order.ts` | [domain.md#order-state-machine](domain.md#order-state-machine) |
| `ORDER_STATUS_VALUES` | `src/infrastructure/database/entities/order.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `ORDER_TRANSITIONS` | `src/domain/entities/order-status.transitions.ts` | [domain.md#order-state-machine](domain.md#order-state-machine) |
| `OrderConfirmedPayload` | `src/infrastructure/messaging/event-routing.ts` | [messaging-jobs.md#event-contract](messaging-jobs.md#event-contract) |
| `OrderItem` | `src/domain/entities/order-item.ts` | [domain.md#order-item](domain.md#order-item) |
| `OrderItem.getLineTotal` | `src/domain/entities/order-item.ts` | [domain.md#order-item](domain.md#order-item) |
| `OrderItemOrmEntity` | `src/infrastructure/database/entities/order-item.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `OrderItemPersistenceFields` | `src/infrastructure/database/mappers/order.mapper.ts` | [database.md#mapper](database.md#mapper) |
| `orderItemToDomain` | `src/infrastructure/database/mappers/order.mapper.ts` | [database.md#mapper](database.md#mapper) |
| `OrderLine` | `src/application/allocation/allocation.types.ts` | [allocation.md#contracts](allocation.md#contracts) |
| `OrderLineDto.productId` | `src/infrastructure/http/dto/create-order.dto.ts` | [orders-saga.md#validation](orders-saga.md#validation) |
| `OrderNotFoundError` | `src/application/orders/order-read.errors.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `OrderNumberSequence1790028652771` | `src/infrastructure/database/migrations/1790028652771-OrderNumberSequence.ts` | [database.md#migrations](database.md#migrations) |
| `OrderOrmEntity` | `src/infrastructure/database/entities/order.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `OrderProps.total` | `src/domain/entities/order.ts` | [domain.md#order-entity](domain.md#order-entity) |
| `OrderResponse` | `src/infrastructure/http/dto/order-response.dto.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `OrdersController` | `src/infrastructure/http/controllers/orders.controller.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `OrdersController.create` | `src/infrastructure/http/controllers/orders.controller.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `OrderSettlementService` | `src/application/orders/order-settlement.service.ts` | [orders-saga.md#settlement](orders-saga.md#settlement) |
| `OrderSettlementService.settle` | `src/application/orders/order-settlement.service.ts` | [orders-saga.md#settlement](orders-saga.md#settlement) |
| `OrdersReadController` | `src/infrastructure/http/controllers/orders-read.controller.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `OrdersReadController.list` | `src/infrastructure/http/controllers/orders-read.controller.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `OrdersReadRepository.findItemsByOrderIds` | `src/infrastructure/database/repositories/orders-read.repository.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `OrdersReadRepository.findOrderById` | `src/infrastructure/database/repositories/orders-read.repository.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `OrdersReadRepository.findPage` | `src/infrastructure/database/repositories/orders-read.repository.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `OrderStatus` | `src/domain/enum-types/order-status.ts` | [domain.md#enums](domain.md#enums) |
| `orderToDomain` | `src/infrastructure/database/mappers/order.mapper.ts` | [database.md#mapper](database.md#mapper) |
| `orderToPersistence` | `src/infrastructure/database/mappers/order.mapper.ts` | [database.md#mapper](database.md#mapper) |
| `PAYMENT_FAILURE_CODES` | `src/domain/ports/payment-failure-codes.ts` | [http-payments.md#failure-codes](http-payments.md#failure-codes) |
| `PAYMENT_GATEWAY` | `src/domain/ports/payment-gateway.ts` | [architecture.md#ports](architecture.md#ports) |
| `PAYMENT_STATUS_VALUES` | `src/infrastructure/database/entities/payment.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `PaymentDeclinedError` | `src/application/orders/create-order.errors.ts` | [orders-saga.md#errors](orders-saga.md#errors) |
| `PaymentGateway` | `src/domain/ports/payment-gateway.ts` | [http-payments.md#port](http-payments.md#port) |
| `PaymentOrmEntity` | `src/infrastructure/database/entities/payment.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `PaymentOutcomeErrorParams` | `src/application/orders/create-order.errors.ts` | [orders-saga.md#errors](orders-saga.md#errors) |
| `PaymentProviderUnavailableError` | `src/application/orders/create-order.errors.ts` | [orders-saga.md#errors](orders-saga.md#errors) |
| `PaymentReconciliationHandler` | `src/application/jobs/payment-reconciliation.handler.ts` | [messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation) |
| `PaymentResolution` | `src/application/orders/order-settlement.service.ts` | [orders-saga.md#settlement](orders-saga.md#settlement) |
| `PaymentStatus` | `src/domain/enum-types/payment-status.ts` | [domain.md#enums](domain.md#enums) |
| `PERSISTENCE_ENTITIES` | `src/infrastructure/database/persistence-entities.ts` | [database.md#data-source](database.md#data-source) |
| `PG_BOSS` | `src/infrastructure/messaging/pg-boss.provider.ts` | [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles) |
| `PGBOSS_POOL_SIZE_API` | `src/infrastructure/messaging/pg-boss.provider.ts` | [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles) |
| `PgBossEventPublisher` | `src/infrastructure/messaging/pg-boss-event-publisher.ts` | [messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox) |
| `PgBossEventPublisher.publish` | `src/infrastructure/messaging/pg-boss-event-publisher.ts` | [messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox) |
| `PgBossEventPublisher.publish` | `src/infrastructure/messaging/pg-boss-event-publisher.ts` | [observability.md#correlation](observability.md#correlation) |
| `PgBossHealthIndicator` | `src/infrastructure/health/pg-boss.health-indicator.ts` | [observability.md#health-endpoints](observability.md#health-endpoints) |
| `pgBossProvider` | `src/infrastructure/messaging/pg-boss.provider.ts` | [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles) |
| `pgBossProvider.useFactory` | `src/infrastructure/messaging/pg-boss.provider.ts` | [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles) |
| `PgBossRole` | `src/infrastructure/messaging/pg-boss.provider.ts` | [messaging-jobs.md#pgboss-roles](messaging-jobs.md#pgboss-roles) |
| `PgBossShutdownHook` | `src/infrastructure/messaging/pg-boss-shutdown.hook.ts` | [messaging-jobs.md#graceful-shutdown](messaging-jobs.md#graceful-shutdown) |
| `PinoHttpOptions` | `src/infrastructure/logging/pino.config.ts` | [observability.md#logging](observability.md#logging) |
| `pinoOptions` | `src/infrastructure/logging/pino.config.ts` | [observability.md#redaction](observability.md#redaction) |
| `pinoOptions` | `src/infrastructure/logging/pino.config.ts` | [observability.md#logging](observability.md#logging) |
| `pinoOptions.hooks` | `src/infrastructure/logging/pino.config.ts` | [observability.md#redaction](observability.md#redaction) |
| `pinoOptions.wrapSerializers` | `src/infrastructure/logging/pino.config.ts` | [investigations.md#pino-wrapserializers](investigations.md#pino-wrapserializers) |
| `pollOrderStatus` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `ProblemDetails` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `ProblemDetailsFilter` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `ProblemShape` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `PRODUCT_CONDITION_VALUES` | `src/infrastructure/database/entities/product.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `ProductCondition` | `src/domain/enum-types/product-condition.ts` | [domain.md#enums](domain.md#enums) |
| `ProductNotFoundError` | `src/application/orders/create-order.errors.ts` | [orders-saga.md#errors](orders-saga.md#errors) |
| `ProductOrmEntity` | `src/infrastructure/database/entities/product.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `PRODUCTS` | `src/infrastructure/database/seed.ts` | [database.md#seed](database.md#seed) |
| `QUEUE_RETRY_LIMIT` | `src/infrastructure/messaging/queue-setup.ts` | [messaging-jobs.md#retries-dlq](messaging-jobs.md#retries-dlq) |
| `QUEUE_TOPOLOGY` | `src/infrastructure/messaging/queue-setup.ts` | [messaging-jobs.md#queue-topology](messaging-jobs.md#queue-topology) |
| `RATE_LIMIT_PER_MINUTE` | `src/modules/api.module.ts` | [architecture.md#http-hardening](architecture.md#http-hardening) |
| `REAPER_ALERT_AFTER_MINUTES` | `src/application/jobs/reservation-reaper.handler.ts` | [messaging-jobs.md#reservation-reaper](messaging-jobs.md#reservation-reaper) |
| `REAPER_BATCH_SIZE` | `src/application/jobs/reservation-reaper.handler.ts` | [messaging-jobs.md#reservation-reaper](messaging-jobs.md#reservation-reaper) |
| `REAPER_WAIT_AFTER_BREAKER_TRIP_MS` | `scripts/demo/scenarios.ts` | [scripts.md#demo](scripts.md#demo) |
| `REAPER_WAIT_TIMEOUT_MS` | `scripts/demo/scenarios.ts` | [scripts.md#demo](scripts.md#demo) |
| `RECONCILIATION_BATCH_SIZE` | `src/application/jobs/payment-reconciliation.handler.ts` | [messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation) |
| `RECONCILIATION_GRACE_MINUTES` | `src/application/jobs/payment-reconciliation.handler.ts` | [messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation) |
| `redactError` | `src/infrastructure/http/redaction.ts` | [observability.md#redaction](observability.md#redaction) |
| `RedactingSpanExporter` | `src/infrastructure/observability/redacting-span-exporter.ts` | [observability.md#redaction](observability.md#redaction) |
| `redactSpan` | `src/infrastructure/observability/redacting-span-exporter.ts` | [observability.md#redaction](observability.md#redaction) |
| `registerDlqGauge` | `src/infrastructure/observability/dlq-gauge.ts` | [observability.md#dlq-gauge](observability.md#dlq-gauge) |
| `ReleaseCommand` | `src/application/allocation/allocation.types.ts` | [allocation.md#ledger](allocation.md#ledger) |
| `requireGeoapifyApiKey` | `src/modules/shared.module.ts` | [architecture.md#adapter-selection](architecture.md#adapter-selection) |
| `RESERVATION_TTL_MINUTES` | `src/application/allocation/inventory.service.ts` | [allocation.md#reservation-ttl](allocation.md#reservation-ttl) |
| `ReservationReaperHandler` | `src/application/jobs/reservation-reaper.handler.ts` | [messaging-jobs.md#reservation-reaper](messaging-jobs.md#reservation-reaper) |
| `ReserveCommand` | `src/application/allocation/allocation.types.ts` | [allocation.md#transaction-ownership](allocation.md#transaction-ownership) |
| `ReserveOrderResult` | `src/application/orders/create-order.use-case.ts` | [orders-saga.md#saga-phases](orders-saga.md#saga-phases) |
| `resetFixtures` | `scripts/concurrency-check.ts` | [scripts.md#concurrency-check](scripts.md#concurrency-check) |
| `resolveCityCentre` | `src/infrastructure/geocoding/static-geocoding.provider.ts` | [geocoding.md#static-provider](geocoding.md#static-provider) |
| `resolvePayment` | `src/application/jobs/payment-reconciliation.handler.ts` | [messaging-jobs.md#payment-reconciliation](messaging-jobs.md#payment-reconciliation) |
| `resolveReservation` | `src/application/jobs/reservation-reaper.handler.ts` | [messaging-jobs.md#reservation-reaper](messaging-jobs.md#reservation-reaper) |
| `RetryableProviderError` | `src/infrastructure/payments/http-payment-gateway.ts` | [http-payments.md#resilience](http-payments.md#resilience) |
| `scenario8DuplicateKey` | `scripts/demo/scenarios.ts` | [scripts.md#demo](scripts.md#demo) |
| `SCHEDULED_JOBS` | `src/infrastructure/messaging/queue-setup.ts` | [messaging-jobs.md#scheduled-jobs](messaging-jobs.md#scheduled-jobs) |
| `SCOPE` | `src/application/orders/idempotency.repository.ts` | [orders-saga.md#idempotency](orders-saga.md#idempotency) |
| `sdk` | `src/infrastructure/observability/tracing.ts` | [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap) |
| `sdk.instrumentations` | `src/infrastructure/observability/tracing.ts` | [observability.md#tracing-bootstrap](observability.md#tracing-bootstrap) |
| `seedFixtureOrder.orderId` | `scripts/events-check.ts` | [scripts.md#events-check](scripts.md#events-check) |
| `SELECT_WAREHOUSE_SQL` | `src/infrastructure/database/repositories/warehouse-selection.repository.ts` | [allocation.md#selection-query](allocation.md#selection-query) |
| `selectExpiredReservations` | `src/application/jobs/reservation-reaper.handler.ts` | [messaging-jobs.md#settlement-locking](messaging-jobs.md#settlement-locking) |
| `selectUnsettledPayments` | `src/application/jobs/payment-reconciliation.handler.ts` | [messaging-jobs.md#settlement-locking](messaging-jobs.md#settlement-locking) |
| `setupQueues` | `src/infrastructure/messaging/queue-setup.ts` | [messaging-jobs.md#queue-topology](messaging-jobs.md#queue-topology) |
| `SharedModule` | `src/modules/shared.module.ts` | [architecture.md#shared-module](architecture.md#shared-module) |
| `SharedModule.register.imports` | `src/modules/shared.module.ts` | [observability.md#redaction](observability.md#redaction) |
| `SharedModule.register.imports.useFactory` | `src/modules/shared.module.ts` | [database.md#migrations](database.md#migrations) |
| `SharedModule.register.providers.useFactory` | `src/modules/shared.module.ts` | [architecture.md#adapter-selection](architecture.md#adapter-selection) |
| `SHIPMENT_STATUS_VALUES` | `src/infrastructure/database/entities/shipment.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `ShipmentCreateHandler` | `src/application/jobs/shipment-create.handler.ts` | [messaging-jobs.md#shipment-create](messaging-jobs.md#shipment-create) |
| `ShipmentOrmEntity` | `src/infrastructure/database/entities/shipment.orm-entity.ts` | [database.md#entities](database.md#entities) |
| `ShipmentService` | `src/application/jobs/shipment.service.ts` | [messaging-jobs.md#shipment-create](messaging-jobs.md#shipment-create) |
| `ShipmentStatus` | `src/domain/enum-types/shipment-status.ts` | [domain.md#enums](domain.md#enums) |
| `ShippingAddress` | `src/domain/value-objects/shipping-address.ts` | [domain.md#shipping-address](domain.md#shipping-address) |
| `startPaymentsMockAndWait` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `STATE_NAME_TO_CODE` | `src/infrastructure/geocoding/normalisation.ts` | [geocoding.md#normalisation](geocoding.md#normalisation) |
| `STATIC_JITTER_DEGREES` | `src/infrastructure/geocoding/static-geocoding.provider.ts` | [geocoding.md#static-provider](geocoding.md#static-provider) |
| `StaticGeocodingProvider` | `src/infrastructure/geocoding/static-geocoding.provider.ts` | [geocoding.md#static-provider](geocoding.md#static-provider) |
| `StaticGeocodingProvider.geocode` | `src/infrastructure/geocoding/static-geocoding.provider.ts` | [geocoding.md#static-provider](geocoding.md#static-provider) |
| `SUPPORTED_COUNTRY` | `src/infrastructure/http/dto/create-order.dto.ts` | [orders-saga.md#validation](orders-saga.md#validation) |
| `TEST_CARD_NUMBERS` | `scripts/demo/harness.ts` | [scripts.md#demo](scripts.md#demo) |
| `TEST_TIMEOUT_MS` | `src/infrastructure/payments/http-payment-gateway.spec.ts` | [testing.md#http-tests](testing.md#http-tests) |
| `TIMEOUT_MS` | `scripts/events-check.ts` | [scripts.md#events-check](scripts.md#events-check) |
| `toOrderDetailResponse` | `src/infrastructure/http/dto/order-detail.response.dto.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `toOrderListItem` | `src/infrastructure/http/dto/order-list.response.dto.ts` | [orders-saga.md#read-side](orders-saga.md#read-side) |
| `toOrderResponse` | `src/infrastructure/http/dto/order-response.dto.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `tracer` | `src/application/jobs/helpers/tracing.helper.ts` | [observability.md#job-spans](observability.md#job-spans) |
| `tracer` | `src/infrastructure/messaging/job-runner.ts` | [observability.md#job-spans](observability.md#job-spans) |
| `TransactionContext` | `src/domain/ports/event-publisher.ts` | [messaging-jobs.md#transactional-outbox](messaging-jobs.md#transactional-outbox) |
| `UniqueProductIds` | `src/infrastructure/http/dto/create-order.dto.ts` | [orders-saga.md#validation](orders-saga.md#validation) |
| `UnroutedEventError` | `src/infrastructure/messaging/event-routing.ts` | [messaging-jobs.md#event-routing](messaging-jobs.md#event-routing) |
| `updateInventoryBalances` | `src/application/allocation/helpers/inventory.helpers.ts` | [allocation.md#ledger](allocation.md#ledger) |
| `US_CITIES` | `src/infrastructure/geocoding/us-cities.ts` | [geocoding.md#static-provider](geocoding.md#static-provider) |
| `validateEnv` | `src/infrastructure/config/env.schema.ts` | [architecture.md#configuration](architecture.md#configuration) |
| `WarehouseAllocationInfo` | `src/infrastructure/http/dto/order-response.dto.ts` | [orders-saga.md#http-api](orders-saga.md#http-api) |
| `WarehouseCandidate` | `src/infrastructure/database/repositories/warehouse-selection.repository.ts` | [allocation.md#selection-query](allocation.md#selection-query) |
| `WarehouseOrmEntity` | `src/infrastructure/database/entities/warehouse.orm-entity.ts` | [database.md#geography-columns](database.md#geography-columns) |
| `WarehouseSelectionRepository` | `src/infrastructure/database/repositories/warehouse-selection.repository.ts` | [allocation.md#selection-query](allocation.md#selection-query) |
| `WarehouseSelectionRepository.findCandidates` | `src/infrastructure/database/repositories/warehouse-selection.repository.ts` | [allocation.md#selection-query](allocation.md#selection-query) |
| `warmUpBeforeConcurrency` | `scripts/demo/index.ts` | [investigations.md#demo-warmup](investigations.md#demo-warmup) |
| `WHITELIST_VIOLATION_PATTERN` | `src/infrastructure/http/filters/problem-details.filter.ts` | [orders-saga.md#error-contract](orders-saga.md#error-contract) |
| `withJobSpan` | `src/application/jobs/helpers/tracing.helper.ts` | [observability.md#job-spans](observability.md#job-spans) |
| `withRetry` | `src/infrastructure/http/retry.ts` | [http-payments.md#resilience](http-payments.md#resilience) |
| `WORKER_READINESS_FILE_PATH` | `src/infrastructure/health/worker-readiness.ts` | [observability.md#health-endpoints](observability.md#health-endpoints) |
| `WorkerModule` | `src/modules/worker.module.ts` | [architecture.md#worker-module](architecture.md#worker-module) |
