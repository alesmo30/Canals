import { join } from 'path';

/**
 * Shared between data-source.ts (the TypeORM CLI entrypoint) and
 * shared.module.ts (the app's own TypeOrmModule wiring), so the entity
 * list has exactly one place to define. Deliberately has no dependency on
 * env.schema.ts or anything else with a side effect at import time —
 * shared.module.ts must be able to import this without transitively
 * triggering data-source.ts's own validateEnv(process.env) call.
 *
 * Resolved from this file's own __dirname, not the importer's, so it is
 * correct regardless of which of the two files imports it.
 */
export const PERSISTENCE_ENTITIES = [
  join(__dirname, 'entities', '*.orm-entity.{ts,js}'),
];
