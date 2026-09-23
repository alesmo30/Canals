export interface BuildChargeIdempotencyKeyParams {
  orderId: string;
  attempt: number;
}

/**
 * Value passed as ChargeCommand.idempotencyKey. `attempt` is always 1 today
 * (a second charge attempt is out of scope).
 */
export function buildChargeIdempotencyKey(
  params: BuildChargeIdempotencyKeyParams,
): string {
  return `order:${params.orderId}:attempt:${params.attempt}`;
}
