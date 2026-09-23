import { formatDistance } from './helpers/distance-format.helper';
import { formatCentsAsDollars } from './helpers/money-format.helper';
import { Order } from '../../../domain/entities/order';
import { OrderItem } from '../../../domain/entities/order-item';
import { OrderStatus } from '../../../domain/enum-types/order-status';
import { PaymentStatus } from '../../../domain/enum-types/payment-status';
import type { DistanceBreakdown } from './helpers/distance-format.helper';

export interface OrderResponseWarehouse {
  id: string;
  name: string;
  distance: DistanceBreakdown;
}

/** Raw allocation result (meters only) — the shape `AllocateInventoryUseCase` hands back, before `toOrderResponse()` projects it into `OrderResponseWarehouse`. */
export interface WarehouseAllocationInfo {
  id: string;
  name: string;
  distanceMeters: number;
}

export interface OrderResponseItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  unitPriceDollars: string;
}

/** specs/05-order-creation-saga.md, Data model — the `201` body's shape. */
export interface OrderResponse {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  warehouse: OrderResponseWarehouse;
  items: OrderResponseItem[];
  totalCents: number;
  totalDollars: string;
  currency: string;
  paymentStatus: PaymentStatus;
}

export interface BuildOrderResponseParams {
  order: Order;
  items: OrderItem[];
  warehouse: WarehouseAllocationInfo;
  paymentStatus: PaymentStatus;
}

/** R4.6: the reviewer must see which warehouse was chosen, and why (its name and distance), without opening psql. */
export function toOrderResponse(
  params: BuildOrderResponseParams,
): OrderResponse {
  const { order, items, warehouse, paymentStatus } = params;

  return {
    id: order.getId(),
    orderNumber: order.getOrderNumber(),
    status: order.getStatus(),
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      distance: formatDistance(warehouse.distanceMeters),
    },
    items: items.map((item) => ({
      productId: item.getProductId(),
      sku: item.getProductSkuSnapshot(),
      name: item.getProductNameSnapshot(),
      quantity: item.getQuantity(),
      unitPriceCents: item.getUnitPrice().getAmountCents(),
      unitPriceDollars: formatCentsAsDollars(
        item.getUnitPrice().getAmountCents(),
      ),
    })),
    totalCents: order.getTotal().getAmountCents(),
    totalDollars: formatCentsAsDollars(order.getTotal().getAmountCents()),
    currency: order.getTotal().getCurrency(),
    paymentStatus,
  };
}
