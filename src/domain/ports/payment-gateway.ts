import { PaymentStatus } from '../enum-types/payment-status';

/**
 * FR-4's exact field list: `charge({ cardNumber, amountMinor, currency,
 * description, idempotencyKey })`. Flat primitives, not a `Money` value
 * object — this crosses the boundary to an external HTTP payment provider
 * that expects wire-format JSON, not a domain type.
 */
export interface ChargeCommand {
  cardNumber: string;
  /** Amount in the currency's smallest unit (cents for USD). */
  amountMinor: number;
  currency: string;
  description: string;
  /** Derived from the order id + attempt (FR-5) so a retry can never double-charge. */
  idempotencyKey: string;
}

/**
 * Enough to persist a `payments` row and decide the order's next
 * transition. `status` reuses the domain's own PaymentStatus — including
 * `UNKNOWN` for a provider timeout, resolved later by reconciliation
 * (FR-4/FR-5).
 */
export interface ChargeResult {
  status: PaymentStatus;
  providerPaymentId: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  failureCode: string | null;
  /** Redacted gateway payload, opaque to the domain — never the full PAN (FR-4). */
  rawResponse: Record<string, unknown> | null;
}

/**
 * R0.6 (frozen contract). Implemented by P2 (`MockPaymentGateway`,
 * deterministic by card number per FR-4's outcome table) and consumed by
 * P4's payment phase and the reconciliation job (FR-5).
 */
export interface PaymentGateway {
  charge(command: ChargeCommand): Promise<ChargeResult>;
  /** Reconciliation: the authoritative status of a prior charge, by its idempotency key. */
  getStatus(idempotencyKey: string): Promise<ChargeResult>;
}

/** DI token — PaymentGateway is an interface and has no runtime value to key on. */
export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
