export interface BuildChargeIdempotencyKeyParams {
  orderId: string;
  attempt: number;
}

/**
 * specs/05-order-creation-saga.md — the value passed as
 * `ChargeCommand.idempotencyKey` (domain/ports/payment-gateway.ts). Pure,
 * no infrastructure dependency — `attempt` is always `1` today (a second
 * charge attempt is out of scope, per SPEC 03's handoff).
 */
export function buildChargeIdempotencyKey(
  params: BuildChargeIdempotencyKeyParams,
): string {
  return `order:${params.orderId}:attempt:${params.attempt}`;
}
