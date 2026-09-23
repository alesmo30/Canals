/**
 * `createdAt` is Postgres's microsecond ISO string, never a JS `Date`:
 * `Date` truncates to milliseconds and the next page would skip rows.
 * See knowledge/orders-saga.md#cursor-precision.
 */
export interface OrderCursor {
  createdAt: string;
  id: string;
}

/** The cursor wasn't produced by this module. Maps to 400. */
export class InvalidCursorError extends Error {
  constructor(public readonly cursor: string) {
    super(`Invalid cursor: ${cursor}`);
    this.name = 'InvalidCursorError';
  }
}

/** base64("<createdAt ISO>|<id>"). Not JSON: clients only echo it back. */
export function encodeCursor(params: OrderCursor): string {
  return Buffer.from(`${params.createdAt}|${params.id}`).toString('base64');
}

export function decodeCursor(cursor: string): OrderCursor {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const parts = decoded.split('|');

  if (parts.length !== 2) {
    throw new InvalidCursorError(cursor);
  }

  const [createdAt, id] = parts;

  if (Number.isNaN(new Date(createdAt).getTime())) {
    throw new InvalidCursorError(cursor);
  }

  return { createdAt, id };
}
