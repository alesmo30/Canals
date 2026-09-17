/** Mirrors the `payment_status` Postgres enum (data-model.dbml). */
export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'DECLINED'
  | 'FAILED'
  // Provider timeout. Resolved by the reconciliation job (FR-5).
  | 'UNKNOWN'
  | 'REFUNDED';
