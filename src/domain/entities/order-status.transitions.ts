import { OrderStatus } from '../enum-types/order-status';

/**
 * The order state machine. PAYMENT_FAILED and CANCELLED are both terminal,
 * with no edge between them. See knowledge/domain.md#order-state-machine
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
