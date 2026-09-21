import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * SPEC 04 Data model, "Correlation context". Written by the api's
 * correlation middleware and by the `JobRunner` (restoring a job's
 * publishing-time id); read by the pino `mixin` and by
 * `PgBossEventPublisher`.
 */
export interface CorrelationStore {
  readonly correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
