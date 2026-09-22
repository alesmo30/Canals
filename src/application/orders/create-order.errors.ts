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

/** specs/05-order-creation-saga.md, R4.5's Phase-3 errors — both are only ever raised after the order row exists (SPEC 07 Fix C), so both carry its id. */
export interface PaymentOutcomeErrorParams {
  orderId: string;
  failureCode: string | null;
}

/**
 * specs/05-order-creation-saga.md, R4.5 — raised in Phase 3 (step 11) when
 * `ChargeResult.status === 'DECLINED'`. Terminal: the order becomes
 * `PAYMENT_FAILED` and stock is released before this is thrown. Maps to
 * `402`. `orderId` is not exposed on the `402` response body (Decisions —
 * a `402` is terminal, the client re-posts a new order) but is still
 * recorded in `idempotency_keys.order_id` (SPEC 07 Fix C).
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
 * specs/05-order-creation-saga.md, R4.5 — raised in Phase 3 (step 11) when
 * `ChargeResult.status === 'UNKNOWN'` (provider timeout, connection
 * refused, circuit open — SPEC 03's handoff). The order stays
 * `PENDING_PAYMENT` with its reservation intact; P6's reconciliation
 * decides its fate. Maps to `502`.
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
