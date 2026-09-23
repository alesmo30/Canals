import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';

import { PG_BOSS } from './pg-boss.provider';

/**
 * Api-only: the worker's JobRunner already stops its own instance
 * gracefully, so registering this there would stop it twice. The api never
 * consumes, so a plain stop is enough to not leak the pool and timers.
 */
@Injectable()
export class PgBossShutdownHook implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop();
  }
}
