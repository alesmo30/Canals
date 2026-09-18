import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Mirrors `inventory` (migration, step 8) — the concurrency hot path. No
 * domain mirror (R0.5): correctness depends on `SELECT ... FOR UPDATE`
 * (plain, blocking — never `SKIP LOCKED`; a row locked by a concurrent
 * reservation is contention to wait out, not stock to report as absent,
 * see `InventoryService.reserve`, specs/02-fulfilment-core.md Decisions),
 * so an in-memory `reserve()` would be a lie about where the real
 * guarantee lives. `quantity_available >= 0` and `quantity_reserved >= 0`
 * are enforced by the CHECK constraints created in the migration, not by
 * this class.
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
