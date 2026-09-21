import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';

import { PG_BOSS } from './pg-boss.provider';

/**
 * Api-only cleanup for the api's own `PgBoss` instance. The worker's
 * (`JobRunner.onApplicationShutdown`) already stops its instance
 * gracefully, draining an in-flight job — registering this same hook
 * there too would call `boss.stop()` twice. The api's instance never
 * consumes anything, so a plain stop is enough: nothing to drain, just a
 * pool (and pg-boss's own internal timers) to not leak on shutdown.
 */
@Injectable()
export class PgBossShutdownHook implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop();
  }
}
