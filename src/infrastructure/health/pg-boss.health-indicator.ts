import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type { PgBoss } from 'pg-boss';

import { PG_BOSS } from '../messaging/pg-boss.provider';

/**
 * Reported separately from the database check: a real round-trip through
 * the api's own pg-boss pool.
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
