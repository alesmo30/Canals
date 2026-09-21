/**
 * specs/05-order-creation-saga.md — raised when `CreateOrderCommand.customerId`
 * does not resolve to a row in `customers`. Maps to `404`.
 */
export class CustomerNotFoundError extends Error {
  constructor(public readonly customerId: string) {
    super(`Customer not found: ${customerId}`);
    this.name = 'CustomerNotFoundError';
  }
}

/**
 * specs/05-order-creation-saga.md — raised when one or more requested
 * `productId`s do not resolve to an active product row. Covers both
 * "does not exist" and "exists but inactive" — same `404` either way
 * (Decisions).
 */
export class ProductNotFoundError extends Error {
  constructor(public readonly productIds: string[]) {
    super(`Product not found or inactive: ${productIds.join(', ')}`);
    this.name = 'ProductNotFoundError';
  }
}
