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

/** Also read by the reservation reaper — don't hardcode 15 elsewhere. */
export const RESERVATION_TTL_MINUTES = 15;

interface LatestMovementRow {
  type: 'RESERVE' | 'RELEASE' | 'COMMIT' | 'RESTOCK' | 'ADJUST';
  quantity_delta: number;
}

/**
 * Every method takes the caller's EntityManager and never opens its own
 * transaction; AllocateInventoryUseCase owns the boundary and the failover
 * loop.
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

    // Re-verify availability under the lock: the candidate came from a query
    // run before this transaction, so stock may have moved.
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

      // Movements always carry order_id — a row that can't name its order
      // answers none of the ledger's questions.
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
   * Returns each line's reserved stock (amount from its RESERVE movement).
   * Idempotent: no-op when the line's latest movement is already RELEASE or
   * COMMIT ("any RELEASE exists" would miss release-after-commit).
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
   * Ends the reservation without touching quantity_available (units left
   * the pool at reserve). Idempotent, same latest-movement rule as release.
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
