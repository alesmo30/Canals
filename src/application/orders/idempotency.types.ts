export interface StoredResponse {
  status: number;
  body: unknown;
}

/** Outcome of trying to insert the Idempotency-Key and reading any existing row. */
export interface IdempotencyCheckResult {
  outcome: 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT';
  storedResponse?: StoredResponse;
}
