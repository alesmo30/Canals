import { MiddlewareConsumer, Module, NestModule, Type } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { SharedModule } from './shared.module';
import { DevEventsController } from '../infrastructure/http/dev-events.controller';
import { HealthController } from '../infrastructure/health/health.controller';
import { PgBossHealthIndicator } from '../infrastructure/health/pg-boss.health-indicator';
import { PgBossShutdownHook } from '../infrastructure/messaging/pg-boss-shutdown.hook';
import { CorrelationMiddleware } from '../infrastructure/observability/correlation.middleware';

// Read directly from process.env, not ConfigService: @Module()'s metadata
// evaluates when this file is imported (main.ts, before
// NestFactory.create()), which is before ConfigModule.forRoot's `validate`
// (env.schema.ts) ever runs — DI is not available yet at this point. A
// literal "true" is what both docker-compose.yml and env.schema.ts's own
// parsing agree on (SPEC 04 step 10).
const controllers: Type<unknown>[] = [HealthController];
if (process.env.ENABLE_DEV_ENDPOINTS === 'true') {
  controllers.push(DevEventsController);
}

/** SharedModule + HTTP controllers (infrastructure.md §3). main.ts's entrypoint. */
@Module({
  imports: [SharedModule.register('api'), TerminusModule],
  controllers,
  providers: [PgBossHealthIndicator, PgBossShutdownHook],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
