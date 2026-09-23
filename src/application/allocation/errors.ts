/**
 * Raised by reserve when stock is insufficient under the lock or
 * lock_timeout fires; the use case moves to the next candidate.
 */
export class InsufficientStockError extends Error {
  constructor(public readonly productIds: string[]) {
    super(`Insufficient stock for product ids: ${productIds.join(', ')}`);
    this.name = 'InsufficientStockError';
  }
}

/**
 * NO_CANDIDATES: no warehouse qualified at selection. RESERVATION_RACE_LOST:
 * candidates qualified but each lost the stock to a concurrent order first.
 */
export type NoFulfilmentPossibleReason =
  'NO_CANDIDATES' | 'RESERVATION_RACE_LOST';

/**
 * No candidate qualifies, or every attempt failed. Mapped to 422
 * (NO_CANDIDATES) or 409 (RESERVATION_RACE_LOST).
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
