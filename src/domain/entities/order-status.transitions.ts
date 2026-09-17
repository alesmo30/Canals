import { OrderStatus } from '../enum-types/order-status';

/**
 * R0.5 (frozen contract): the order state machine, as one readable
 * transition table, from architectural-requirements.md's diagram and FR-5
 * phase 3's settle outcomes:
 *
 *   PENDING_PAYMENT -> PAID -> CONFIRMED
 *   PENDING_PAYMENT -> PAYMENT_FAILED
 *   PENDING_PAYMENT -> CANCELLED (reservation expired)
 *
 * PAYMENT_FAILED and CANCELLED are both terminal, with no transition
 * between them — despite the ASCII diagram in architectural-requirements.md
 * drawing an arrow from PAYMENT_FAILED to CANCELLED. Three independent
 * passages of that same document disagree with that arrow: the
 * order_status enum's own note calls PAYMENT_FAILED terminal, FR-5 phase 3
 * lists exactly three settle outcomes with nothing past PAYMENT_FAILED, and
 * the reservation reaper / reconciliation job only ever act on orders still
 * PENDING_PAYMENT. Read the diagram's arrow as a layout artifact, not a
 * fourth transition — flagged when this was implemented (step 4/5), no
 * objection raised.
 */
const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
    PAID: ['CONFIRMED'],
    CONFIRMED: [],
    PAYMENT_FAILED: [],
    CANCELLED: [],
  };

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Throws if `from -> to` is not one of the edges in ORDER_TRANSITIONS. */
export function assertValidOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw new Error(`Illegal order status transition: ${from} -> ${to}`);
  }
}
