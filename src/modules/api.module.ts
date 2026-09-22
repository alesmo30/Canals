import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { SharedModule } from './shared.module';
import { AllocateInventoryUseCase } from '../application/allocation/allocate-inventory.use-case';
import { InventoryService } from '../application/allocation/inventory.service';
import { CreateOrderIdempotentService } from '../application/orders/create-order-idempotent.service';
import { CreateOrderUseCase } from '../application/orders/create-order.use-case';
import { GetOrderService } from '../application/orders/get-order.service';
import { ListOrdersService } from '../application/orders/list-orders.service';
import { OrderSettlementService } from '../application/orders/order-settlement.service';
import { HealthController } from '../infrastructure/health/health.controller';
import { PgBossHealthIndicator } from '../infrastructure/health/pg-boss.health-indicator';
import { OrdersReadController } from '../infrastructure/http/controllers/orders-read.controller';
import { OrdersController } from '../infrastructure/http/controllers/orders.controller';
import { ProblemDetailsFilter } from '../infrastructure/http/filters/problem-details.filter';
import { PgBossShutdownHook } from '../infrastructure/messaging/pg-boss-shutdown.hook';
import { CorrelationMiddleware } from '../infrastructure/observability/correlation.middleware';
import { OrdersReadRepository } from '../infrastructure/database/repositories/orders-read.repository';
import { WarehouseSelectionRepository } from '../infrastructure/database/repositories/warehouse-selection.repository';

/** SPEC 07 R6.6 — 600/min/IP comfortably covers R6.3's burst (N + 20 = 70 by default); a named constant, not an env var (references/coding-conventions.md). */
const RATE_LIMIT_PER_MINUTE = 600;

/** ThrottlerModule's own window, in ms — one minute. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** SharedModule + HTTP controllers (infrastructure.md §3). main.ts's entrypoint. */
@Module({
  imports: [
    SharedModule.register('api'),
    TerminusModule,
    ThrottlerModule.forRoot([
      { ttl: RATE_LIMIT_WINDOW_MS, limit: RATE_LIMIT_PER_MINUTE },
    ]),
  ],
  controllers: [HealthController, OrdersController, OrdersReadController],
  providers: [
    PgBossHealthIndicator,
    PgBossShutdownHook,
    WarehouseSelectionRepository,
    InventoryService,
    AllocateInventoryUseCase,
    OrderSettlementService,
    CreateOrderUseCase,
    CreateOrderIdempotentService,
    OrdersReadRepository,
    ListOrdersService,
    GetOrderService,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
