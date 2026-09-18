export interface CityCentre {
  latitude: number;
  longitude: number;
}

/**
 * SPEC 03: ~30 entries, keyed by normalised `city|STATE` (city lower-cased
 * via `normalizeText`, state the two-letter USPS code). Includes the five
 * warehouse cities — coordinates match `seed.ts`'s `WAREHOUSES`, so "a
 * static result for a New York address returns Newark first" holds
 * against the seeded data — plus `portland|OR` and `portland|ME`
 * deliberately, to exercise the ambiguity rule (no state -> more than one
 * match -> `UNKNOWN_ADDRESS`).
 */
export const US_CITIES: Readonly<Record<string, CityCentre>> = {
  // Warehouse cities (data-model.dbml / seed.ts — exact match).
  'newark|NJ': { latitude: 40.735657, longitude: -74.172363 },
  'los angeles|CA': { latitude: 34.052235, longitude: -118.243683 },
  'dallas|TX': { latitude: 32.776664, longitude: -96.796988 },
  'chicago|IL': { latitude: 41.878113, longitude: -87.629799 },
  'miami|FL': { latitude: 25.761681, longitude: -80.191788 },

  // Required by SPEC 03's "Geocoding" scope bullet.
  'new york|NY': { latitude: 40.7128, longitude: -74.006 },
  'philadelphia|PA': { latitude: 39.9526, longitude: -75.1652 },
  'san diego|CA': { latitude: 32.7157, longitude: -117.1611 },
  'houston|TX': { latitude: 29.7604, longitude: -95.3698 },
  'milwaukee|WI': { latitude: 43.0389, longitude: -87.9065 },
  'orlando|FL': { latitude: 28.5383, longitude: -81.3792 },
  'seattle|WA': { latitude: 47.6062, longitude: -122.3321 },
  'denver|CO': { latitude: 39.7392, longitude: -104.9903 },
  // Deliberately ambiguous when looked up by city alone, no state.
  'portland|OR': { latitude: 45.5152, longitude: -122.6784 },
  'portland|ME': { latitude: 43.6591, longitude: -70.2568 },

  // Rounds the table out to ~30 entries.
  'boston|MA': { latitude: 42.3601, longitude: -71.0589 },
  'atlanta|GA': { latitude: 33.749, longitude: -84.388 },
  'phoenix|AZ': { latitude: 33.4484, longitude: -112.074 },
  'san francisco|CA': { latitude: 37.7749, longitude: -122.4194 },
  'austin|TX': { latitude: 30.2672, longitude: -97.7431 },
  'san antonio|TX': { latitude: 29.4241, longitude: -98.4936 },
  'charlotte|NC': { latitude: 35.2271, longitude: -80.8431 },
  'columbus|OH': { latitude: 39.9612, longitude: -82.9988 },
  'indianapolis|IN': { latitude: 39.7684, longitude: -86.1581 },
  'san jose|CA': { latitude: 37.3382, longitude: -121.8863 },
  'detroit|MI': { latitude: 42.3314, longitude: -83.0458 },
  'nashville|TN': { latitude: 36.1627, longitude: -86.7816 },
  'memphis|TN': { latitude: 35.1495, longitude: -90.049 },
  'baltimore|MD': { latitude: 39.2904, longitude: -76.6122 },
  'las vegas|NV': { latitude: 36.1699, longitude: -115.1398 },
  'minneapolis|MN': { latitude: 44.9778, longitude: -93.265 },
  'new orleans|LA': { latitude: 29.9511, longitude: -90.0715 },
};
