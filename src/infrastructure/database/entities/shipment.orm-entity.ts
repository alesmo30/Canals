import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { ShipmentStatus } from '../../../domain/enum-types/shipment-status';

/** Runtime mirror of shipment_status (TypeORM's `enum` option needs an array). */
const SHIPMENT_STATUS_VALUES: readonly ShipmentStatus[] = [
  'PENDING_DISPATCH',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
];

/** No domain class: UNIQUE(order_id) is what makes the shipment handler idempotent. */
@Entity('shipments')
export class ShipmentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({
    type: 'enum',
    enum: SHIPMENT_STATUS_VALUES,
    enumName: 'shipment_status',
  })
  status!: ShipmentStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  carrier!: string | null;

  @Column({
    name: 'tracking_number',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  trackingNumber!: string | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
