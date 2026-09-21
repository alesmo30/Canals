import { EVENT_ROUTING, UnroutedEventError } from './event-routing';

describe('EVENT_ROUTING', () => {
  it('routes order.confirmed to the three P3 queues', () => {
    expect(EVENT_ROUTING['order.confirmed']).toEqual([
      'shipment.create',
      'customer.notify',
      'analytics.record',
    ]);
  });

  it('has no entry for an unknown event type', () => {
    expect(EVENT_ROUTING['unknown.event']).toBeUndefined();
  });
});

describe('UnroutedEventError', () => {
  it('names the offending event type', () => {
    const error = new UnroutedEventError('unknown.event');

    expect(error.name).toBe('UnroutedEventError');
    expect(error.eventType).toBe('unknown.event');
    expect(error.message).toContain('unknown.event');
  });
});
