/**
 * specs/02-fulfilment-core.md — raised by `InventoryService.reserve` when
 * availability fails under the lock, or when `lock_timeout` fires.
 * `AllocateInventoryUseCase` catches it and moves to the next candidate
 * (R1.3's failover loop).
 */
export class InsufficientStockError extends Error {
  constructor(public readonly productIds: string[]) {
    super(`Insufficient stock for product ids: ${productIds.join(', ')}`);
    this.name = 'InsufficientStockError';
  }
}

/**
 * specs/02-fulfilment-core.md — raised by `AllocateInventoryUseCase` when
 * no candidate warehouse qualifies, or every attempt is exhausted.
 * Carries the unsatisfiable product ids, which P4's 422 response will
 * need.
 */
export class NoFulfilmentPossibleError extends Error {
  constructor(public readonly productIds: string[]) {
    super(`No fulfilment possible for product ids: ${productIds.join(', ')}`);
    this.name = 'NoFulfilmentPossibleError';
  }
}
