import { toMovementEvent } from './timeline.helpers';

describe('toMovementEvent', () => {
  const base = {
    available_after: 9,
    reserved_after: 0,
    reason: null,
    created_at: new Date('2026-09-22T10:00:00.000Z'),
    product_sku: 'APL-IP17-256-BLK',
    warehouse_name: 'Newark DC',
  };

  it('names the quantity for a RESERVE', () => {
    const event = toMovementEvent({
      ...base,
      type: 'RESERVE',
      quantity_delta: -2,
    });
    expect(event.title).toBe('Reserved 2 × APL-IP17-256-BLK at Newark DC');
    expect(event.phase).toBe('RESERVE');
  });

  it('does not print "0 ×" for a COMMIT, whose delta on available stock is 0', () => {
    const event = toMovementEvent({
      ...base,
      type: 'COMMIT',
      quantity_delta: 0,
    });
    expect(event.title).toBe(
      'Committed reservation of APL-IP17-256-BLK at Newark DC',
    );
    expect(event.phase).toBe('SETTLE');
    expect(event.outcome).toBe('OK');
  });

  it('shows a RELEASE as the FAILED (compensating) path', () => {
    const event = toMovementEvent({
      ...base,
      type: 'RELEASE',
      quantity_delta: 1,
    });
    expect(event.outcome).toBe('FAILED');
  });
});
