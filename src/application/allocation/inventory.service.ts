import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { InsufficientStockError } from './errors';
import { ReleaseCommand, ReserveCommand } from './allocation.types';
import {
  insertMovement,
  InventoryRow,
  isLockTimeout,
  lockInventoryRows,
  updateInventoryBalances,
} from './helpers/inventory.helpers';

/**
 * specs/02-fulfilment-core.md, Decisions: a named constant, not an
 * environment variable — adding one would mean touching P0's
 * env.schema.ts and .env.example for a value nobody tunes per
 * deployment. P6's reaper reads this same constant, not a hardcoded 15.
 */
export const RESERVATION_TTL_MINUTES = 15;

interface LatestMovementRow {
  type: 'RESERVE' | 'RELEASE' | 'COMMIT' | 'RESTOCK' | 'ADJUST';
  quantity_delta: number;
}

/**
 * specs/02-fulfilment-core.md — reserve/release/commit all take the
 * caller's `EntityManager` and never open a transaction of their own
 * (Decisions: "Yes: reserve, release and commit all take the caller's
 * EntityManager..."). `AllocateInventoryUseCase` (step 8) owns the
 * transaction boundary and the failover loop.
 */
@Injectable()
export class InventoryService {
  async reserve(
    manager: EntityManager,
    command: ReserveCommand,
  ): Promise<void> {
    const productIds = command.lines.map((line) => line.productId);

    let byProductId: Map<string, InventoryRow>;
    try {
      byProductId = await lockInventoryRows(
        manager,
        command.warehouseId,
        productIds,
      );
    } catch (error: unknown) {
      if (isLockTimeout(error)) {
        throw new InsufficientStockError(productIds);
      }
      throw error;
    }

    // Re-verify availability under the lock — the candidate came from a
    // selection query run before this transaction opened, so stock may
    // have moved since (specs/02-fulfilment-core.md, R1.3's failover
    // exists exactly for this race).
    const unmetProductIds = command.lines
      .filter((line) => {
        const row = byProductId.get(line.productId);
        return !row || row.quantity_available < line.quantity;
      })
      .map((line) => line.productId);

    if (unmetProductIds.length > 0) {
      throw new InsufficientStockError(unmetProductIds);
    }

    for (const line of command.lines) {
      // Present by construction: every line just passed the unmet check
      // above, which requires a matching, sufficient row.
      const row = byProductId.get(line.productId)!;
      const availableAfter = row.quantity_available - line.quantity;
      const reservedAfter = row.quantity_reserved + line.quantity;

      await updateInventoryBalances(manager, {
        warehouseId: command.warehouseId,
        productId: line.productId,
        availableAfter,
        reservedAfter,
      });

      // Append-only ledger: order_id is always populated on rows P1
      // writes (Decisions) — a movement that cannot name its order
      // answers none of the questions the ledger exists for.
      await insertMovement(manager, {
        warehouseId: command.warehouseId,
        productId: line.productId,
        orderId: command.orderId,
        type: 'RESERVE',
        quantityDelta: -line.quantity,
        availableAfter,
        reservedAfter,
      });
    }

    await manager.query(
      `UPDATE orders
       SET warehouse_id = $1, reservation_expires_at = now() + ($2 * interval '1 minute')
       WHERE id = $3`,
      [command.warehouseId, RESERVATION_TTL_MINUTES, command.orderId],
    );
  }

  /**
   * Returns the reservation's stock, per line: `quantity_available` up,
   * `quantity_reserved` down, by the amount that line's `RESERVE`
   * movement originally moved. Idempotent: no-ops a line whose latest
   * movement is already `RELEASE` or `COMMIT` (specs/02-fulfilment-core.md,
   * Decisions — checking only "any RELEASE exists" would miss the
   * release-after-commit case).
   */
  async release(
    manager: EntityManager,
    command: ReleaseCommand,
  ): Promise<void> {
    const byProductId = await lockInventoryRows(
      manager,
      command.warehouseId,
      command.productIds,
    );

    for (const productId of command.productIds) {
      const latestRows: LatestMovementRow[] = await manager.query(
        `SELECT type, quantity_delta
         FROM inventory_movements
         WHERE order_id = $1 AND product_id = $2
         ORDER BY id DESC
         LIMIT 1`,
        [command.orderId, productId],
      );
      const latest = latestRows[0];

      // Nothing was ever reserved for this line, or the reservation
      // already reached a terminal state: a no-op either way.
      if (!latest || latest.type === 'RELEASE' || latest.type === 'COMMIT') {
        continue;
      }

      const row = byProductId.get(productId);
      if (!row) continue; // defensive: a RESERVE movement implies the inventory row exists

      const reservedQuantity = Math.abs(latest.quantity_delta);
      const availableAfter = row.quantity_available + reservedQuantity;
      const reservedAfter = row.quantity_reserved - reservedQuantity;

      await updateInventoryBalances(manager, {
        warehouseId: command.warehouseId,
        productId,
        availableAfter,
        reservedAfter,
      });

      await insertMovement(manager, {
        warehouseId: command.warehouseId,
        productId,
        orderId: command.orderId,
        type: 'RELEASE',
        quantityDelta: reservedQuantity,
        availableAfter,
        reservedAfter,
      });
    }
  }

  /**
   * Ends the reservation, per line, without touching
   * `quantity_available` — the units left the available pool when they
   * were reserved; confirming the sale only ends the reservation
   * (specs/02-fulfilment-core.md, Decisions). Idempotent, same rule as
   * `release`: no-ops a line whose latest movement is already `RELEASE`
   * or `COMMIT`.
   */
  async commit(manager: EntityManager, command: ReleaseCommand): Promise<void> {
    const byProductId = await lockInventoryRows(
      manager,
      command.warehouseId,
      command.productIds,
    );

    for (const productId of command.productIds) {
      const latestRows: LatestMovementRow[] = await manager.query(
        `SELECT type, quantity_delta
         FROM inventory_movements
         WHERE order_id = $1 AND product_id = $2
         ORDER BY id DESC
         LIMIT 1`,
        [command.orderId, productId],
      );
      const latest = latestRows[0];

      if (!latest || latest.type === 'RELEASE' || latest.type === 'COMMIT') {
        continue;
      }

      const row = byProductId.get(productId);
      if (!row) continue; // defensive: a RESERVE movement implies the inventory row exists

      const reservedQuantity = Math.abs(latest.quantity_delta);
      const reservedAfter = row.quantity_reserved - reservedQuantity;

      await updateInventoryBalances(manager, {
        warehouseId: command.warehouseId,
        productId,
        availableAfter: row.quantity_available, // unchanged — the sale was already out of the available pool
        reservedAfter,
      });

      await insertMovement(manager, {
        warehouseId: command.warehouseId,
        productId,
        orderId: command.orderId,
        type: 'COMMIT',
        quantityDelta: 0,
        availableAfter: row.quantity_available,
        reservedAfter,
      });
    }
  }
}
