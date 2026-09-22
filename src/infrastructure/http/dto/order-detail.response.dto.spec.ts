import { randomUUID } from 'crypto';

import { toOrderDetailResponse } from './order-detail.response.dto';
import type { GetOrderResult } from '../../../application/orders/get-order.service';
import type {
  OrderDetailRow,
  OrderItemRow,
  PaymentAttemptRow,
  ShipmentRow,
} from '../../database/repositories/orders-read.repository';

function makeOrderDetailRow(
  overrides: Partial<OrderDetailRow> = {},
): OrderDetailRow {
  return {
    id: randomUUID(),
    order_number: 'CNL-2026-000001',
    customer_id: randomUUID(),
    warehouse_id: randomUUID(),
    status: 'PAID',
    currency: 'USD',
    total_cents: '2000',
    created_at: new Date('2026-01-15T10:30:00.000Z'),
    shipping_address: { recipient: 'Ada Lovelace', country: 'US' },
    warehouse_name: 'Newark DC',
    distance_meters: 1234.5,
    ...overrides,
  };
}

function makeItemRow(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    order_id: randomUUID(),
    product_id: randomUUID(),
    quantity: 1,
    product_sku_snapshot: 'SKU-1',
    product_name_snapshot: 'iPhone 15',
    unit_price_cents: '2000',
    created_at: new Date(),
    ...overrides,
  };
}

function makePaymentRow(
  overrides: Partial<PaymentAttemptRow> = {},
): PaymentAttemptRow {
  return {
    attempt: 1,
    status: 'CAPTURED',
    amount_cents: '2000',
    currency: 'USD',
    failure_code: null,
    settled_at: new Date('2026-01-15T10:31:00.000Z'),
    created_at: new Date('2026-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

function makeShipmentRow(overrides: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    status: 'DISPATCHED',
    carrier: 'UPS',
    tracking_number: '1Z999',
    dispatched_at: new Date('2026-01-16T00:00:00.000Z'),
    delivered_at: null,
    ...overrides,
  };
}

describe('toOrderDetailResponse', () => {
  it('projects a GetOrderResult into the exact OrderDetailResponse shape', () => {
    const order = makeOrderDetailRow();
    const item = makeItemRow({ order_id: order.id });
    const payment = makePaymentRow();
    const shipment = makeShipmentRow();
    const result: GetOrderResult = {
      order,
      items: [item],
      payments: [payment],
      shipment,
    };

    const response = toOrderDetailResponse(result);

    expect(response).toEqual({
      id: order.id,
      orderNumber: order.order_number,
      customerId: order.customer_id,
      status: order.status,
      warehouse: {
        id: order.warehouse_id,
        name: order.warehouse_name,
        distanceMeters: order.distance_meters,
      },
      items: [
        {
          productId: item.product_id,
          sku: item.product_sku_snapshot,
          name: item.product_name_snapshot,
          quantity: item.quantity,
          unitPriceCents: 2000,
        },
      ],
      payments: [
        {
          attempt: 1,
          status: 'CAPTURED',
          amountCents: 2000,
          currency: 'USD',
          failureCode: null,
          settledAt: '2026-01-15T10:31:00.000Z',
          createdAt: '2026-01-15T10:30:00.000Z',
        },
      ],
      shipment: {
        status: 'DISPATCHED',
        carrier: 'UPS',
        trackingNumber: '1Z999',
        dispatchedAt: '2026-01-16T00:00:00.000Z',
        deliveredAt: null,
      },
      totalCents: 2000,
      currency: order.currency,
      createdAt: order.created_at.toISOString(),
    });
  });

  it('warehouse is null when warehouse_id/warehouse_name came back null', () => {
    const order = makeOrderDetailRow({
      warehouse_id: null,
      warehouse_name: null,
      distance_meters: null,
    });
    const result: GetOrderResult = {
      order,
      items: [],
      payments: [],
      shipment: null,
    };

    const response = toOrderDetailResponse(result);

    expect(response.warehouse).toBeNull();
  });

  it('shipment is null when there is no shipment row', () => {
    const order = makeOrderDetailRow();
    const result: GetOrderResult = {
      order,
      items: [],
      payments: [],
      shipment: null,
    };

    const response = toOrderDetailResponse(result);

    expect(response.shipment).toBeNull();
  });

  it('does not leak card_last4/card_brand/raw_response/provider_payment_id/idempotency_key, even if the payment row carries them', () => {
    const order = makeOrderDetailRow();
    const contaminatedPayment = {
      ...makePaymentRow(),
      card_last4: '4242',
      card_brand: 'visa',
      raw_response: { secret: 'x' },
      provider_payment_id: 'prov_123',
      idempotency_key: 'leaked-key',
    } as unknown as PaymentAttemptRow;
    const result: GetOrderResult = {
      order,
      items: [],
      payments: [contaminatedPayment],
      shipment: null,
    };

    const response = toOrderDetailResponse(result);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('card_last4');
    expect(serialized).not.toContain('card_brand');
    expect(serialized).not.toContain('raw_response');
    expect(serialized).not.toContain('provider_payment_id');
    expect(serialized).not.toContain('idempotency_key');
    expect(serialized).not.toContain('4242');
    expect(serialized).not.toContain('visa');
    expect(serialized).not.toContain('prov_123');
    expect(serialized).not.toContain('leaked-key');
    expect(Object.keys(response.payments[0]).sort()).toEqual(
      [
        'attempt',
        'status',
        'amountCents',
        'currency',
        'failureCode',
        'settledAt',
        'createdAt',
      ].sort(),
    );
  });
});
