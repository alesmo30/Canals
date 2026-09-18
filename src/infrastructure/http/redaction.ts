/**
 * SPEC 03: no card number or secret may reach a log line. `redact()` is the
 * single function every log call is run through (via the `nestjs-pino`
 * logger, see `main.ts`), and every adapter passes its `rawResponse`
 * through it before it crosses a port.
 *
 * Pure: returns a redacted deep copy, never mutates its input, and
 * survives circular references (a `WeakMap` remembers what has already
 * been cloned).
 */

/** Keys whose value is a card number: masked, keeping the last four digits. */
const MASKED_KEY_PATTERN = /^(card_?number|pan)$/i;

/** Keys whose value is a secret: replaced outright, nothing kept. */
const REDACTED_KEY_PATTERN = /^api_?key$/i;

/**
 * 13–19 digits, optionally separated by single spaces or dashes between
 * digits. Matches PANs pasted into free text; the Luhn check below filters
 * out order numbers, timestamps and other digit runs that are not cards.
 */
const CARD_NUMBER_VALUE_PATTERN = /(?:\d[ -]?){12,18}\d/g;

/** `apiKey=<value>` inside a URL query string. */
const API_KEY_QUERY_PATTERN = /([?&]api_?key=)([^&\s]+)/gi;

const REDACTED_SECRET = '[REDACTED]';

export function redact<T>(input: T): T {
  return redactValue(input, new WeakMap<object, unknown>()) as T;
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return redactArray(value, seen);
  }
  return redactObject(value as Record<string, unknown>, seen);
}

function redactArray(
  value: unknown[],
  seen: WeakMap<object, unknown>,
): unknown[] {
  const clone: unknown[] = [];
  seen.set(value, clone);
  for (const item of value) {
    clone.push(redactValue(item, seen));
  }
  return clone;
}

function redactObject(
  value: Record<string, unknown>,
  seen: WeakMap<object, unknown>,
): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, fieldValue] of Object.entries(value)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      clone[key] = REDACTED_SECRET;
    } else if (MASKED_KEY_PATTERN.test(key) && typeof fieldValue === 'string') {
      clone[key] = maskCardValue(fieldValue);
    } else {
      clone[key] = redactValue(fieldValue, seen);
    }
  }
  return clone;
}

function redactString(value: string): string {
  const withMaskedCardNumbers = value.replace(
    CARD_NUMBER_VALUE_PATTERN,
    (match) => {
      const digits = match.replace(/[^\d]/g, '');
      if (digits.length < 13 || digits.length > 19 || !isLuhnValid(digits)) {
        return match;
      }
      return maskDigits(digits);
    },
  );
  return withMaskedCardNumbers.replace(
    API_KEY_QUERY_PATTERN,
    (_match, prefix: string) => `${prefix}${REDACTED_SECRET}`,
  );
}

/** Masks a value already known (by its key) to be a card number, Luhn or not. */
function maskCardValue(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) {
    return raw;
  }
  return maskDigits(digits);
}

/** `4242424242424242` → `************4242`: last four digits kept, the rest turned to `*`. */
function maskDigits(digits: string): string {
  const last4 = digits.slice(-4);
  const maskedLength = Math.max(digits.length - last4.length, 0);
  return '*'.repeat(maskedLength) + last4;
}

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}
