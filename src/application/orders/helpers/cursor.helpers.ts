export interface OrderCursor {
  createdAt: Date;
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
  return Buffer.from(`${params.createdAt.toISOString()}|${params.id}`).toString(
    'base64',
  );
}

export function decodeCursor(cursor: string): OrderCursor {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const parts = decoded.split('|');

  if (parts.length !== 2) {
    throw new InvalidCursorError(cursor);
  }

  const [createdAtRaw, id] = parts;
  const createdAt = new Date(createdAtRaw);

  if (Number.isNaN(createdAt.getTime())) {
    throw new InvalidCursorError(cursor);
  }

  return { createdAt, id };
}
