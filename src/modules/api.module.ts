import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { SharedModule } from './shared.module';
import { HealthController } from '../infrastructure/health/health.controller';
import { PgBossHealthIndicator } from '../infrastructure/health/pg-boss.health-indicator';
import { PgBossShutdownHook } from '../infrastructure/messaging/pg-boss-shutdown.hook';
import { CorrelationMiddleware } from '../infrastructure/observability/correlation.middleware';

/** SharedModule + HTTP controllers (infrastructure.md §3). main.ts's entrypoint. */
@Module({
  imports: [SharedModule.register('api'), TerminusModule],
  controllers: [HealthController],
  providers: [PgBossHealthIndicator, PgBossShutdownHook],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
