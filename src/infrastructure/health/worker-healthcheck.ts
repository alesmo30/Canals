import { existsSync } from 'node:fs';

import { Client } from 'pg';

import { WORKER_READINESS_FILE_PATH } from './worker-readiness';
import { validateEnv } from '../config/env.schema';

/**
 * Docker healthcheck for the port-less worker: readiness file plus a bare
 * pg.Client (lighter than a DataSource).
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
