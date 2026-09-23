export type FetchErrorKind = 'timeout' | 'connection_refused' | 'network_error';

/**
 * Classifies whatever `fetch`/`AbortSignal.timeout` throws. Deliberately
 * duck-typed (`.name`, `.cause.code`) instead of `instanceof
 * DOMException`/`instanceof Error`: Node's native `fetch` (undici) and a
 * test runner's sandboxed global scope (Jest's `jest-environment-node`
 * gives each test file its own realm) can disagree on which `Error`/
 * `DOMException` constructor an error was built with, making `instanceof`
 * unreliable across that boundary — property reads are not. Shared by
 * `HttpPaymentGateway` and `GeoapifyGeocodingProvider`, the two adapters
 * that call `fetch` directly.
 */
export function classifyFetchError(error: unknown): FetchErrorKind {
  if (hasName(error, 'TimeoutError')) {
    return 'timeout';
  }
  if (errorCauseCode(error) === 'ECONNREFUSED') {
    return 'connection_refused';
  }
  // Unknown shapes fall back to network_error; callers map that to
  // UNKNOWN, so the fallback is safe.
  return 'network_error';
}

function hasName(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === name
  );
}

/** `fetch` wraps socket errors as `TypeError: fetch failed`, with the real code in `error.cause.code`. */
function errorCauseCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) {
    return undefined;
  }
  return (cause as { code?: unknown }).code;
}
