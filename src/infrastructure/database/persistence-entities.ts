import { join } from 'path';

/**
 * Shared by data-source.ts and shared.module.ts. Must stay free of
 * import-time side effects so shared.module.ts doesn't trigger
 * data-source.ts's validateEnv(). Resolved from this file's own __dirname.
 */
export const PERSISTENCE_ENTITIES = [
  join(__dirname, 'entities', '*.orm-entity.{ts,js}'),
];
