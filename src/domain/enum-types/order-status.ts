/**
 * Mirrors the `order_status` Postgres enum (data-model.dbml). The allowed
 * transitions between these values are defined separately in
 * order-status.transitions.ts, not here — this file is just the value set.
 */
export type OrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'PAYMENT_FAILED' | 'CANCELLED';
