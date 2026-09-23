/** Mirrors the `payment_status` Postgres enum (data-model.dbml). */
export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'DECLINED'
  | 'FAILED'
  // Provider timeout; resolved later by the reconciliation job.
  | 'UNKNOWN'
  | 'REFUNDED';
