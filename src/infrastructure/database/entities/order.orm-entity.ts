import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { bigintNumberTransformer } from '../transformers/bigint-number.transformer';
import type { GeoPoint } from '../interfaces/geo-point';
import type { OrderStatus } from '../../../domain/enum-types/order-status';

/** Runtime mirror of order_status (TypeORM's `enum` option needs an array). Also used by ListOrdersQueryDto. */
export const ORDER_STATUS_VALUES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PAYMENT_FAILED',
  'CANCELLED',
];

/**
 * No business rules here; Order owns the state machine (converted by
 * order.mapper). `shippingLocation` is a GeoPoint (see geo-point.ts).
 */
@Entity('orders')
export class OrderOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_number', type: 'varchar', length: 32, unique: true })
  orderNumber!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'enum', enum: ORDER_STATUS_VALUES, enumName: 'order_status' })
  status!: OrderStatus;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({
    name: 'total_cents',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  totalCents!: number;

  @Column({ name: 'shipping_address', type: 'jsonb' })
  shippingAddress!: Record<string, unknown>;

  @Column({
    name: 'shipping_location',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  shippingLocation!: GeoPoint;

  @Column({
    name: 'reservation_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  reservationExpiresAt!: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  cancellationReason!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
