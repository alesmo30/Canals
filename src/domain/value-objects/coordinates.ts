/**
 * A geodetic point. No distance method on purpose: ranking is PostGIS's job
 * in the selection query; a JS version would diverge.
 */
export class Coordinates {
  private constructor(
    private readonly latitude: number,
    private readonly longitude: number,
  ) {}

  /**
   * Named properties, not positional args: a lat/lng swap passes the range
   * checks within the US, so the caller must label each value.
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
