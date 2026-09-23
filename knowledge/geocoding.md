# Geocoding

Turns the order's shipping address into coordinates so the selection query
can rank warehouses by distance. Two drivers (a static, offline table and
Geoapify) behind one port, wrapped in an in-memory cache.

Main source: [spec 03, Geocoding and Decisions › “Geocoding”, “Caching”](../specs/03-external-adapters.md#geocoding).
Operator view: README, "Geocoding: static by default, Geoapify opt-in".

## Port

Code: `src/domain/ports/geocoding-provider.ts` → `GeocodingProvider`, `GEOCODING_PROVIDER`

`GeocodingProvider.geocode(address)` returns `Coordinates`
([domain.md#coordinates](domain.md#coordinates)). Only the **shipping
address** is geocoded, once per order, in the saga's reserve phase and
before any transaction opens
([orders-saga.md#saga-phases](orders-saga.md#saga-phases)). Warehouse
coordinates are fixed reference data, seeded once, never geocoded at
request time.

The driver is chosen by `GEOCODING_DRIVER` (`static` by default, or
`geoapify`) in `SharedModule`, and always wrapped in
`CachingGeocodingProvider`
([architecture.md#adapter-selection](architecture.md#adapter-selection)).

Source: [spec 01, “Port interfaces, frozen”](../specs/01-foundation.md#port-interfaces-frozen).

## Errors

Code: `src/domain/ports/geocoding-errors.ts` → `GeocodingFailureReason`, `GeocodingFailedError`

`GeocodingFailedError` carries a reason:
- `UNKNOWN_ADDRESS`: no match (or an ambiguous one) for the address;
- `PROVIDER_UNAVAILABLE`: the provider cannot answer (retries exhausted,
  breaker open, or a rejected API key).

The problem-details filter maps both to **422**
(`urn:problem-type:geocoding-failed`). The type lives in the domain, beside
the port, so the application layer can handle it without importing
infrastructure ([references/layering.md](../references/layering.md)).

## Normalisation

Code: `src/infrastructure/geocoding/normalisation.ts` → `STATE_NAME_TO_CODE`, `normalizeText`, `canonicalizeStateCode`, `buildNormalisedAddress`

Shared by the static lookup, the static jitter and the cache key, so all
three agree on what "the same address" means.

- `normalizeText`: Unicode NFD with diacritics stripped, trimmed, internal
  whitespace collapsed, lower-cased.
- `STATE_NAME_TO_CODE`: full state name → two-letter USPS code (50 states
  plus DC, 51 entries).
- `canonicalizeStateCode`: a two-letter code stays as is (upper-cased); a
  full name ("New York") is looked up in the table; anything else returns
  `undefined`. That is not fatal by itself; the city lookup decides.
- `buildNormalisedAddress`: `line1|line2|city|state|postalCode|country`,
  empty string for an absent field, every field normalised, with `state`
  first canonicalised (so `"NY"` and `"New York"` give the same string).
  The **recipient is excluded**: two people at one address are one point.

Source: [spec 03, Geocoding](../specs/03-external-adapters.md#geocoding).

## Static provider

Code:
- `src/infrastructure/geocoding/static-geocoding.provider.ts` → `StaticGeocodingProvider`, `StaticGeocodingProvider.geocode`, `STATIC_JITTER_DEGREES`, `resolveCityCentre`
- `src/infrastructure/geocoding/us-cities.ts` → `US_CITIES`

The default driver, for demo and test use only (a real provider is
Geoapify's job, opt-in). No network call, ever.

- `US_CITIES`: about 30 entries keyed by normalised `city|STATE` (city via
  `normalizeText`, state as the USPS code). It includes the five warehouse
  cities with the same coordinates as the seed's `WAREHOUSES`, so "a New
  York address returns Newark first" holds against seeded data. It also
  includes both `portland|OR` and `portland|ME` on purpose, to exercise the
  ambiguity rule.
- `resolveCityCentre`: with a state, an exact `city|STATE` match or nothing.
  Without a state, a match on the city alone only when that name is unique
  in the table. Tolerant, but it never guesses on ambiguity: `Portland`
  with no state is `UNKNOWN_ADDRESS`.
- Jitter: up to ±`STATIC_JITTER_DEGREES` (0.05°, about 5 km) around the city
  centre, derived from a sha256 of the normalised address (recipient
  excluded). It is deterministic across runs and processes, and irrelevant
  for ranking when warehouses are hundreds of km apart.
- `geocode` is `async` with no `await` inside (hence the
  `require-await` lint directive): a thrown `GeocodingFailedError` must
  reach the caller as a rejected promise, like every other driver behind
  this port; this driver alone does no I/O.

Source: [spec 03, Decisions › “Geocoding”](../specs/03-external-adapters.md#decisions).

## Geoapify

Code: `src/infrastructure/geocoding/geoapify-geocoding.provider.ts` → `GeoapifyGeocodingProvider`, `GeoapifyRetryableError`, `ATTEMPT_TIMEOUT_MS`

The opt-in real driver (`GEOCODING_DRIVER=geoapify`, needs
`GEOAPIFY_API_KEY`). It calls Geoapify's **structured**
`/v1/geocode/search`: the address already arrives as separate fields, so
free-text parsing would only add ambiguity. It uses its own `'geoapify'`
circuit breaker and the shared retry policy and per-attempt timeout
([http-payments.md#resilience](http-payments.md#resilience),
[http-payments.md#circuit-breaker](http-payments.md#circuit-breaker)).

- `GeoapifyRetryableError` is the base for every failure worth retrying:
  5xx and 429 (transient), plus `fetch` failures (timeout, network).
- **401 / 403 resolve instead of throwing**: a bad API key is not an
  outage, so it must not be retried and must not open the breaker. It
  becomes `PROVIDER_UNAVAILABLE` with a "check GEOAPIFY_API_KEY" message, and
  the logged URL goes through `redact()` so the key never leaks.
- No features → `UNKNOWN_ADDRESS`. Only `features[0].properties.lat/lon` is
  read.

Source: [spec 03, Decisions › “Geocoding”](../specs/03-external-adapters.md#decisions).

## Cache

Code: `src/infrastructure/geocoding/caching-geocoding.provider.ts` → `CachingGeocodingProvider`, `GEOCODE_CACHE_MAX_ENTRIES`

An in-memory LRU decorator around whichever driver is selected.

- It caches **address → coordinates only**. Warehouse selection and distance
  are recomputed on every order.
- The key is the sha256 of the normalised address, recipient excluded (two
  people at one address share one entry).
- `GEOCODE_CACHE_MAX_ENTRIES = 10_000`, **no TTL**: a static result never
  changes, and Geoapify's terms allow storing results.
- Hand-written, no dependency: a JS `Map` iterates in insertion order, so
  re-inserting a key on every hit (`delete` then `set`) keeps it at the
  most-recently-used end, and evicting the first key evicts the least
  recently used one.
- **Failures are never cached**: if the delegate rejects, the error
  propagates before `set()` runs, so a Geoapify outage cannot mark an
  address as bad after the provider recovers.

Source: [spec 03, Decisions › “Caching”](../specs/03-external-adapters.md#decisions).
