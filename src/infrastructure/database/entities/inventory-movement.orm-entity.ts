import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Mirrors the inventory_movement_type enum. Infrastructure-only, not a domain enum. */
export type InventoryMovementType =
  'RESERVE' | 'RELEASE' | 'COMMIT' | 'RESTOCK' | 'ADJUST';

const INVENTORY_MOVEMENT_TYPE_VALUES: readonly InventoryMovementType[] = [
  'RESERVE',
  'RELEASE',
  'COMMIT',
  'RESTOCK',
  'ADJUST',
];

/** Append-only ledger: never updated, never deleted. */
@Entity('inventory_movements')
export class InventoryMovementOrmEntity {
  // bigint identity comes back as a string; left as string (no
  // bigintNumberTransformer): unlike money, this ID can exceed safe-integer range.
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({
    type: 'enum',
    enum: INVENTORY_MOVEMENT_TYPE_VALUES,
    enumName: 'inventory_movement_type',
  })
  type!: InventoryMovementType;

  @Column({ name: 'quantity_delta', type: 'integer' })
  quantityDelta!: number;

  @Column({ name: 'available_after', type: 'integer' })
  availableAfter!: number;

  @Column({ name: 'reserved_after', type: 'integer' })
  reservedAfter!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
