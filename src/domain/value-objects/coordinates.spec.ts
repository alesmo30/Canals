import { Coordinates } from './coordinates';

describe('Coordinates', () => {
  it('holds a valid latitude/longitude pair', () => {
    // Newark, NJ — one of the seed warehouses.
    const point = Coordinates.of({
      latitude: 40.735657,
      longitude: -74.172363,
    });

    expect(point.getLatitude()).toBe(40.735657);
    expect(point.getLongitude()).toBe(-74.172363);
  });

  it.each([-91, 91, NaN, Infinity])(
    'rejects an out-of-range latitude (%p)',
    (latitude) => {
      expect(() => Coordinates.of({ latitude, longitude: 0 })).toThrow(
        /Latitude/,
      );
    },
  );

  it.each([-181, 181, NaN, -Infinity])(
    'rejects an out-of-range longitude (%p)',
    (longitude) => {
      expect(() => Coordinates.of({ latitude: 0, longitude })).toThrow(
        /Longitude/,
      );
    },
  );

  it('accepts the boundary values', () => {
    expect(() =>
      Coordinates.of({ latitude: 90, longitude: 180 }),
    ).not.toThrow();
    expect(() =>
      Coordinates.of({ latitude: -90, longitude: -180 }),
    ).not.toThrow();
  });

  it('is equal by value, not by reference', () => {
    expect(
      Coordinates.of({ latitude: 1, longitude: 2 }).equals(
        Coordinates.of({ latitude: 1, longitude: 2 }),
      ),
    ).toBe(true);
    expect(
      Coordinates.of({ latitude: 1, longitude: 2 }).equals(
        Coordinates.of({ latitude: 1, longitude: 3 }),
      ),
    ).toBe(false);
  });

  it('does not compile with positional latitude/longitude arguments, preventing an accidental swap', () => {
    // A routing bug this exact shape once shipped silently: Coordinates.of(lng, lat)
    // compiles fine when both parameters are plain `number`, because a swapped pair
    // still lands in range for both fields within the continental US. The named-object
    // signature turns that into a type error instead of a silent wrong location. If a
    // future edit reverts Coordinates.of to positional args, the directive below starts
    // reporting "unused" instead — a loud compile failure, not a silent regression.
    // @ts-expect-error Coordinates.of takes one { latitude, longitude } object, not positional args.
    expect(() => Coordinates.of(40.735657, -74.172363)).toThrow();
  });
});
