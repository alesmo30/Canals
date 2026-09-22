import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from './cursor.helpers';

describe('cursor.helpers', () => {
  it('round-trips encodeCursor -> decodeCursor', () => {
    const original = {
      createdAt: new Date('2026-01-15T10:30:00.000Z'),
      id: 'a1b2c3',
    };

    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded.createdAt.toISOString()).toBe(
      original.createdAt.toISOString(),
    );
    expect(decoded.id).toBe(original.id);
  });

  it('throws InvalidCursorError when the decoded value has no "|" separator', () => {
    const cursor = Buffer.from('no-separator-here').toString('base64');

    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError when the decoded value has more than one "|"', () => {
    const cursor = Buffer.from('a|b|c').toString('base64');

    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError when the date part does not parse', () => {
    const cursor = Buffer.from('not-a-date|a1b2c3').toString('base64');

    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });
});
