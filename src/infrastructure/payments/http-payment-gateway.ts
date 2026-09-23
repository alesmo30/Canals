import { PaymentFailureCode } from '../../domain/ports/payment-failure-codes';
import {
  ChargeCommand,
  ChargeResult,
  PaymentGateway,
} from '../../domain/ports/payment-gateway';
import { PaymentStatus } from '../../domain/enum-types/payment-status';
import { CircuitBreaker, CircuitOpenError } from '../http/circuit-breaker';
import { classifyFetchError } from '../http/fetch-errors';
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

/** Transient fetch failures that retry.ts recognises. `CircuitOpenError` isn't one: retrying it is pointless. */
abstract class RetryableProviderError extends Error {}
class ProviderErrorException extends RetryableProviderError {}
class TimeoutException extends RetryableProviderError {}
class ConnectionRefusedException extends RetryableProviderError {}
class NetworkErrorException extends RetryableProviderError {}

function isRetryable(outcome: unknown): boolean {
  return outcome instanceof RetryableProviderError;
}

/**
 * Never throws on a provider failure — every branch resolves a
 * `ChargeResult`, so callers need no try/catch. `charge()` and
 * `getStatus()` share one breaker and retry policy.
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
      `${this.baseUrl}/charge/${encodeURIComponent(idempotencyKey)}`,
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

function classifyNetworkError(error: unknown): RetryableProviderError {
  const kind = classifyFetchError(error);
  switch (kind) {
    case 'timeout':
      return new TimeoutException('request timed out');
    case 'connection_refused':
      return new ConnectionRefusedException('connection refused');
    case 'network_error':
      return new NetworkErrorException('network error');
  }
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
  // 400 / 422: a bug on our side, not a card outcome.
  return {
    status: 'UNKNOWN',
    providerPaymentId,
    cardLast4: last4,
    cardBrand: brand,
    failureCode: 'INVALID_REQUEST',
    rawResponse,
  };
}

/**
 * 404 is FAILED; only a recognised 200 maps to CAPTURED/DECLINED; anything
 * else is UNKNOWN, never a guess — reconciliation trusts this.
 */
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
  const providerStatus = readStringField(response.body, 'status');
  const okStatus: number = 200;
  const status: PaymentStatus | null =
    response.httpStatus === okStatus && providerStatus === 'approved'
      ? 'CAPTURED'
      : response.httpStatus === okStatus && providerStatus === 'declined'
        ? 'DECLINED'
        : null;

  if (status === null) {
    return {
      status: 'UNKNOWN',
      providerPaymentId,
      cardLast4,
      cardBrand: null,
      failureCode: 'INVALID_REQUEST',
      rawResponse,
    };
  }
  return {
    status,
    providerPaymentId,
    cardLast4,
    cardBrand: null,
    failureCode: status === 'DECLINED' ? 'CARD_DECLINED' : null,
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
  // itself — still UNKNOWN, so the fallback is safe.
  return 'NETWORK_ERROR';
}

function readStringField(
  body: Record<string, unknown> | null,
  field: string,
): string | null {
  const value = body?.[field];
  return typeof value === 'string' ? value : null;
}
