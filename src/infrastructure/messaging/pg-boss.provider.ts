import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

import { AppConfig } from '../config/env.schema';
import { setupQueues } from './queue-setup';

const logger = new Logger('PgBoss');

/** DI token — PgBoss is a third-party class, keyed by a symbol like the domain ports. */
export const PG_BOSS = Symbol('PgBoss');

/**
 * The api only publishes and reads queue state; the worker alone
 * supervises, maintains and consumes.
 */
export type PgBossRole = 'api' | 'worker';

/** pg-boss's own pool, separate from TypeORM's. */
const PGBOSS_POOL_SIZE_API = 2;
const PGBOSS_POOL_SIZE_WORKER = 5;

/**
 * One started PgBoss per process, queues created before any consumer sees
 * it. role decides pool size, supervision, and LISTEN/NOTIFY (worker only).
 */
export function pgBossProvider(role: PgBossRole): Provider {
  return {
    provide: PG_BOSS,
    inject: [ConfigService],
    useFactory: async (
      configService: ConfigService<AppConfig, true>,
    ): Promise<PgBoss> => {
      const isWorker = role === 'worker';
      const boss = new PgBoss({
        connectionString: configService.get('DATABASE_URL', { infer: true }),
        max: isWorker ? PGBOSS_POOL_SIZE_WORKER : PGBOSS_POOL_SIZE_API,
        supervise: isWorker,
        schedule: isWorker,
        useListenNotify: isWorker,
      });
      // PgBoss emits 'error' when its pool loses a connection; with no
      // listener Node crashes the process (e.g. while Postgres is stopped).
      // Keep this listener.
      boss.on('error', (error: unknown) => {
        logger.error(error instanceof Error ? error.message : String(error));
      });
      await boss.start();
      await setupQueues(boss);
      return boss;
    },
  };
}
