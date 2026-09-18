import { Writable } from 'node:stream';

import pino from 'pino';

import { pinoOptions } from './pino.config';

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
});
