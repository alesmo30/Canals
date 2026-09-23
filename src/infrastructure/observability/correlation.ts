import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Written by the correlation middleware and JobRunner; read by the pino
 * mixin and PgBossEventPublisher.
 */
export interface CorrelationStore {
  readonly correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
