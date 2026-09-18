import { createHash } from 'node:crypto';

import { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { Coordinates } from '../../domain/value-objects/coordinates';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { buildNormalisedAddress } from './normalisation';

/** No TTL: a static result never changes, and Geoapify's terms permit storing results (Decisions). */
export const GEOCODE_CACHE_MAX_ENTRIES = 10_000;

export interface CachingGeocodingProviderOptions {
  maxEntries?: number;
}

/**
 * SPEC 03: an in-memory LRU decorator around whichever driver
 * `SharedModule` selects — it caches address -> coordinates only, never
 * warehouse selection or distance, which are recomputed on every order
 * (Decisions). Keyed by `sha256` of the normalised address, excluding
 * `recipient` — two people at one address are at one cache entry.
 *
 * Hand-written with no dependency: a `Map` already iterates in insertion
 * order, so re-inserting a key on every hit (`delete` then `set`) keeps
 * it at the "most recently used" end, and evicting the first key evicts
 * the least recently used one.
 *
 * A failed lookup is never stored: `this.delegate.geocode(address)`
 * rejecting propagates straight out of this method, before the `set()`
 * below ever runs — a Geoapify outage must not mark an address as bad
 * after the provider recovers.
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
