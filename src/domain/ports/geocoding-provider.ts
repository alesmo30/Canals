import { Coordinates } from '../value-objects/coordinates';
import { ShippingAddress } from '../value-objects/shipping-address';

/**
 * R0.6 (frozen contract). Implemented by P2 (`GeoapifyGeocodingProvider` and
 * a `StaticGeocodingProvider` stub, selected by `GEOCODING_DRIVER`) and
 * consumed by P4 when creating an order (FR-3): only the shipping address
 * is geocoded — warehouse coordinates are fixed reference data, seeded
 * once, never geocoded at request time.
 */
export interface GeocodingProvider {
  geocode(address: ShippingAddress): Promise<Coordinates>;
}

/** DI token — GeocodingProvider is an interface and has no runtime value to key on. */
export const GEOCODING_PROVIDER = Symbol('GeocodingProvider');
