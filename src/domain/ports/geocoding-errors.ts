/**
 * Lives in the domain, beside the port, so the application maps it to 422
 * without importing infrastructure.
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
