/**
 * The shape TypeORM's postgres driver actually returns (and accepts on
 * write, via `repository.save()`) for a `geography(Point, 4326)` column
 * once `spatialFeatureType`/`srid` are declared on the `@Column()` — a
 * plain GeoJSON Point, not raw EWKB hex. Verified directly against a live
 * migrated database: a warehouse inserted with `coordinates: [lng, lat]`
 * read back byte-for-byte identical, both through `find()` and via the
 * generated `latitude`/`longitude` columns.
 *
 * Coordinate order is `[longitude, latitude]` — GeoJSON's own convention
 * (x, y), the reverse of how coordinates are normally spoken. Same
 * ordering risk Coordinates.of()'s named-argument fix (step 4) guards
 * against on the domain side; there is no equivalent guard here since
 * this shape is GeoJSON's, not this codebase's to redesign.
 */
export interface GeoPoint {
  type: 'Point';
  coordinates: [longitude: number, latitude: number];
}
