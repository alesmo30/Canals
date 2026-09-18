import { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { GeocodingFailedError } from '../../domain/ports/geocoding-errors';
import { Coordinates } from '../../domain/value-objects/coordinates';
import {
  ShippingAddress,
  ShippingAddressProps,
} from '../../domain/value-objects/shipping-address';
import { CachingGeocodingProvider } from './caching-geocoding.provider';

function buildAddress(
  overrides: Partial<ShippingAddressProps> = {},
): ShippingAddress {
  return ShippingAddress.of({
    recipient: 'Jane Doe',
    line1: '1 Test Way',
    city: 'Testville',
    state: 'NY',
    postalCode: '10001',
    country: 'US',
    ...overrides,
  });
}

class CountingProvider implements GeocodingProvider {
  calls = 0;
  private readonly failOnce = new Set<string>();

  geocode(address: ShippingAddress): Promise<Coordinates> {
    this.calls++;
    if (this.failOnce.has(address.getLine1())) {
      this.failOnce.delete(address.getLine1());
      return Promise.reject(
        new GeocodingFailedError('UNKNOWN_ADDRESS', 'fake failure'),
      );
    }
    return Promise.resolve(Coordinates.of({ latitude: 40, longitude: -70 }));
  }

  failNextCallFor(line1: string): void {
    this.failOnce.add(line1);
  }
}

describe('CachingGeocodingProvider', () => {
  it('does not reach the provider on a second identical call', async () => {
    const delegate = new CountingProvider();
    const cache = new CachingGeocodingProvider(delegate);
    const address = buildAddress();

    const first = await cache.geocode(address);
    const second = await cache.geocode(address);

    expect(delegate.calls).toBe(1);
    expect(second.equals(first)).toBe(true);
  });

  it('treats an address differing only by recipient as a cache hit', async () => {
    const delegate = new CountingProvider();
    const cache = new CachingGeocodingProvider(delegate);

    await cache.geocode(buildAddress({ recipient: 'Jane Doe' }));
    await cache.geocode(buildAddress({ recipient: 'John Smith' }));

    expect(delegate.calls).toBe(1);
  });

  it('never caches a failure, so the next call reaches the provider again', async () => {
    const delegate = new CountingProvider();
    const cache = new CachingGeocodingProvider(delegate);
    const address = buildAddress({ line1: 'Failing Address' });
    delegate.failNextCallFor('Failing Address');

    await expect(cache.geocode(address)).rejects.toBeInstanceOf(
      GeocodingFailedError,
    );
    await expect(cache.geocode(address)).resolves.toBeDefined();

    expect(delegate.calls).toBe(2);
  });

  it('evicts the least recently used entry once the cache is over capacity', async () => {
    const delegate = new CountingProvider();
    // maxEntries: 3, so the mechanism is provably identical to the real
    // 10,000-entry default without the test inserting that many rows.
    const cache = new CachingGeocodingProvider(delegate, { maxEntries: 3 });
    const addressA = buildAddress({ line1: 'A' });
    const addressB = buildAddress({ line1: 'B' });
    const addressC = buildAddress({ line1: 'C' });
    const addressD = buildAddress({ line1: 'D' });

    await cache.geocode(addressA); // cache: [A]
    await cache.geocode(addressB); // cache: [A, B]
    await cache.geocode(addressC); // cache: [A, B, C] — at capacity, nothing evicted yet
    expect(delegate.calls).toBe(3);

    await cache.geocode(addressA); // hit; touches A, now the most recently used -> cache: [B, C, A]
    expect(delegate.calls).toBe(3);

    await cache.geocode(addressD); // miss; over capacity -> evicts B, the least recently used -> cache: [C, A, D]
    expect(delegate.calls).toBe(4);

    // B was evicted -> miss. Re-inserting it pushes the cache over
    // capacity again, evicting C this time (A is protected — it was
    // touched more recently than C).
    await cache.geocode(addressB);
    expect(delegate.calls).toBe(5);

    await cache.geocode(addressA); // A was touched before either eviction -> still a hit
    expect(delegate.calls).toBe(5);
  });
});
