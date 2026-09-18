import { Logger } from '@nestjs/common';

import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

class FakeClock {
  private currentTime = 0;

  now = (): number => this.currentTime;

  advanceBy(ms: number): void {
    this.currentTime += ms;
  }
}

function fail<T = never>(): Promise<T> {
  return Promise.reject(new Error('operation failed'));
}

function succeed<T>(value: T): () => Promise<T> {
  return () => Promise.resolve(value);
}

describe('CircuitBreaker', () => {
  let clock: FakeClock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    clock = new FakeClock();
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function buildBreaker(
    overrides: Partial<{ failureThreshold: number; openMs: number }> = {},
  ): CircuitBreaker {
    return new CircuitBreaker({
      name: 'payments',
      now: clock.now,
      failureThreshold: overrides.failureThreshold ?? 5,
      openMs: overrides.openMs ?? 30_000,
    });
  }

  it('starts CLOSED', () => {
    const breaker = buildBreaker();
    expect(breaker.state).toBe('CLOSED');
  });

  it('opens after five consecutive failures', async () => {
    const breaker = buildBreaker();

    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('operation failed');
    }

    expect(breaker.state).toBe('OPEN');
  });

  it('rejects a call inside the open window without invoking the operation', async () => {
    const breaker = buildBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.state).toBe('OPEN');

    clock.advanceBy(29_999);
    const operation = jest.fn(succeed('should not run'));

    await expect(breaker.execute(operation)).rejects.toThrow(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('lets exactly one probe through at the open window boundary, rejecting a concurrent second call', async () => {
    const breaker = buildBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    clock.advanceBy(30_000);

    let resolveProbe!: (value: string) => void;
    const probe = new Promise<string>((resolve) => {
      resolveProbe = resolve;
    });
    const slowOperation = jest.fn(() => probe);
    const skippedOperation = jest.fn(succeed('should not run'));

    const firstCall = breaker.execute(slowOperation);
    const secondCall = breaker.execute(skippedOperation);

    await expect(secondCall).rejects.toThrow(CircuitOpenError);
    expect(skippedOperation).not.toHaveBeenCalled();
    expect(slowOperation).toHaveBeenCalledTimes(1);

    resolveProbe('probe result');
    await expect(firstCall).resolves.toBe('probe result');
  });

  it('closes on a successful probe', async () => {
    const breaker = buildBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    clock.advanceBy(30_000);

    await expect(breaker.execute(succeed('ok'))).resolves.toBe('ok');

    expect(breaker.state).toBe('CLOSED');
  });

  it('reopens on a failed probe', async () => {
    const breaker = buildBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    clock.advanceBy(30_000);

    await expect(breaker.execute(fail)).rejects.toThrow();

    expect(breaker.state).toBe('OPEN');

    // Immediately after reopening, still inside its own fresh window.
    const operation = jest.fn(succeed('should not run'));
    await expect(breaker.execute(operation)).rejects.toThrow(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('resets the failure counter on one success while CLOSED', async () => {
    const breaker = buildBreaker();

    for (let i = 0; i < 4; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.state).toBe('CLOSED');

    await expect(breaker.execute(succeed('ok'))).resolves.toBe('ok');

    for (let i = 0; i < 4; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.state).toBe('CLOSED');
  });

  it('logs every state change at warn, naming the breaker and both states', async () => {
    const breaker = buildBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        breaker: 'payments',
        from: 'CLOSED',
        to: 'OPEN',
        consecutiveFailures: 5,
      }),
    );
  });
});
