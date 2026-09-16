import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { validateEnv } from '../config/env.schema';

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
  // Only the ten persistence entities (step 9) — `entities/` holds nothing
  // but *.orm-entity files; the suffix is a defensive filter against a
  // future *.orm-entity.spec.ts landing in the same folder.
  entities: [__dirname + '/entities/*.orm-entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // R0.4: synchronize: false in every environment. Migrations are the only
  // way the schema changes.
  synchronize: false,
  logging: false,
});
