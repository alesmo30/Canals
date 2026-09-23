import { createHash } from 'node:crypto';

import { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { Coordinates } from '../../domain/value-objects/coordinates';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { buildNormalisedAddress } from './normalisation';

/** No TTL: static results never change and Geoapify's terms allow storing results. */
export const GEOCODE_CACHE_MAX_ENTRIES = 10_000;

export interface CachingGeocodingProviderOptions {
  maxEntries?: number;
}

/**
 * In-memory LRU around the selected driver; caches address → coordinates
 * only, keyed by sha256 of the normalised address (recipient excluded).
 * Map insertion order gives LRU. Failures are never cached.
 */
export class CachingGeocodingProvider implements GeocodingProvider {
  private readonly cache = new Map<string, Coordinates>();
  private readonly maxEntries: number;

  constructor(
    private readonly delegate: GeocodingProvider,
    options: CachingGeocodingProviderOptions = {},
  ) {
    this.maxEntries = options.maxEntries ?? GEOCODE_CACHE_MAX_ENTRIES;
  }

  async geocode(address: ShippingAddress): Promise<Coordinates> {
    const key = cacheKey(address);
    const cached = this.cache.get(key);
    if (cached) {
      this.touch(key, cached);
      return cached;
    }

    const result = await this.delegate.geocode(address);
    this.store(key, result);
    return result;
  }

  /** Re-inserts an existing entry so it becomes the most recently used. */
  private touch(key: string, value: Coordinates): void {
    this.cache.delete(key);
    this.cache.set(key, value);
  }

  /** Inserts a new entry, evicting the least recently used one if that pushes the cache past its limit. */
  private store(key: string, value: Coordinates): void {
    this.cache.set(key, value);
    if (this.cache.size > this.maxEntries) {
      const leastRecentlyUsedKey = this.cache.keys().next().value;
      if (leastRecentlyUsedKey !== undefined) {
        this.cache.delete(leastRecentlyUsedKey);
      }
    }
  }
}

function cacheKey(address: ShippingAddress): string {
  return createHash('sha256')
    .update(buildNormalisedAddress(address))
    .digest('hex');
}
