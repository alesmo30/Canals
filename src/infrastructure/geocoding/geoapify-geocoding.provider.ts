import { Logger } from '@nestjs/common';

import { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { GeocodingFailedError } from '../../domain/ports/geocoding-errors';
import { Coordinates } from '../../domain/value-objects/coordinates';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { CircuitBreaker } from '../http/circuit-breaker';
import { classifyFetchError } from '../http/fetch-errors';
import { redact } from '../http/redaction';
import { RetryPolicy, withRetry } from '../http/retry';

/** payments, geoapify — the per-attempt `AbortSignal.timeout`. */
export const ATTEMPT_TIMEOUT_MS = 2000;

const GEOAPIFY_SEARCH_URL = 'https://api.geoapify.com/v1/geocode/search';

export interface GeoapifyGeocodingProviderOptions {
  apiKey: string;
  /** Overridable so tests point at a fake server instead of the real Geoapify endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
  retryPolicy?: Partial<Pick<RetryPolicy, 'maxAttempts' | 'baseDelayMs'>>;
  breaker?: CircuitBreaker;
}

interface GeoapifyFeature {
  properties: { lat: number; lon: number };
}

type GeoapifyResponse =
  | { kind: 'success'; features: GeoapifyFeature[] }
  | { kind: 'configuration_error'; httpStatus: number };

/**
 * Base for every failure worth retrying — `5xx` and `429` (transient),
 * plus `fetch` failures (timeout, network). The shared marker
 * `retry.ts`'s `isTransient` recognises. `401`/`403` are deliberately
 * NOT one of these: they resolve instead of throwing (Decisions — "a bad
 * key is not an outage, must not open the breaker"), so `retry.ts` never
 * retries them and `circuit-breaker.ts` never counts them.
 */
abstract class GeoapifyRetryableError extends Error {}
class ProviderErrorException extends GeoapifyRetryableError {}
class TooManyRequestsException extends GeoapifyRetryableError {}
class TimeoutException extends GeoapifyRetryableError {}
class ConnectionRefusedException extends GeoapifyRetryableError {}
class NetworkErrorException extends GeoapifyRetryableError {}

function isRetryable(outcome: unknown): boolean {
  return outcome instanceof GeoapifyRetryableError;
}

/**
 * SPEC 03: opt-in `GeocodingProvider` over Geoapify's structured
 * `/v1/geocode/search` — the address already arrives as separate fields,
 * so free-text parsing would only add ambiguity (Decisions). Its own
 * `'geoapify'` breaker, the shared retry policy.
 */
export class GeoapifyGeocodingProvider implements GeocodingProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryOverrides: Partial<
    Pick<RetryPolicy, 'maxAttempts' | 'baseDelayMs'>
  >;
  private readonly breaker: CircuitBreaker;
  private readonly logger = new Logger(GeoapifyGeocodingProvider.name);

  constructor(options: GeoapifyGeocodingProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? GEOAPIFY_SEARCH_URL;
    this.timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    this.retryOverrides = options.retryPolicy ?? {};
    this.breaker = options.breaker ?? new CircuitBreaker({ name: 'geoapify' });
  }

  async geocode(address: ShippingAddress): Promise<Coordinates> {
    let response: GeoapifyResponse;
    try {
      response = await this.runAttempts(() => this.search(address));
    } catch {
      // Retries exhausted (5xx/429/timeout/network), or the breaker is
      // open — either way Geoapify cannot answer right now.
      throw new GeocodingFailedError(
        'PROVIDER_UNAVAILABLE',
        'Geoapify is unavailable — see README.',
      );
    }

    if (response.kind === 'configuration_error') {
      throw new GeocodingFailedError(
        'PROVIDER_UNAVAILABLE',
        `Geoapify rejected the request (HTTP ${response.httpStatus}) — check GEOAPIFY_API_KEY, see README.`,
      );
    }

    if (response.features.length === 0) {
      throw new GeocodingFailedError(
        'UNKNOWN_ADDRESS',
        'Geoapify found no match for this address — see README.',
      );
    }

    // Reads only features[0].properties.lat/lon — the one thing this
    // mapping depends on if Geoapify's response shape ever changes (Risks).
    const [feature] = response.features;
    return Coordinates.of({
      latitude: feature.properties.lat,
      longitude: feature.properties.lon,
    });
  }

  private runAttempts(
    operation: () => Promise<GeoapifyResponse>,
  ): Promise<GeoapifyResponse> {
    return withRetry(() => this.breaker.execute(operation), {
      maxAttempts: this.retryOverrides.maxAttempts,
      baseDelayMs: this.retryOverrides.baseDelayMs,
      isTransient: isRetryable,
    });
  }

  private async search(address: ShippingAddress): Promise<GeoapifyResponse> {
    const url = this.buildSearchUrl(address);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw classifyNetworkError(error);
    }

    if (response.status === 401 || response.status === 403) {
      // redact() masks apiKey= in the URL — this line must never leak it.
      this.logger.error(
        redact(`Geoapify request failed with HTTP ${response.status}: ${url}`),
      );
      return { kind: 'configuration_error', httpStatus: response.status };
    }

    if (response.status === 429) {
      throw new TooManyRequestsException('Geoapify responded 429');
    }
    if (response.status >= 500) {
      throw new ProviderErrorException(`Geoapify responded ${response.status}`);
    }

    const body: unknown = await response.json().catch(() => null);
    return { kind: 'success', features: parseFeatures(body) };
  }

  private buildSearchUrl(address: ShippingAddress): string {
    const params = new URLSearchParams({
      street: address.getLine1(),
      city: address.getCity(),
      country: address.getCountry(),
      filter: 'countrycode:us',
      limit: '1',
      apiKey: this.apiKey,
    });
    const state = address.getState();
    if (state) {
      params.set('state', state);
    }
    const postalCode = address.getPostalCode();
    if (postalCode) {
      params.set('postcode', postalCode);
    }
    return `${this.baseUrl}?${params.toString()}`;
  }
}

function classifyNetworkError(error: unknown): GeoapifyRetryableError {
  switch (classifyFetchError(error)) {
    case 'timeout':
      return new TimeoutException('request timed out');
    case 'connection_refused':
      return new ConnectionRefusedException('connection refused');
    case 'network_error':
      return new NetworkErrorException('network error');
  }
}

function parseFeatures(body: unknown): GeoapifyFeature[] {
  if (!body || typeof body !== 'object') {
    return [];
  }
  const features = (body as Record<string, unknown>).features;
  if (!Array.isArray(features)) {
    return [];
  }
  return features.filter(isGeoapifyFeature);
}

function isGeoapifyFeature(value: unknown): value is GeoapifyFeature {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const properties = (value as Record<string, unknown>).properties;
  if (!properties || typeof properties !== 'object') {
    return false;
  }
  const { lat, lon } = properties as Record<string, unknown>;
  return typeof lat === 'number' && typeof lon === 'number';
}
