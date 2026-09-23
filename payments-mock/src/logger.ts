import pino from 'pino';

/**
 * Shared structured logger. Silenced under Jest (NODE_ENV=test, set by
 * Jest itself) so `npm test` output stays clean; LOG_LEVEL overrides both.
 */
const level =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const logger = pino({ level });
