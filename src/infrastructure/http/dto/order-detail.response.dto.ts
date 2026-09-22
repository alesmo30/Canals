import {
  OrderResponseItem,
  OrderResponseWarehouse,
} from './order-response.dto';
import type { GetOrderResult } from '../../../application/orders/get-order.service';
import type { OrderStatus } from '../../../domain/enum-types/order-status';
import type { PaymentStatus } from '../../../domain/enum-types/payment-status';
import type { ShipmentStatus } from '../../../domain/enum-types/shipment-status';

export interface OrderDetailPaymentAttempt {
  attempt: number;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  failureCode: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface OrderDetailShipment {
  status: ShipmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderDetailResponse {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouse: OrderResponseWarehouse | null;
  items: OrderResponseItem[];
  payments: OrderDetailPaymentAttempt[];
  shipment: OrderDetailShipment | null;
  totalCents: number;
  currency: string;
  createdAt: string;
}

/**
 * specs/06-read-side.md, R5.5 — an explicit field-by-field projection.
 * Deliberately leaves out `card_last4`/`card_brand`/`provider_payment_id`/
 * `idempotency_key`/`raw_response` — no field in `PaymentAttemptRow`
 * beyond the ones listed here is ever read (Decisions).
 */
export function toOrderDetailResponse(
  result: GetOrderResult,
): OrderDetailResponse {
  const { order, items, payments, shipment } = result;

  return {
    id: order.id,
    orderNumber: order.order_number,
    customerId: order.customer_id,
    status: order.status,
    warehouse:
      order.warehouse_id && order.warehouse_name
        ? {
            id: order.warehouse_id,
            name: order.warehouse_name,
            distanceMeters: order.distance_meters ?? 0,
          }
        : null,
    items: items.map((item) => ({
      productId: item.product_id,
      sku: item.product_sku_snapshot,
      name: item.product_name_snapshot,
      quantity: item.quantity,
      unitPriceCents: Number(item.unit_price_cents),
    })),
    payments: payments.map((payment) => ({
      attempt: payment.attempt,
      status: payment.status,
      amountCents: Number(payment.amount_cents),
      currency: payment.currency,
      failureCode: payment.failure_code,
      settledAt: payment.settled_at ? payment.settled_at.toISOString() : null,
      createdAt: payment.created_at.toISOString(),
    })),
    shipment: shipment
      ? {
          status: shipment.status,
          carrier: shipment.carrier,
          trackingNumber: shipment.tracking_number,
          dispatchedAt: shipment.dispatched_at
            ? shipment.dispatched_at.toISOString()
            : null,
          deliveredAt: shipment.delivered_at
            ? shipment.delivered_at.toISOString()
            : null,
        }
      : null,
    totalCents: Number(order.total_cents),
    currency: order.currency,
    createdAt: order.created_at.toISOString(),
  };
}
