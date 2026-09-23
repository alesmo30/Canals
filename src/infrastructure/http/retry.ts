/**
 * Full-jitter exponential backoff, retrying only what the caller's
 * `isTransient` marks transient. `CircuitOpenError` needs no special case:
 * not transient means immediate return.
 */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_BASE_MS = 200;

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  /** Given an attempt's result — a resolved value or a caught error — says whether it is worth retrying. */
  isTransient: (outcome: unknown) => boolean;
}

export type RetryOptions = Partial<
  Pick<RetryPolicy, 'maxAttempts' | 'baseDelayMs'>
> &
  Pick<RetryPolicy, 'isTransient'>;

/**
 * Runs `operation`, retrying it while `isTransient` says the last result —
 * a resolved value or a thrown error — was worth retrying. The last
 * attempt always surfaces its own outcome, transient or not: a resolved
 * value is returned, a thrown error is rethrown. There is no wrapping
 * "gave up after N attempts" error — the caller already gets the exact
 * outcome its own classification produced.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const policy: RetryPolicy = {
    maxAttempts: options.maxAttempts ?? MAX_ATTEMPTS,
    baseDelayMs: options.baseDelayMs ?? BACKOFF_BASE_MS,
    isTransient: options.isTransient,
  };

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const isLastAttempt = attempt === policy.maxAttempts;

    try {
      const value = await operation();
      if (isLastAttempt || !policy.isTransient(value)) {
        return value;
      }
    } catch (error) {
      if (isLastAttempt || !policy.isTransient(error)) {
        throw error;
      }
    }

    await sleep(fullJitterDelayMs(attempt, policy.baseDelayMs));
  }

  // Unreachable: maxAttempts >= 1, and the loop's last iteration always
  // returns or throws above before reaching here.
  throw new Error('withRetry: maxAttempts must be at least 1');
}

/** The wait after a failed attempt `n` (1-indexed) is `random(0, baseDelayMs * 2^(n-1))`. */
function fullJitterDelayMs(failedAttempt: number, baseDelayMs: number): number {
  const cap = baseDelayMs * 2 ** (failedAttempt - 1);
  return Math.random() * cap;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
