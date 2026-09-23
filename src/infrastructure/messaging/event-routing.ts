/**
 * Deliberately minimal: handlers read current state from the DB, so a late
 * job never acts on a stale copy.
 */
export interface OrderConfirmedPayload {
  readonly orderId: string;
  readonly occurredAt: string;
}

/**
 * Routing lives in code, not in pg-boss publish/subscribe: a missing
 * subscribe() would silently drop events.
 */
export const EVENT_ROUTING: Readonly<Record<string, readonly string[]>> = {
  'order.confirmed': ['shipment.create', 'customer.notify', 'analytics.record'],
};

/** A typo in an event type must fail loudly at publish time, not vanish. */
export class UnroutedEventError extends Error {
  constructor(public readonly eventType: string) {
    super(`No route configured for event type: ${eventType}`);
    this.name = 'UnroutedEventError';
  }
}
