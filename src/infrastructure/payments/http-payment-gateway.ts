import { PaymentFailureCode } from '../../domain/ports/payment-failure-codes';
import {
  ChargeCommand,
  ChargeResult,
  PaymentGateway,
} from '../../domain/ports/payment-gateway';
import { PaymentStatus } from '../../domain/enum-types/payment-status';
import { CircuitBreaker, CircuitOpenError } from '../http/circuit-breaker';
import { redact } from '../http/redaction';
import { RetryPolicy, withRetry } from '../http/retry';
import { CardBrand, describeCard } from './card';

/** payments, geoapify — the per-attempt `AbortSignal.timeout`. */
export const ATTEMPT_TIMEOUT_MS = 2000;

export interface HttpPaymentGatewayOptions {
  baseUrl: string;
  timeoutMs?: number;
  retryPolicy?: Partial<Pick<RetryPolicy, 'maxAttempts' | 'baseDelayMs'>>;
  breaker?: CircuitBreaker;
}

interface ChargeWirePayload {
  cardNumber: string;
  amountCents: number;
  currency: string;
  description: string;
}

interface ProviderResponse {
  httpStatus: number;
  body: Record<string, unknown> | null;
}

/**
 * Base for every failure `fetch` itself can produce — the shared marker
 * `retry.ts`'s `isTransient` recognises. `CircuitOpenError`
 * (`circuit-breaker.ts`) is deliberately not one of these: it is not
 * transient, so retrying it would be pointless (Decisions).
 */
abstract class RetryableProviderError extends Error {}
class ProviderErrorException extends RetryableProviderError {}
class TimeoutException extends RetryableProviderError {}
class ConnectionRefusedException extends RetryableProviderError {}
class NetworkErrorException extends RetryableProviderError {}

function isRetryable(outcome: unknown): boolean {
  return outcome instanceof RetryableProviderError;
}

/**
 * SPEC 03. Implements P0's `PaymentGateway` against `payments-mock` (or any
 * provider speaking its wire contract) with native `fetch`. Never throws on
 * a provider failure — every branch below resolves to a `ChargeResult`,
 * classification is total, so P4 can switch on `status` without a
 * `try/catch` that might swallow a programming error (Decisions).
 *
 * `charge()` and `getStatus()` share one breaker and one retry policy:
 * they hit the same host, and per-attempt counting means five failed
 * attempts can come from as few as two orders.
 */
export class HttpPaymentGateway implements PaymentGateway {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryOverrides: Partial<
    Pick<RetryPolicy, 'maxAttempts' | 'baseDelayMs'>
  >;
  private readonly breaker: CircuitBreaker;

  constructor(options: HttpPaymentGatewayOptions) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    this.retryOverrides = options.retryPolicy ?? {};
    this.breaker = options.breaker ?? new CircuitBreaker({ name: 'payments' });
  }

  async charge(command: ChargeCommand): Promise<ChargeResult> {
    const { last4, brand } = describeCard(command.cardNumber);
    const payload: ChargeWirePayload = {
      cardNumber: command.cardNumber,
      amountCents: command.amountMinor,
      currency: command.currency,
      description: command.description,
    };

    try {
      const response = await this.runAttempts(() =>
        this.postCharge(command.idempotencyKey, payload),
      );
      return mapChargeResponse(response, last4, brand);
    } catch (error) {
      return buildUnknownResult(error, last4, brand);
    }
  }

  async getStatus(idempotencyKey: string): Promise<ChargeResult> {
    try {
      const response = await this.runAttempts(() =>
        this.getCharge(idempotencyKey),
      );
      return mapStatusResponse(response);
    } catch (error) {
      return buildUnknownResult(error, null, null);
    }
  }

  private runAttempts(
    operation: () => Promise<ProviderResponse>,
  ): Promise<ProviderResponse> {
    return withRetry(() => this.breaker.execute(operation), {
      maxAttempts: this.retryOverrides.maxAttempts,
      baseDelayMs: this.retryOverrides.baseDelayMs,
      isTransient: isRetryable,
    });
  }

  private async postCharge(
    idempotencyKey: string,
    payload: ChargeWirePayload,
  ): Promise<ProviderResponse> {
    const response = await this.fetchAttempt(`${this.baseUrl}/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    return this.toProviderResponse(response);
  }

  private async getCharge(idempotencyKey: string): Promise<ProviderResponse> {
    const response = await this.fetchAttempt(
      `${this.baseUrl}/charge/${idempotencyKey}`,
      {},
    );
    return this.toProviderResponse(response);
  }

  private async fetchAttempt(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw classifyNetworkError(error);
    }
  }

  private async toProviderResponse(
    response: Response,
  ): Promise<ProviderResponse> {
    if (response.status >= 500) {
      throw new ProviderErrorException(
        `payments-mock responded ${response.status}`,
      );
    }
    const body = asRecord(await response.json().catch(() => null));
    return { httpStatus: response.status, body };
  }
}

/**
 * Classifies whatever `fetch`/`AbortSignal.timeout` throws. Deliberately
 * duck-typed (`.name`, `.cause.code`) instead of `instanceof
 * DOMException`/`instanceof Error`: Node's native `fetch` (undici) and a
 * test runner's sandboxed global scope (Jest's `jest-environment-node`
 * gives each test file its own realm) can disagree on which `Error`/
 * `DOMException` constructor an error was built with, making `instanceof`
 * unreliable across that boundary — property reads are not.
 */
function classifyNetworkError(error: unknown): RetryableProviderError {
  if (hasName(error, 'TimeoutError')) {
    return new TimeoutException('request timed out');
  }
  if (errorCauseCode(error) === 'ECONNREFUSED') {
    return new ConnectionRefusedException('connection refused');
  }
  // Unknown shapes fall back to NETWORK_ERROR — still UNKNOWN, so the
  // fallback is safe (Risks).
  return new NetworkErrorException('network error');
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapChargeResponse(
  response: ProviderResponse,
  last4: string,
  brand: CardBrand,
): ChargeResult {
  const rawResponse = redact(response.body);
  const providerPaymentId = readStringField(response.body, 'id');

  if (response.httpStatus === 200) {
    return {
      status: 'CAPTURED',
      providerPaymentId,
      cardLast4: last4,
      cardBrand: brand,
      failureCode: null,
      rawResponse,
    };
  }
  if (response.httpStatus === 402) {
    return {
      status: 'DECLINED',
      providerPaymentId,
      cardLast4: last4,
      cardBrand: brand,
      failureCode: 'CARD_DECLINED',
      rawResponse,
    };
  }
  // 400 / 422: a bug on our side, not a card outcome (Decisions).
  return {
    status: 'UNKNOWN',
    providerPaymentId,
    cardLast4: last4,
    cardBrand: brand,
    failureCode: 'INVALID_REQUEST',
    rawResponse,
  };
}

function mapStatusResponse(response: ProviderResponse): ChargeResult {
  const rawResponse = redact(response.body);

  if (response.httpStatus === 404) {
    return {
      status: 'FAILED',
      providerPaymentId: null,
      cardLast4: null,
      cardBrand: null,
      failureCode: 'NOT_FOUND',
      rawResponse,
    };
  }

  const providerPaymentId = readStringField(response.body, 'id');
  const cardLast4 = readStringField(response.body, 'cardLast4');
  const status: PaymentStatus =
    readStringField(response.body, 'status') === 'declined'
      ? 'DECLINED'
      : 'CAPTURED';
  return {
    status,
    providerPaymentId,
    cardLast4,
    cardBrand: null,
    failureCode: null,
    rawResponse,
  };
}

function buildUnknownResult(
  error: unknown,
  cardLast4: string | null,
  cardBrand: CardBrand | null,
): ChargeResult {
  return {
    status: 'UNKNOWN',
    providerPaymentId: null,
    cardLast4,
    cardBrand,
    failureCode: classifyThrownFailure(error),
    rawResponse: null,
  };
}

function classifyThrownFailure(error: unknown): PaymentFailureCode {
  if (error instanceof CircuitOpenError) {
    return 'CIRCUIT_OPEN';
  }
  if (error instanceof TimeoutException) {
    return 'TIMEOUT';
  }
  if (error instanceof ProviderErrorException) {
    return 'PROVIDER_ERROR';
  }
  if (error instanceof ConnectionRefusedException) {
    return 'CONNECTION_REFUSED';
  }
  // NetworkErrorException, or anything else this adapter didn't throw
  // itself — still UNKNOWN, so the fallback is safe (Risks).
  return 'NETWORK_ERROR';
}

function readStringField(
  body: Record<string, unknown> | null,
  field: string,
): string | null {
  const value = body?.[field];
  return typeof value === 'string' ? value : null;
}
