/**
 * Outcomes are keyed on the card's last four digits. Mock-local literals:
 * this package never imports from the main app's `src/`.
 */
export const CARD_DECLINED_LAST4 = '0002';
export const CARD_PROVIDER_ERROR_LAST4 = '0003';
export const CARD_TIMEOUT_LAST4 = '0004';

/**
 * How long a `0004` charge hangs before answering, on every request —
 * first attempt and every replay. Overridable per `buildServer()` call so
 * tests do not wait 30 s for real.
 */
export const CARD_0004_DELAY_MS = 30_000;

/** Simulated latency for an ordinary approval (200–600 ms). */
export const APPROVED_DELAY_MIN_MS = 200;
export const APPROVED_DELAY_MAX_MS = 600;
