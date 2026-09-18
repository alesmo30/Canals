export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';

export interface CardDescription {
  last4: string;
  brand: CardBrand;
}

/**
 * SPEC 03: `cardLast4`/`cardBrand` are derived locally from the PAN, not
 * read off the provider's response — the alternative leaves them `null`
 * on exactly the rows reconciliation needs (a timeout, a `500`, an open
 * breaker), since no response ever arrived to read them from.
 *
 * Prefix ranges: Visa `4` · Mastercard `51`–`55`, `2221`–`2720` · Amex
 * `34`, `37` · Discover `6011`, `644`–`649`, `65` · anything else
 * `'unknown'`.
 */
export function describeCard(pan: string): CardDescription {
  const digits = pan.replace(/\D/g, '');
  return {
    last4: digits.slice(-4),
    brand: describeBrand(digits),
  };
}

function describeBrand(digits: string): CardBrand {
  if (digits.startsWith('4')) {
    return 'visa';
  }
  if (isMastercard(digits)) {
    return 'mastercard';
  }
  if (digits.startsWith('34') || digits.startsWith('37')) {
    return 'amex';
  }
  if (isDiscover(digits)) {
    return 'discover';
  }
  return 'unknown';
}

function isMastercard(digits: string): boolean {
  const twoDigitPrefix = Number(digits.slice(0, 2));
  if (twoDigitPrefix >= 51 && twoDigitPrefix <= 55) {
    return true;
  }
  const fourDigitPrefix = Number(digits.slice(0, 4));
  return fourDigitPrefix >= 2221 && fourDigitPrefix <= 2720;
}

function isDiscover(digits: string): boolean {
  if (digits.startsWith('6011')) {
    return true;
  }
  const threeDigitPrefix = Number(digits.slice(0, 3));
  if (threeDigitPrefix >= 644 && threeDigitPrefix <= 649) {
    return true;
  }
  return digits.startsWith('65');
}
