export interface OrderCursor {
  createdAt: Date;
  id: string;
}

/**
 * specs/06-read-side.md — raised by `decodeCursor` when the client-supplied
 * cursor is not something this module produced. Mapped to `400`, same
 * bucket as an invalid query param (Decisions).
 */
export class InvalidCursorError extends Error {
  constructor(public readonly cursor: string) {
    super(`Invalid cursor: ${cursor}`);
    this.name = 'InvalidCursorError';
  }
}

/**
 * specs/06-read-side.md — `base64("${createdAt.toISOString()}|${id}")`.
 * Not JSON: the client only ever reflects this value back, never parses
 * it (Decisions).
 */
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
