/**
 * SPEC 04 Decisions, "Queue topology and fan-out": routing lives in code, not
 * in pg-boss's own `publish`/`subscribe` table (see that section for why —
 * a `subscribe()` never called by a fresh worker would enqueue nothing and
 * report success, exactly the silent-drop FR-9 exists to prevent).
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
