/**
 * What TypeORM reads/writes for a `geography(Point, 4326)` column: a GeoJSON
 * Point. Order is `[longitude, latitude]`. See knowledge/database.md#geography-columns
 */
export interface GeoPoint {
  type: 'Point';
  coordinates: [longitude: number, latitude: number];
}
