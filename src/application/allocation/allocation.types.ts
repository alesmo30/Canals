/**
 * specs/02-fulfilment-core.md — TypeScript contracts shared across the
 * selection query, `InventoryService` and `AllocateInventoryUseCase`.
 * Quantity is a positive integer; validating that belongs to P4's DTO,
 * not here.
 */
export interface OrderLine {
  productId: string;
  quantity: number;
}

/**
 * Everything `InventoryService.reserve` needs. `manager` — the caller's
 * transaction — travels as the method's own first argument, not as a
 * field here (specs/02-fulfilment-core.md, Decisions: reserve/release/
 * commit never open a transaction of their own).
 */
export interface ReserveCommand {
  orderId: string;
  warehouseId: string;
  lines: OrderLine[];
}
