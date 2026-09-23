import { ShippingAddress } from '../../domain/value-objects/shipping-address';

/** Full state name → USPS code (50 states plus DC). */
const STATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
};

const ACCEPTED_COUNTRIES = new Set(['us', 'usa', 'united states']);

/**
 * NFD with diacritics stripped, trimmed, whitespace collapsed, lower-cased.
 * Shared by the static lookup, the jitter and the cache key.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * A two-letter code stays as-is (upper-cased); a full name ("New York")
 * is resolved through the 51-entry table. Returns `undefined` for
 * anything else — neither the static provider's ambiguity rule nor
 * `buildNormalisedAddress` treat that as fatal on its own; the city
 * lookup is what ultimately decides.
 */
export function canonicalizeStateCode(rawState: string): string | undefined {
  const normalized = normalizeText(rawState);
  if (normalized.length === 2) {
    return normalized.toUpperCase();
  }
  return STATE_NAME_TO_CODE[normalized];
}

export function isAcceptedCountry(rawCountry: string): boolean {
  return ACCEPTED_COUNTRIES.has(normalizeText(rawCountry));
}

/**
 * `line1|line2|city|state|postalCode|country`, empty string for an
 * absent field, every field normalised — `state` first canonicalised to
 * its two-letter code (so `"NY"` and `"New York"` produce the identical
 * string), then lower-cased like everything else. The `recipient` is
 * deliberately excluded: two people at one address are at one point.
 */
export function buildNormalisedAddress(address: ShippingAddress): string {
  const rawState = address.getState();
  const stateCode = rawState
    ? (canonicalizeStateCode(rawState) ?? rawState)
    : '';

  const fields = [
    address.getLine1(),
    address.getLine2() ?? '',
    address.getCity(),
    stateCode,
    address.getPostalCode() ?? '',
    address.getCountry(),
  ];
  return fields.map((field) => (field ? normalizeText(field) : '')).join('|');
}
