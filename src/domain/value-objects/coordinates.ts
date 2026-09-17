/**
 * R0.5 (frozen contract): a geodetic point. Backs `warehouses.location` and
 * `orders.shipping_location` (both `geography(Point,4326)`), and is what
 * `GeocodingProvider.geocode()` returns.
 *
 * Deliberately has no distance method: FR-2 computes distance ranking in a
 * single SQL query (`location <-> :shippingPoint`, PostGIS geodesic
 * distance, index-assisted by the GiST index) — that is a database
 * responsibility, not a domain one, and reimplementing it in JS would give
 * a second, divergent notion of "distance."
 */
export class Coordinates {
  private constructor(
    private readonly latitude: number,
    private readonly longitude: number,
  ) {}

  /**
   * Takes one named-property object, not positional (latitude, longitude)
   * arguments. Both are plain `number`, so positional args let
   * `Coordinates.of(lng, lat)` compile silently — the ±90/±180 range checks
   * below do not catch a swap within the continental US, since both values
   * land in range for both fields either way. A named object forces the
   * caller to label each value: the mistake becomes a wrong key, not an
   * invisible argument-order slip.
   */
  static of(input: { latitude: number; longitude: number }): Coordinates {
    const { latitude, longitude } = input;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error(`Latitude must be between -90 and 90, got ${latitude}`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(
        `Longitude must be between -180 and 180, got ${longitude}`,
      );
    }
    return new Coordinates(latitude, longitude);
  }

  getLatitude(): number {
    return this.latitude;
  }

  getLongitude(): number {
    return this.longitude;
  }

  equals(other: Coordinates): boolean {
    return (
      this.latitude === other.latitude && this.longitude === other.longitude
    );
  }
}
