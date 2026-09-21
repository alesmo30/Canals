import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type { PgBoss } from 'pg-boss';

import { PG_BOSS } from '../messaging/pg-boss.provider';

/**
 * SPEC 04 Scope: "GET /health/ready checks the database and the queue" —
 * reported separately from `TypeOrmHealthIndicator`'s `database` key
 * (R3.1) even though both usually fail together, since both go through
 * Postgres. A genuine round-trip through the api's own `PgBoss` pool
 * (separate from TypeORM's, `infrastructure.md` §7) rather than assuming
 * DI resolving this provider at boot still means it is reachable now.
 */
@Injectable()
export class PgBossHealthIndicator {
  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await this.boss.getQueue('shipment.create');
      return indicator.up();
    } catch (error: unknown) {
      return indicator.down(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
