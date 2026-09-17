import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { validateEnv } from '../config/env.schema';
import { PERSISTENCE_ENTITIES } from './persistence-entities';

/**
 * TypeORM CLI entrypoint — `npm run migration:run` / `migration:generate` /
 * `migration:revert` all point here via `typeorm-ts-node-commonjs -d
 * <this file>`. Runs standalone, outside Nest's DI container, so it
 * validates `process.env` directly through the same Zod schema the app
 * uses at boot (env.schema.ts) rather than duplicating a second, looser
 * check.
 */
const config = validateEnv(process.env);

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  entities: PERSISTENCE_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // R0.4: synchronize: false in every environment. Migrations are the only
  // way the schema changes.
  synchronize: false,
  logging: false,
});
