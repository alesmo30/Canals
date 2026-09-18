import { createHash } from 'node:crypto';

/**
 * The fingerprint behind `422 idempotency_key_reused`: `sha256` of
 * `last4|amountCents|currency|description`. The full card number is never
 * part of it — nor stored anywhere in this service.
 */
export function computeRequestHash(params: {
  last4: string;
  amountCents: number;
  currency: string;
  description: string;
}): string {
  const { last4, amountCents, currency, description } = params;
  return createHash('sha256')
    .update(`${last4}|${amountCents}|${currency}|${description}`)
    .digest('hex');
}
