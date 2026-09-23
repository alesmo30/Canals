/**
 * Pins ChargeResult.failureCode values. In the domain so the application
 * never imports infrastructure.
 */
export const PAYMENT_FAILURE_CODES = [
  'CARD_DECLINED', // 402 — DECLINED
  'TIMEOUT', // AbortSignal.timeout fired on the last attempt
  'PROVIDER_ERROR', // 5xx on the last attempt
  'CONNECTION_REFUSED', // ECONNREFUSED — provably never reached the provider
  'NETWORK_ERROR', // ECONNRESET, DNS failure… — may have reached it
  'CIRCUIT_OPEN', // rejected by the breaker, never sent
  'INVALID_REQUEST', // 400 / 422 from the provider — a bug on our side
  'NOT_FOUND', // getStatus only: the provider never stored this key
] as const;

export type PaymentFailureCode = (typeof PAYMENT_FAILURE_CODES)[number];
