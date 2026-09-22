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
 * specs/05-order-creation-saga.md, Decisions — which of the two distinct
 * root causes `AllocateInventoryUseCase` collapsed into one error class
 * (specs/02-fulfilment-core.md originally mapped both to a single `422`;
 * P4 overrides that to restore R4.5's `422`/`409` split):
 *
 * - `NO_CANDIDATES` — the selection query itself returned zero
 *   candidates; no warehouse ever qualified for this order.
 * - `RESERVATION_RACE_LOST` — one or more candidates qualified at
 *   selection time, but every one of them lost the product to a
 *   concurrent order before this order's own attempt could lock it.
 */
export type NoFulfilmentPossibleReason =
  'NO_CANDIDATES' | 'RESERVATION_RACE_LOST';

/**
 * specs/02-fulfilment-core.md — raised by `AllocateInventoryUseCase` when
 * no candidate warehouse qualifies, or every attempt is exhausted.
 * Carries the unsatisfiable product ids and, per specs/05's override
 * above, which of the two root causes applied — P4's `problem-details.filter.ts`
 * maps `NO_CANDIDATES` to `422` and `RESERVATION_RACE_LOST` to `409`.
 */
export class NoFulfilmentPossibleError extends Error {
  constructor(
    public readonly productIds: string[],
    public readonly reason: NoFulfilmentPossibleReason,
  ) {
    super(`No fulfilment possible for product ids: ${productIds.join(', ')}`);
    this.name = 'NoFulfilmentPossibleError';
  }
}
