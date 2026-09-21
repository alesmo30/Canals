import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

import { AppConfig } from '../config/env.schema';
import { setupQueues } from './queue-setup';

const logger = new Logger('PgBoss');

/** DI token — PgBoss is a third-party class, keyed by a symbol like the domain ports. */
export const PG_BOSS = Symbol('PgBoss');

/**
 * The api publishes and reads queue state for readiness; it must never
 * compete with the worker for maintenance or consume jobs. The worker is
 * the single process that supervises, maintains and consumes (SPEC 04
 * Scope). Everything that differs between the two processes' `PgBoss`
 * instance is decided here, from this one flag.
 */
export type PgBossRole = 'api' | 'worker';

/** pg-boss's own pool, separate from TypeORM's (SPEC 04 Decisions, "The worker, its connections and shutdown"). */
const PGBOSS_POOL_SIZE_API = 2;
const PGBOSS_POOL_SIZE_WORKER = 5;

/**
 * One `PgBoss` instance per process, started and with its queues created
 * before anything else can observe it (`useFactory` may return a Promise —
 * Nest awaits it before resolving any consumer's constructor). `role`
 * decides pool size, whether this instance supervises/schedules maintenance,
 * and whether it holds the dedicated LISTEN/NOTIFY connection (`worker`
 * only — SPEC 04 step 1 finding on `useListenNotify`).
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
      // PgBoss extends EventEmitter and emits 'error' whenever its pool
      // loses a connection (e.g. Postgres restarting) — Node's own
      // EventEmitter convention throws an unhandled exception and crashes
      // the whole process if 'error' has no listener. Found the hard way:
      // GET /health/ready during `docker compose stop postgres` killed the
      // api outright instead of degrading, which R3.1 explicitly forbids
      // ("/health returns 200 while postgres is stopped").
      boss.on('error', (error: unknown) => {
        logger.error(error instanceof Error ? error.message : String(error));
      });
      await boss.start();
      await setupQueues(boss);
      return boss;
    },
  };
}
