/** customerId doesn't resolve to a customer. Maps to 404. */
export class CustomerNotFoundError extends Error {
  constructor(public readonly customerId: string) {
    super(`Customer not found: ${customerId}`);
    this.name = 'CustomerNotFoundError';
  }
}

/** One or more productIds missing or inactive — 404 either way. */
export class ProductNotFoundError extends Error {
  constructor(public readonly productIds: string[]) {
    super(`Product not found or inactive: ${productIds.join(', ')}`);
    this.name = 'ProductNotFoundError';
  }
}

/** Raised only after the order row exists, so both carry its id. */
export interface PaymentOutcomeErrorParams {
  orderId: string;
  failureCode: string | null;
}

/**
 * DECLINED: the order is already PAYMENT_FAILED and stock released. Maps to
 * 402; orderId isn't in the body (terminal) but is recorded in
 * idempotency_keys.
 */
export class PaymentDeclinedError extends Error {
  public readonly orderId: string;
  public readonly failureCode: string | null;

  constructor({ orderId, failureCode }: PaymentOutcomeErrorParams) {
    super(`Payment declined${failureCode ? ` (${failureCode})` : ''}`);
    this.name = 'PaymentDeclinedError';
    this.orderId = orderId;
    this.failureCode = failureCode;
  }
}

/**
 * UNKNOWN (timeout, connection refused, circuit open): order stays
 * PENDING_PAYMENT with the reservation intact for reconciliation. Maps to
 * 502.
 */
export class PaymentProviderUnavailableError extends Error {
  public readonly orderId: string;
  public readonly failureCode: string | null;

  constructor({ orderId, failureCode }: PaymentOutcomeErrorParams) {
    super(
      `Payment provider unavailable${failureCode ? ` (${failureCode})` : ''}`,
    );
    this.name = 'PaymentProviderUnavailableError';
    this.orderId = orderId;
    this.failureCode = failureCode;
  }
}
