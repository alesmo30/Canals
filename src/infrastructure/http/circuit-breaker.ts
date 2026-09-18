import { Logger } from '@nestjs/common';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_OPEN_MS = 30_000;

export interface CircuitBreakerOptions {
  /** Appears in the log line. */
  name: 'payments' | 'geoapify';
  failureThreshold: number;
  openMs: number;
  /** Injectable clock; `Date.now` in production. */
  now: () => number;
}

export type CircuitBreakerConstructorOptions = Partial<
  Pick<CircuitBreakerOptions, 'failureThreshold' | 'openMs' | 'now'>
> &
  Pick<CircuitBreakerOptions, 'name'>;

/** Thrown by `execute()` when the breaker rejects a call outright. Infrastructure-internal — never crosses a port. */
export class CircuitOpenError extends Error {
  constructor(breakerName: string) {
    super(`Circuit breaker '${breakerName}' is open`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * SPEC 03: hand-written, three states, one breaker per provider
 * (`HttpPaymentGateway`'s `charge()`/`getStatus()` share one; Geoapify has
 * its own). Counts each failed *attempt* — every `execute()` call whose
 * operation throws — not each exhausted retry loop; `retry.ts` calls
 * `execute()` once per attempt, so five failed attempts can come from as
 * few as two orders (Decisions).
 *
 * `execute()` takes no failure classifier: whatever the operation throws
 * counts as a failure, whatever it resolves counts as a success. The
 * caller (`HttpPaymentGateway`/`GeoapifyGeocodingProvider`) decides what
 * that means — a 402 or a 404 from `getStatus` resolves normally and
 * never reaches here as a failure, only a 5xx, a network error or a
 * timeout does.
 */
export class CircuitBreaker {
  private readonly options: CircuitBreakerOptions;
  private readonly logger: Logger;

  private currentState: BreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;

  constructor(options: CircuitBreakerConstructorOptions) {
    this.options = {
      name: options.name,
      failureThreshold: options.failureThreshold ?? BREAKER_FAILURE_THRESHOLD,
      openMs: options.openMs ?? BREAKER_OPEN_MS,
      now: options.now ?? Date.now,
    };
    this.logger = new Logger(`CircuitBreaker:${this.options.name}`);
  }

  get state(): BreakerState {
    return this.currentState;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();

    if (this.currentState === 'OPEN') {
      throw new CircuitOpenError(this.options.name);
    }

    if (this.currentState === 'HALF_OPEN') {
      // Exactly one probe through; a concurrent second call is rejected
      // outright — set synchronously, before the first `await`, so two
      // calls made back to back can never both see it unset.
      if (this.halfOpenProbeInFlight) {
        throw new CircuitOpenError(this.options.name);
      }
      this.halfOpenProbeInFlight = true;
      try {
        return await this.runAndRecord(operation);
      } finally {
        this.halfOpenProbeInFlight = false;
      }
    }

    return this.runAndRecord(operation);
  }

  private async runAndRecord<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private maybeHalfOpen(): void {
    const openLongEnough =
      this.openedAt !== null &&
      this.options.now() - this.openedAt >= this.options.openMs;
    if (this.currentState === 'OPEN' && openLongEnough) {
      this.transitionTo('HALF_OPEN');
    }
  }

  private onSuccess(): void {
    if (this.currentState === 'HALF_OPEN') {
      this.consecutiveFailures = 0;
      this.transitionTo('CLOSED');
      return;
    }
    // CLOSED: one success resets the counter (Decisions).
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    if (this.currentState === 'HALF_OPEN') {
      this.openedAt = this.options.now();
      this.transitionTo('OPEN');
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.openedAt = this.options.now();
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(next: BreakerState): void {
    const from = this.currentState;
    this.currentState = next;
    this.logger.warn({
      breaker: this.options.name,
      from,
      to: next,
      consecutiveFailures: this.consecutiveFailures,
    });
  }
}
