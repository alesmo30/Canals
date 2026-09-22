/**
 * specs/06-read-side.md — raised when `GET /orders/:id` resolves to no row,
 * or `id` is not shaped like a UUID (Decisions: both are indistinguishable
 * to the client, so both take this path rather than a separate `400`).
 * Maps to `404`, same bucket as `CustomerNotFoundError`/`ProductNotFoundError`.
 */
export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}
