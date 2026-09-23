import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Concurrency hot path. Correctness lives in `SELECT ... FOR UPDATE` (plain,
 * blocking — never `SKIP LOCKED`) and the non-negative CHECK constraints, not
 * in this class. See knowledge/allocation.md#locking
 */
@Entity('inventory')
export class InventoryOrmEntity {
  @PrimaryColumn({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @PrimaryColumn({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'quantity_available', type: 'integer' })
  quantityAvailable!: number;

  @Column({ name: 'quantity_reserved', type: 'integer' })
  quantityReserved!: number;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
