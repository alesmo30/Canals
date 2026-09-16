import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { SharedModule } from './shared.module';
import { HealthController } from '../infrastructure/health/health.controller';

/** SharedModule + HTTP controllers (infrastructure.md §3). main.ts's entrypoint. */
@Module({
  imports: [SharedModule, TerminusModule],
  controllers: [HealthController],
})
export class ApiModule {}
