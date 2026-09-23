import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { GeoPoint } from '../interfaces/geo-point';

/**
 * `location` is a GeoPoint (see geo-point.ts). `latitude`/`longitude` are
 * GENERATED columns — insert/update false because Postgres rejects writes to them.
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
