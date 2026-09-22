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

  it('SPEC 07 Fix A — redacts a card number in a plain message string', () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(pinoOptions, stream);

    logger.info('card 4242424242424242 failed');

    const [line] = lines();
    expect(line.msg).toBe('card ************4242 failed');
    expect(JSON.stringify(line)).not.toContain('4242424242424242');
  });

  it('SPEC 07 Fix A — redacts a secret in a printf-style message alongside a merge object', () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(pinoOptions, stream);

    logger.info({ a: 1 }, 'geocoding failed for ?apiKey=abc');

    const [line] = lines();
    expect(line.a).toBe(1);
    expect(line.msg).toBe('geocoding failed for ?apiKey=[REDACTED]');
  });

  it('SPEC 07 Fix A — redacts a card number in a logged Error message', () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(pinoOptions, stream);

    logger.error(new Error('charge failed for 4242424242424242'));

    const [line] = lines();
    expect(JSON.stringify(line)).not.toContain('4242424242424242');
    expect(line.message).toBe('charge failed for ************4242');
  });
});
