import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { GeocodingFailedError } from '../../domain/ports/geocoding-errors';
import { Coordinates } from '../../domain/value-objects/coordinates';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import {
  buildNormalisedAddress,
  canonicalizeStateCode,
  isAcceptedCountry,
  normalizeText,
} from './normalisation';
import { CityCentre, US_CITIES } from './us-cities';

/** Up to ±0.05° of jitter around a city's centre — about 5 km, irrelevant when warehouses are hundreds of km apart. */
export const STATIC_JITTER_DEGREES = 0.05;

const UNKNOWN_ADDRESS_MESSAGE =
  'Address could not be resolved by the static geocoder — see README for its supported cities and limits.';

/**
 * Default provider, demo/test only: ~30-city table plus deterministic
 * sha256 jitter (±0.05°) from the normalised address. No network.
 */
export class StaticGeocodingProvider implements GeocodingProvider {
  private readonly logger = new Logger(StaticGeocodingProvider.name);

  constructor() {
    this.logger.warn(
      'StaticGeocodingProvider is for demo and test use only — see README before using it for real.',
    );
  }

  // async, with no await inside: a thrown GeocodingFailedError must reach
  // the caller as a rejected promise, matching PaymentGateway's async
  // methods and every other driver behind this port (Geoapify genuinely
  // awaits a fetch) — this driver alone does no I/O.
  // eslint-disable-next-line @typescript-eslint/require-await
  async geocode(address: ShippingAddress): Promise<Coordinates> {
    const country = address.getCountry();
    if (!isAcceptedCountry(country)) {
      throw new GeocodingFailedError(
        'UNKNOWN_ADDRESS',
        UNKNOWN_ADDRESS_MESSAGE,
      );
    }

    const centre = resolveCityCentre(address.getCity(), address.getState());
    const jitter = computeJitter(buildNormalisedAddress(address));

    return Coordinates.of({
      latitude: centre.latitude + jitter.latitude,
      longitude: centre.longitude + jitter.longitude,
    });
  }
}

/**
 * With a state, an exact `city|STATE` match or nothing. Without one, a
 * match on city alone only when the name is unique in the table —
 * tolerant, but it never guesses on ambiguity (e.g. `Portland`).
 */
function resolveCityCentre(
  rawCity: string,
  rawState: string | undefined,
): CityCentre {
  const normalizedCity = normalizeText(rawCity);

  if (rawState) {
    const stateCode = canonicalizeStateCode(rawState) ?? rawState.toUpperCase();
    const centre = US_CITIES[`${normalizedCity}|${stateCode}`];
    if (!centre) {
      throw new GeocodingFailedError(
        'UNKNOWN_ADDRESS',
        UNKNOWN_ADDRESS_MESSAGE,
      );
    }
    return centre;
  }

  const matches = Object.entries(US_CITIES).filter(
    ([key]) => key.split('|')[0] === normalizedCity,
  );
  if (matches.length !== 1) {
    throw new GeocodingFailedError('UNKNOWN_ADDRESS', UNKNOWN_ADDRESS_MESSAGE);
  }
  return matches[0][1];
}

function computeJitter(normalisedAddress: string): {
  latitude: number;
  longitude: number;
} {
  const hash = createHash('sha256').update(normalisedAddress).digest();
  return {
    latitude:
      ((hash.readUInt32BE(0) / 0xffffffff) * 2 - 1) * STATIC_JITTER_DEGREES,
    longitude:
      ((hash.readUInt32BE(4) / 0xffffffff) * 2 - 1) * STATIC_JITTER_DEGREES,
  };
}
