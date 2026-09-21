import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { SharedModule } from './shared.module';
import { HealthController } from '../infrastructure/health/health.controller';
import { CorrelationMiddleware } from '../infrastructure/observability/correlation.middleware';

/** SharedModule + HTTP controllers (infrastructure.md §3). main.ts's entrypoint. */
@Module({
  imports: [SharedModule.register('api'), TerminusModule],
  controllers: [HealthController],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
