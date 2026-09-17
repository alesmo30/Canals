import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { InsufficientStockError } from './errors';
import { ReserveCommand } from './allocation.types';

/**
 * specs/02-fulfilment-core.md, Decisions: a named constant, not an
 * environment variable — adding one would mean touching P0's
 * env.schema.ts and .env.example for a value nobody tunes per
 * deployment. P6's reaper reads this same constant, not a hardcoded 15.
 */
export const RESERVATION_TTL_MINUTES = 15;

/** specs/02-fulfilment-core.md, Decisions: same reasoning as the TTL above — a named constant, not an environment variable. */
const LOCK_TIMEOUT = '3s';

/** Postgres error code for "lock_timeout" firing while waiting on a row lock (55P03, lock_not_available). */
const LOCK_TIMEOUT_ERROR_CODE = '55P03';

interface InventoryRow {
  product_id: string;
  quantity_available: number;
  quantity_reserved: number;
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

    await manager.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);

    let rows: InventoryRow[];
    try {
      // ORDER BY product_id, not the order the caller's lines arrived in
      // — otherwise two orders reserving the same products in reverse
      // order could deadlock each other (Decisions).
      rows = await manager.query(
        `SELECT product_id, quantity_available, quantity_reserved
         FROM inventory
         WHERE warehouse_id = $1 AND product_id = ANY($2::uuid[])
         ORDER BY product_id
         FOR UPDATE`,
        [command.warehouseId, productIds],
      );
    } catch (error: unknown) {
      if (isLockTimeout(error)) {
        throw new InsufficientStockError(productIds);
      }
      throw error;
    }

    const byProductId = new Map(rows.map((row) => [row.product_id, row]));

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

      await manager.query(
        `UPDATE inventory
         SET quantity_available = $3, quantity_reserved = $4, version = version + 1, updated_at = now()
         WHERE warehouse_id = $1 AND product_id = $2`,
        [command.warehouseId, line.productId, availableAfter, reservedAfter],
      );

      // Append-only ledger: order_id is always populated on rows P1
      // writes (Decisions) — a movement that cannot name its order
      // answers none of the questions the ledger exists for.
      await manager.query(
        `INSERT INTO inventory_movements
           (warehouse_id, product_id, order_id, type, quantity_delta, available_after, reserved_after)
         VALUES ($1, $2, $3, 'RESERVE', $4, $5, $6)`,
        [
          command.warehouseId,
          line.productId,
          command.orderId,
          -line.quantity,
          availableAfter,
          reservedAfter,
        ],
      );
    }

    await manager.query(
      `UPDATE orders
       SET warehouse_id = $1, reservation_expires_at = now() + ($2 * interval '1 minute')
       WHERE id = $3`,
      [command.warehouseId, RESERVATION_TTL_MINUTES, command.orderId],
    );
  }
}

function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === LOCK_TIMEOUT_ERROR_CODE
  );
}
