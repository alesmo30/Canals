import { Coordinates } from '../value-objects/coordinates';
import { ShippingAddress } from '../value-objects/shipping-address';

/**
 * Only the shipping address is geocoded; warehouse coordinates are seeded
 * reference data. The driver is chosen by GEOCODING_DRIVER.
 */
export interface GeocodingProvider {
  geocode(address: ShippingAddress): Promise<Coordinates>;
}

/** DI token — GeocodingProvider is an interface and has no runtime value to key on. */
export const GEOCODING_PROVIDER = Symbol('GeocodingProvider');
