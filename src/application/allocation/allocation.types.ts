import { EntityManager } from 'typeorm';

/**
 * Types shared by the selection query, InventoryService and
 * AllocateInventoryUseCase. Validating quantity belongs to the request DTO.
 */
export interface OrderLine {
  productId: string;
  quantity: number;
}

/**
 * The caller's transaction is the method's first argument, not a field:
 * reserve/release/commit never open their own transaction.
 */
export interface ReserveCommand {
  orderId: string;
  warehouseId: string;
  lines: OrderLine[];
}

/**
 * No quantities: release/commit derive the amount from the latest RESERVE
 * movement — the ledger is the source of truth. A `type` because an
 * interface can't drop `lines`.
 */
export type ReleaseCommand = Omit<ReserveCommand, 'lines'> & {
  productIds: string[];
};

/**
 * Runs inside each attempt's transaction before reserve (the saga inserts
 * the order here). orderId is generated once and reused across attempts.
 */
export interface OnBeforeReserveParams {
  orderId: string;
  warehouseId: string;
}

export type OnBeforeReserve = (
  manager: EntityManager,
  params: OnBeforeReserveParams,
) => Promise<void>;
