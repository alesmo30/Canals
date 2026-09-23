import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from './cursor.helpers';

describe('cursor.helpers', () => {
  it('round-trips encodeCursor -> decodeCursor keeping microseconds', () => {
    const original = {
      createdAt: '2026-01-15T10:30:00.123456Z',
      id: 'a1b2c3',
    };

    expect(decodeCursor(encodeCursor(original))).toEqual(original);
  });

  it('still accepts a millisecond cursor issued before the microsecond fix', () => {
    const cursor = Buffer.from('2026-01-15T10:30:00.123Z|a1b2c3').toString(
      'base64',
    );

    expect(decodeCursor(cursor)).toEqual({
      createdAt: '2026-01-15T10:30:00.123Z',
      id: 'a1b2c3',
    });
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
