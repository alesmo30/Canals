import { Logger } from '@nestjs/common';

import { GeocodingFailedError } from '../../domain/ports/geocoding-errors';
import {
  ShippingAddress,
  ShippingAddressProps,
} from '../../domain/value-objects/shipping-address';
import { StaticGeocodingProvider } from './static-geocoding.provider';
import { US_CITIES } from './us-cities';

function buildAddress(
  overrides: Partial<ShippingAddressProps> = {},
): ShippingAddress {
  return ShippingAddress.of({
    recipient: 'Jane Doe',
    line1: '350 5th Ave',
    line2: 'Apt 4',
    city: 'New York',
    state: 'NY',
    postalCode: '10118',
    country: 'US',
    ...overrides,
  });
}

describe('StaticGeocodingProvider', () => {
  let warnSpy: jest.SpyInstance;
  let provider: StaticGeocodingProvider;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    provider = new StaticGeocodingProvider();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs a boot warning that it is for demo and test use only', () => {
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('demo and test use only'),
    );
  });

  it('returns the documented example point', async () => {
    const coordinates = await provider.geocode(buildAddress());

    expect(coordinates.getLatitude()).toBeCloseTo(40.675139, 6);
    expect(coordinates.getLongitude()).toBeCloseTo(-74.013737, 6);
  });

  it('returns the same point regardless of recipient', async () => {
    const first = await provider.geocode(
      buildAddress({ recipient: 'Jane Doe' }),
    );
    const second = await provider.geocode(
      buildAddress({ recipient: 'John Smith' }),
    );

    expect(first.equals(second)).toBe(true);
  });

  it('returns the same point for a two-letter state code and its full name', async () => {
    const withCode = await provider.geocode(buildAddress({ state: 'NY' }));
    const withFullName = await provider.geocode(
      buildAddress({ state: 'New York' }),
    );

    expect(withCode.equals(withFullName)).toBe(true);
  });

  it('resolves New York with no state given, on city name alone', async () => {
    const coordinates = await provider.geocode(
      buildAddress({ state: undefined }),
    );
    const centre = US_CITIES['new york|NY'];

    expect(
      Math.abs(coordinates.getLatitude() - centre.latitude),
    ).toBeLessThanOrEqual(0.05);
    expect(
      Math.abs(coordinates.getLongitude() - centre.longitude),
    ).toBeLessThanOrEqual(0.05);
  });

  it('throws UNKNOWN_ADDRESS for an ambiguous city with no state (Portland)', async () => {
    await expect(
      provider.geocode(
        buildAddress({
          city: 'Portland',
          state: undefined,
          postalCode: undefined,
        }),
      ),
    ).rejects.toMatchObject({ reason: 'UNKNOWN_ADDRESS' });
    await expect(
      provider.geocode(buildAddress({ city: 'Portland', state: undefined })),
    ).rejects.toBeInstanceOf(GeocodingFailedError);
  });

  it('throws UNKNOWN_ADDRESS for a city not in the table (Boise, ID)', async () => {
    await expect(
      provider.geocode(
        buildAddress({ city: 'Boise', state: 'ID', postalCode: undefined }),
      ),
    ).rejects.toMatchObject({ reason: 'UNKNOWN_ADDRESS' });
  });

  it('throws UNKNOWN_ADDRESS for a non-US country (Toronto, ON, CA)', async () => {
    await expect(
      provider.geocode(
        buildAddress({
          city: 'Toronto',
          state: 'ON',
          postalCode: undefined,
          country: 'CA',
        }),
      ),
    ).rejects.toMatchObject({ reason: 'UNKNOWN_ADDRESS' });
  });

  it('keeps every returned point within 0.05° of its city centre', async () => {
    const addresses: Array<Partial<ShippingAddressProps>> = [
      { city: 'New York', state: 'NY' },
      {
        line1: '1 Warehouse Way',
        city: 'Newark',
        state: 'NJ',
        postalCode: '07102',
      },
      {
        line1: '500 Sunset Blvd',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90012',
      },
      { line1: '1 Main St', city: 'Dallas', state: 'TX', postalCode: '75201' },
      {
        line1: '1 State St',
        city: 'Chicago',
        state: 'IL',
        postalCode: '60601',
      },
      { line1: '1 Ocean Dr', city: 'Miami', state: 'FL', postalCode: '33139' },
    ];

    for (const overrides of addresses) {
      const address = buildAddress(overrides);
      const centre =
        US_CITIES[`${overrides.city!.toLowerCase()}|${overrides.state}`];
      const coordinates = await provider.geocode(address);

      expect(
        Math.abs(coordinates.getLatitude() - centre.latitude),
      ).toBeLessThanOrEqual(0.05);
      expect(
        Math.abs(coordinates.getLongitude() - centre.longitude),
      ).toBeLessThanOrEqual(0.05);
    }
  });
});
