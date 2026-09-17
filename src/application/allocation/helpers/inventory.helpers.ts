import { EntityManager } from 'typeorm';

/** specs/02-fulfilment-core.md, Decisions: a named constant, not an environment variable — adding one would mean touching P0's env.schema.ts/.env.example for a value nobody tunes per deployment. */
const LOCK_TIMEOUT = '3s';

/** Postgres error code for "lock_timeout" firing while waiting on a row lock (55P03, lock_not_available). */
const LOCK_TIMEOUT_ERROR_CODE = '55P03';

export interface InventoryRow {
  product_id: string;
  quantity_available: number;
  quantity_reserved: number;
}

export interface UpdateInventoryBalancesParams {
  warehouseId: string;
  productId: string;
  availableAfter: number;
  reservedAfter: number;
}

export interface InsertMovementParams {
  warehouseId: string;
  productId: string;
  orderId: string;
  type: 'RESERVE' | 'RELEASE' | 'COMMIT';
  quantityDelta: number;
  availableAfter: number;
  reservedAfter: number;
}

/**
 * `SET LOCAL lock_timeout` + `SELECT ... FOR UPDATE ORDER BY product_id`
 * — the locking discipline shared by `InventoryService.reserve`,
 * `.release` and `.commit`. ORDER BY product_id, not the order the
 * caller's lines arrived in — otherwise two orders touching the same
 * products in reverse order could deadlock each other
 * (specs/02-fulfilment-core.md, Decisions).
 */
export async function lockInventoryRows(
  manager: EntityManager,
  warehouseId: string,
  productIds: string[],
): Promise<Map<string, InventoryRow>> {
  await manager.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);

  const rows: InventoryRow[] = await manager.query(
    `SELECT product_id, quantity_available, quantity_reserved
     FROM inventory
     WHERE warehouse_id = $1 AND product_id = ANY($2::uuid[])
     ORDER BY product_id
     FOR UPDATE`,
    [warehouseId, productIds],
  );

  return new Map(rows.map((row) => [row.product_id, row]));
}

/** Writes one `(warehouse_id, product_id)` row's new balances. */
export async function updateInventoryBalances(
  manager: EntityManager,
  params: UpdateInventoryBalancesParams,
): Promise<void> {
  await manager.query(
    `UPDATE inventory
     SET quantity_available = $3, quantity_reserved = $4, version = version + 1, updated_at = now()
     WHERE warehouse_id = $1 AND product_id = $2`,
    [
      params.warehouseId,
      params.productId,
      params.availableAfter,
      params.reservedAfter,
    ],
  );
}

/** Appends one row to the append-only ledger — no `UPDATE`, no `DELETE`, ever, against this table (specs/02-fulfilment-core.md, acceptance criteria). */
export async function insertMovement(
  manager: EntityManager,
  params: InsertMovementParams,
): Promise<void> {
  await manager.query(
    `INSERT INTO inventory_movements
       (warehouse_id, product_id, order_id, type, quantity_delta, available_after, reserved_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.warehouseId,
      params.productId,
      params.orderId,
      params.type,
      params.quantityDelta,
      params.availableAfter,
      params.reservedAfter,
    ],
  );
}

/** True when `error` is Postgres's `lock_timeout` error (55P03, lock_not_available). */
export function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === LOCK_TIMEOUT_ERROR_CODE
  );
}
