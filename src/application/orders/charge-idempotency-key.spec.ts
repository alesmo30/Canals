import { buildChargeIdempotencyKey } from './charge-idempotency-key';

describe('buildChargeIdempotencyKey', () => {
  it('builds order:<orderId>:attempt:<attempt>', () => {
    expect(buildChargeIdempotencyKey({ orderId: 'x', attempt: 1 })).toBe(
      'order:x:attempt:1',
    );
  });
});
