export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * specs/05-order-creation-saga.md — the decision `POST /orders`'
 * controller (step 12) makes once it has tried to insert the request's
 * `Idempotency-Key` and looked up any existing row.
 */
export interface IdempotencyCheckResult {
  outcome: 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT';
  storedResponse?: StoredResponse;
}
