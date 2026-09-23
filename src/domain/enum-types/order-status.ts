/** Mirrors the `order_status` Postgres enum. Allowed transitions live in order-status.transitions.ts. */
export type OrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'PAYMENT_FAILED' | 'CANCELLED';
