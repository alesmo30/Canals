import { existsSync } from 'node:fs';

import { Client } from 'pg';

import { WORKER_READINESS_FILE_PATH } from './worker-readiness';
import { validateEnv } from '../config/env.schema';

/**
 * SPEC 04 Scope: the worker "having no HTTP port, is checked by `node
 * dist/infrastructure/health/worker-healthcheck.js`" — this is that
 * script, wired as `docker-compose.yml`'s worker `healthcheck:`. Bare
 * `pg.Client`, not `AppDataSource`: Docker runs this on an interval
 * (`docker compose ps`, R3.8) and a lighter connection than a full
 * TypeORM `DataSource` is what a healthcheck should cost.
 */
async function main(): Promise<void> {
  if (!existsSync(WORKER_READINESS_FILE_PATH)) {
    throw new Error(`readiness file missing: ${WORKER_READINESS_FILE_PATH}`);
  }

  const { DATABASE_URL } = validateEnv(process.env);
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console -- Docker HEALTHCHECK output; this bare script has no pino logger.
    console.error('worker healthcheck failed:', error);
    process.exit(1);
  });
