import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { PgBossHealthIndicator } from './pg-boss.health-indicator';

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
