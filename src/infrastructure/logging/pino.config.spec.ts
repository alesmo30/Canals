import { Writable } from 'node:stream';

import pino from 'pino';

import { pinoOptions } from './pino.config';
import { correlationStorage } from '../observability/correlation';

function createCapturingStream(): {
  stream: Writable;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('pinoOptions', () => {
  it('redacts a card number in a logged object and in free text, in the captured JSON output', () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(pinoOptions, stream);

    logger.info({
      cardNumber: '4242424242424242',
      note: 'pan 4242424242424242',
    });

    const [line] = lines();
    const serialised = JSON.stringify(line);

    expect(line.cardNumber).toBe('************4242');
    expect(line.note).toBe('pan ************4242');
    expect(serialised).not.toContain('4242424242424242');
  });

  it('SPEC 04 step 7 Risks — the mixin-added correlationId does not let a card number bypass redact()', () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(pinoOptions, stream);

    correlationStorage.run({ correlationId: 'corr-abc-123' }, () => {
      logger.info({ cardNumber: '4242424242424242' });
    });

    const [line] = lines();
    expect(line.correlationId).toBe('corr-abc-123');
    expect(line.cardNumber).toBe('************4242');
    expect(JSON.stringify(line)).not.toContain('4242424242424242');
  });

  it('adds no correlationId field when logging outside any correlationStorage.run()', () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(pinoOptions, stream);

    logger.info({ hello: 'world' });

    const [line] = lines();
    expect(line.correlationId).toBeUndefined();
  });
});
