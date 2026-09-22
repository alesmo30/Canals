import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { SharedModule } from './shared.module';
import { AllocateInventoryUseCase } from '../application/allocation/allocate-inventory.use-case';
import { InventoryService } from '../application/allocation/inventory.service';
import { CreateOrderIdempotentService } from '../application/orders/create-order-idempotent.service';
import { CreateOrderUseCase } from '../application/orders/create-order.use-case';
import { HealthController } from '../infrastructure/health/health.controller';
import { PgBossHealthIndicator } from '../infrastructure/health/pg-boss.health-indicator';
import { OrdersController } from '../infrastructure/http/controllers/orders.controller';
import { ProblemDetailsFilter } from '../infrastructure/http/filters/problem-details.filter';
import { PgBossShutdownHook } from '../infrastructure/messaging/pg-boss-shutdown.hook';
import { CorrelationMiddleware } from '../infrastructure/observability/correlation.middleware';
import { WarehouseSelectionRepository } from '../infrastructure/database/repositories/warehouse-selection.repository';

/** SharedModule + HTTP controllers (infrastructure.md §3). main.ts's entrypoint. */
@Module({
  imports: [SharedModule.register('api'), TerminusModule],
  controllers: [HealthController, OrdersController],
  providers: [
    PgBossHealthIndicator,
    PgBossShutdownHook,
    WarehouseSelectionRepository,
    InventoryService,
    AllocateInventoryUseCase,
    CreateOrderUseCase,
    CreateOrderIdempotentService,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
