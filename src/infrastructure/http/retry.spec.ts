import { withRetry } from './retry';

class TransientError extends Error {}
class TerminalError extends Error {}

function isTransientError(outcome: unknown): boolean {
  return outcome instanceof TransientError;
}

describe('withRetry', () => {
  it('resolves on attempt 2 after one transient failure', async () => {
    let calls = 0;
    const operation = jest.fn((): Promise<string> =>
      calls++ === 0
        ? Promise.reject(new TransientError('temporary'))
        : Promise.resolve('ok'),
    );

    const result = await withRetry(operation, {
      baseDelayMs: 0,
      isTransient: isTransientError,
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient failure', async () => {
    const operation = jest.fn((): Promise<never> =>
      Promise.reject(new TerminalError('final')),
    );

    await expect(
      withRetry(operation, { baseDelayMs: 0, isTransient: isTransientError }),
    ).rejects.toThrow(TerminalError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('surfaces the last outcome after three transient failures', async () => {
    const errors = [
      new TransientError('1'),
      new TransientError('2'),
      new TransientError('3'),
    ];
    let calls = 0;
    const operation = jest.fn((): Promise<never> =>
      Promise.reject(errors[calls++]),
    );

    await expect(
      withRetry(operation, { baseDelayMs: 0, isTransient: isTransientError }),
    ).rejects.toBe(errors[2]);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('retries a resolved value the predicate marks transient, and returns the first non-transient value', async () => {
    const values = ['retry-me', 'retry-me', 'final'];
    let calls = 0;
    const operation = jest.fn((): Promise<string> =>
      Promise.resolve(values[calls++]),
    );
    const isTransient = (outcome: unknown) => outcome === 'retry-me';

    const result = await withRetry(operation, { baseDelayMs: 0, isTransient });

    expect(result).toBe('final');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('returns the last transient value once maxAttempts is exhausted, without throwing', async () => {
    const operation = jest.fn((): Promise<string> =>
      Promise.resolve('always-transient'),
    );
    const isTransient = () => true;

    const result = await withRetry(operation, { baseDelayMs: 0, isTransient });

    expect(result).toBe('always-transient');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('never retries beyond a custom maxAttempts', async () => {
    const operation = jest.fn((): Promise<never> =>
      Promise.reject(new TransientError('always fails')),
    );

    await expect(
      withRetry(operation, {
        maxAttempts: 1,
        baseDelayMs: 0,
        isTransient: isTransientError,
      }),
    ).rejects.toThrow(TransientError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('waits a full-jitter delay, bounded by baseDelayMs * 2^(attempt-1), between attempts', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.useFakeTimers();

    try {
      let calls = 0;
      const operation = jest.fn((): Promise<string> =>
        calls++ === 0
          ? Promise.reject(new TransientError('temporary'))
          : Promise.resolve('ok'),
      );

      const promise = withRetry(operation, {
        baseDelayMs: 200,
        isTransient: isTransientError,
      });
      // Let the first attempt run and schedule its backoff timer.
      await Promise.resolve();
      await Promise.resolve();

      // Attempt 1 failed: cap is 200 * 2^0 = 200, so the 0.5-mocked delay is 100ms.
      await jest.advanceTimersByTimeAsync(99);
      expect(operation).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(operation).toHaveBeenCalledTimes(2);

      const result = await promise;
      expect(result).toBe('ok');
    } finally {
      jest.useRealTimers();
      randomSpy.mockRestore();
    }
  });
});
