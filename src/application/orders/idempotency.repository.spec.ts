import { createHash } from 'crypto';

import { computeRequestFingerprint } from './idempotency.repository';

describe('computeRequestFingerprint', () => {
  it('is the same for the same body regardless of key order', () => {
    const a = computeRequestFingerprint({
      customerId: 'x',
      items: [{ productId: 'p', quantity: 1 }],
    });
    const b = computeRequestFingerprint({
      items: [{ quantity: 1, productId: 'p' }],
      customerId: 'x',
    });

    expect(a).toBe(b);
  });

  it('differs when the body differs', () => {
    const a = computeRequestFingerprint({ customerId: 'x' });
    const b = computeRequestFingerprint({ customerId: 'y' });

    expect(a).not.toBe(b);
  });

  it('matches sha256 of the sorted-key, no-whitespace JSON', () => {
    const expected = createHash('sha256')
      .update(JSON.stringify({ a: 1, b: 2 }))
      .digest('hex');

    expect(computeRequestFingerprint({ b: 2, a: 1 })).toBe(expected);
  });
});
