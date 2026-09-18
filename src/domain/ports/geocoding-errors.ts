/**
 * SPEC 03: additive, beside the frozen `geocoding-provider.ts` port, so
 * P4 maps it to a `422` without importing infrastructure
 * (`references/layering.md`).
 */
export type GeocodingFailureReason = 'UNKNOWN_ADDRESS' | 'PROVIDER_UNAVAILABLE';

export class GeocodingFailedError extends Error {
  constructor(
    readonly reason: GeocodingFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'GeocodingFailedError';
  }
}
