import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { GeoPoint } from '../interfaces/geo-point';

/**
 * Mirrors `warehouses` (migration, step 7). No domain mirror (R0.5): this
 * is the selection-query repository's table (P1), not an in-memory
 * invariant.
 *
 * `location` is a GeoPoint — see geo-point.ts for what TypeORM actually
 * returns/accepts for a `geography` column once `spatialFeatureType`/`srid`
 * are declared, verified directly against a live database.
 *
 * `latitude`/`longitude` are `insert: false, update: false`: Postgres
 * itself rejects writes to them (GENERATED ALWAYS ... STORED, verified in
 * step 7/8), so TypeORM is told the same thing up front rather than
 * discovering it from a rejected query.
 */
@Entity('warehouses')
export class WarehouseOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'jsonb' })
  address!: Record<string, unknown>;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location!: GeoPoint;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    insert: false,
    update: false,
  })
  latitude!: string;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    insert: false,
    update: false,
  })
  longitude!: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
