import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Mirrors the `inventory_movement_type` Postgres enum (migration, step 7).
 * Not a domain enum-type: this audit ledger has no mirror in
 * src/domain/enum-types/ — it was never part of R0.5's frozen list, unlike
 * order/payment/shipment status and product condition.
 */
export type InventoryMovementType =
  'RESERVE' | 'RELEASE' | 'COMMIT' | 'RESTOCK' | 'ADJUST';

const INVENTORY_MOVEMENT_TYPE_VALUES: readonly InventoryMovementType[] = [
  'RESERVE',
  'RELEASE',
  'COMMIT',
  'RESTOCK',
  'ADJUST',
];

/**
 * Mirrors `inventory_movements` (migration, step 8) — an append-only
 * ledger, never updated, never deleted (data-model.dbml note). No domain
 * mirror (R0.5): written inside the inventory repository, not an
 * in-memory invariant.
 */
@Entity('inventory_movements')
export class InventoryMovementOrmEntity {
  // Matches the migration's `bigint GENERATED ALWAYS AS IDENTITY`. TypeORM
  // returns bigint columns as strings, since a real bigint can exceed
  // Number.MAX_SAFE_INTEGER — left as string, no bigintNumberTransformer
  // here: unlike the money columns, this ID has no reason to stay within
  // safe-integer range.
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
