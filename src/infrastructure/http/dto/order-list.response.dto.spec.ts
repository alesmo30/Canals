import { randomUUID } from 'crypto';

import {
  toOrderListItem,
  toOrderListResponse,
} from './order-list.response.dto';
import type { ListOrdersResult } from '../../../application/orders/list-orders.service';
import type {
  OrderItemRow,
  OrderRow,
} from '../../database/repositories/orders-read.repository';

function makeOrderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: randomUUID(),
    order_number: 'CNL-2026-000001',
    customer_id: randomUUID(),
    warehouse_id: randomUUID(),
    status: 'PAID',
    currency: 'USD',
    total_cents: '1000',
    created_at: new Date('2026-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

function makeOrderItemRow(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    order_id: randomUUID(),
    product_id: randomUUID(),
    quantity: 2,
    product_sku_snapshot: 'SKU-1',
    product_name_snapshot: 'iPhone 15',
    unit_price_cents: '500',
    created_at: new Date(),
    ...overrides,
  };
}

describe('toOrderListItem', () => {
  it('projects an OrderRow + OrderItemRow[] into the exact OrderListItem shape', () => {
    const row = makeOrderRow();
    const item = makeOrderItemRow({ order_id: row.id });

    const result = toOrderListItem(row, [item]);

    expect(result).toEqual({
      id: row.id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      status: row.status,
      warehouseId: row.warehouse_id,
      totalCents: 1000,
      totalDollars: '10.00',
      currency: row.currency,
      createdAt: '2026-01-15T10:30:00.000Z',
      items: [
        {
          productId: item.product_id,
          sku: item.product_sku_snapshot,
          name: item.product_name_snapshot,
          quantity: item.quantity,
          unitPriceCents: 500,
          unitPriceDollars: '5.00',
        },
      ],
    });
  });

  it('does not leak any field outside the OrderListItem interface, even if the row carries extra properties', () => {
    const contaminatedRow = {
      ...makeOrderRow(),
      raw_response: { secret: 'x' },
      card_last4: '4242',
      idempotency_key: 'leaked',
    } as unknown as OrderRow;

    const result = toOrderListItem(contaminatedRow, []);
    const keys = Object.keys(
      JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
    );

    expect(keys.sort()).toEqual(
      [
        'id',
        'orderNumber',
        'customerId',
        'status',
        'warehouseId',
        'totalCents',
        'totalDollars',
        'currency',
        'createdAt',
        'items',
      ].sort(),
    );
  });
});

describe('toOrderListResponse', () => {
  it('maps a ListOrdersResult to items[]/nextCursor/hasMore', () => {
    const row = makeOrderRow();
    const item = makeOrderItemRow({ order_id: row.id });
    const listResult: ListOrdersResult = {
      orders: [{ order: row, items: [item] }],
      hasMore: true,
      nextCursor: 'some-cursor',
    };

    const result = toOrderListResponse(listResult);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(row.id);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('some-cursor');
  });
});
