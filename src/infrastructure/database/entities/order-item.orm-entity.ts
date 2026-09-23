import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { bigintNumberTransformer } from '../transformers/bigint-number.transformer';

/**
 * Maps to OrderItem via order.mapper. `quantity > 0` is enforced by a CHECK
 * and by OrderItem's constructor.
 */
@Entity('order_items')
export class OrderItemOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ name: 'product_sku_snapshot', type: 'varchar', length: 64 })
  productSkuSnapshot!: string;

  @Column({ name: 'product_name_snapshot', type: 'varchar', length: 200 })
  productNameSnapshot!: string;

  @Column({
    name: 'unit_price_cents',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  unitPriceCents!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
