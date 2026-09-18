import { EntityManager } from 'typeorm';

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

/**
 * Everything `InventoryService.release`/`.commit` need — `ReserveCommand`
 * minus `lines`, plus `productIds`. No quantities: both derive the amount
 * to move from the last `RESERVE` movement's `quantity_delta` for each
 * `(order_id, product_id)` — the ledger, not the caller, is the source of
 * truth for how much was reserved (specs/02-fulfilment-core.md,
 * Decisions). `Omit` + intersection, not `interface extends`: an
 * interface can only add fields on top of its base, never drop one
 * (`lines`), so this has to be a `type`.
 */
export type ReleaseCommand = Omit<ReserveCommand, 'lines'> & {
  productIds: string[];
};

/**
 * What `AllocateInventoryUseCase`'s `onBeforeReserve` callback gets, run
 * inside each attempt's transaction before `reserve` — P1 inserts a mock
 * order through it, P4 will insert the real one
 * (specs/02-fulfilment-core.md, Scope). `orderId` is generated once by
 * the use case, before the first attempt, and reused across attempts
 * (Decisions: a failed attempt rolls its whole transaction back, so
 * reusing one id across retries is safe, and keeps the id stable for
 * whichever caller — P4's idempotency key — is tracking it outside the
 * failover loop).
 */
export interface OnBeforeReserveParams {
  orderId: string;
  warehouseId: string;
}

export type OnBeforeReserve = (
  manager: EntityManager,
  params: OnBeforeReserveParams,
) => Promise<void>;
