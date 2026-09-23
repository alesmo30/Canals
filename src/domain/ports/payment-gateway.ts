import { PaymentStatus } from '../enum-types/payment-status';

/**
 * Flat primitives, not Money: this crosses to an external HTTP provider
 * that expects wire-format JSON.
 */
export interface ChargeCommand {
  cardNumber: string;
  /** Amount in the currency's smallest unit (cents for USD). */
  amountMinor: number;
  currency: string;
  description: string;
  /** Derived from order id + attempt so a retry can never double-charge. */
  idempotencyKey: string;
}

/**
 * Enough to persist a `payments` row and choose the next transition.
 * UNKNOWN (e.g. timeout) is resolved later by reconciliation.
 */
export interface ChargeResult {
  status: PaymentStatus;
  providerPaymentId: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  failureCode: string | null;
  /** Redacted gateway payload, opaque to the domain — never the full PAN. */
  rawResponse: Record<string, unknown> | null;
}

/**
 * Implemented by HttpPaymentGateway; used by the saga's charge phase and by
 * reconciliation.
 */
export interface PaymentGateway {
  charge(command: ChargeCommand): Promise<ChargeResult>;
  /** Reconciliation: the authoritative status of a prior charge, by its idempotency key. */
  getStatus(idempotencyKey: string): Promise<ChargeResult>;
}

/** DI token — PaymentGateway is an interface and has no runtime value to key on. */
export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
