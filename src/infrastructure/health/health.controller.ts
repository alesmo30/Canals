import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { PgBossHealthIndicator } from './pg-boss.health-indicator';

/**
 * Liveness (/health) makes no database call, so a DB blip can't cause a
 * restart storm; /health/ready checks the database and the queue.
 * See knowledge/observability.md#health-endpoints
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly pgBoss: PgBossHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.pgBoss.pingCheck('queue'),
    ]);
  }
}
