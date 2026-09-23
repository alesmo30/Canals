import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { bigintNumberTransformer } from '../transformers/bigint-number.transformer';
import type { ProductCondition } from '../../../domain/enum-types/product-condition';

/** Runtime mirror of product_condition (TypeORM's `enum` option needs an array). */
const PRODUCT_CONDITION_VALUES: readonly ProductCondition[] = [
  'NEW',
  'REFURBISHED',
  'OPEN_BOX',
  'USED',
];

/** No domain class: only read inside other queries. */
@Entity('products')
export class ProductOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  sku!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'enum',
    enum: PRODUCT_CONDITION_VALUES,
    enumName: 'product_condition',
  })
  condition!: ProductCondition;

  @Column({
    name: 'unit_price_cents',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  unitPriceCents!: number;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
