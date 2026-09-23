import { formatCentsAsDollars } from './helpers/money-format.helper';
import { OrderResponseItem } from './order-response.dto';
import type { OrderStatus } from '../../../domain/enum-types/order-status';
import type { ListOrdersResult } from '../../../application/orders/list-orders.service';
import type {
  OrderItemRow,
  OrderRow,
} from '../../database/repositories/orders-read.repository';

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouseId: string | null;
  totalCents: number;
  totalDollars: string;
  currency: string;
  createdAt: string;
  items: OrderResponseItem[];
}

export interface OrderListResponse {
  items: OrderListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Explicit field-by-field projection, never a spread, so new columns can't leak into the response. */
export function toOrderListItem(
  order: OrderRow,
  items: OrderItemRow[],
): OrderListItem {
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerId: order.customer_id,
    status: order.status,
    warehouseId: order.warehouse_id,
    totalCents: Number(order.total_cents),
    totalDollars: formatCentsAsDollars(Number(order.total_cents)),
    currency: order.currency,
    createdAt: order.created_at.toISOString(),
    items: items.map((item) => ({
      productId: item.product_id,
      sku: item.product_sku_snapshot,
      name: item.product_name_snapshot,
      quantity: item.quantity,
      unitPriceCents: Number(item.unit_price_cents),
      unitPriceDollars: formatCentsAsDollars(Number(item.unit_price_cents)),
    })),
  };
}

export function toOrderListResponse(
  result: ListOrdersResult,
): OrderListResponse {
  return {
    items: result.orders.map(({ order, items }) =>
      toOrderListItem(order, items),
    ),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  };
}
