import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { validateEnv } from '../config/env.schema';
import { PERSISTENCE_ENTITIES } from './persistence-entities';

/**
 * TypeORM CLI entrypoint (migration:*). Runs outside Nest, so it validates
 * process.env with the same Zod schema.
 */
const config = validateEnv(process.env);

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  entities: PERSISTENCE_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // synchronize: false everywhere — migrations are the only way the schema changes.
  synchronize: false,
  logging: false,
});
