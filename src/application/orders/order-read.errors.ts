/** No row for :id, or :id not UUID-shaped (indistinguishable to the client). Maps to 404. */
export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}
