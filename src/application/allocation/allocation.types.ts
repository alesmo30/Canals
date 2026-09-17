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
