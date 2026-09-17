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
