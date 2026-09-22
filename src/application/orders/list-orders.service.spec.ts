import { randomUUID } from 'crypto';

import { BadRequestException } from '@nestjs/common';

import { encodeCursor } from './helpers/cursor.helpers';
import { ListOrdersService } from './list-orders.service';
import type {
  OrderItemRow,
  OrderRow,
  OrdersReadRepository,
} from '../../infrastructure/database/repositories/orders-read.repository';

function makeOrderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: randomUUID(),
    order_number: 'CNL-2026-000001',
    customer_id: randomUUID(),
    warehouse_id: null,
    status: 'PENDING_PAYMENT',
    currency: 'USD',
    total_cents: '1000',
    created_at: new Date(),
    ...overrides,
  };
}

function makeFakeRepository(rows: OrderRow[], items: OrderItemRow[] = []) {
  const findPage = jest.fn().mockResolvedValue(rows);
  const findItemsByOrderIds = jest.fn().mockResolvedValue(items);
  const repository = {
    findPage,
    findItemsByOrderIds,
  } as unknown as OrdersReadRepository;

  return { repository, findPage };
}

describe('ListOrdersService', () => {
  it('a page of 3 rows with pageSize=2 returns 2 orders, hasMore=true, nextCursor from the 2nd row', async () => {
    const rows = [makeOrderRow(), makeOrderRow(), makeOrderRow()];
    const { repository } = makeFakeRepository(rows);
    const service = new ListOrdersService(repository);

    const result = await service.execute({ pageSize: 2 });

    expect(result.orders).toHaveLength(2);
    expect(result.orders.map((o) => o.order.id)).toEqual([
      rows[0].id,
      rows[1].id,
    ]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(
      encodeCursor({ createdAt: rows[1].created_at, id: rows[1].id }),
    );
  });

  it('a page with exactly pageSize rows has hasMore=false and nextCursor=null', async () => {
    const rows = [makeOrderRow(), makeOrderRow()];
    const { repository } = makeFakeRepository(rows);
    const service = new ListOrdersService(repository);

    const result = await service.execute({ pageSize: 2 });

    expect(result.orders).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('groups items by order_id', async () => {
    const [orderA, orderB] = [makeOrderRow(), makeOrderRow()];
    const itemA: OrderItemRow = {
      order_id: orderA.id,
      product_id: randomUUID(),
      quantity: 1,
      product_sku_snapshot: 'SKU-A',
      product_name_snapshot: 'Product A',
      unit_price_cents: '500',
      created_at: new Date(),
    };
    const itemB: OrderItemRow = {
      order_id: orderB.id,
      product_id: randomUUID(),
      quantity: 2,
      product_sku_snapshot: 'SKU-B',
      product_name_snapshot: 'Product B',
      unit_price_cents: '700',
      created_at: new Date(),
    };
    const { repository } = makeFakeRepository([orderA, orderB], [itemA, itemB]);
    const service = new ListOrdersService(repository);

    const result = await service.execute({ pageSize: 20 });

    expect(result.orders.find((o) => o.order.id === orderA.id)?.items).toEqual([
      itemA,
    ]);
    expect(result.orders.find((o) => o.order.id === orderB.id)?.items).toEqual([
      itemB,
    ]);
  });

  it('defaults pageSize to 20 when not given', async () => {
    const rows = [makeOrderRow()];
    const { repository, findPage } = makeFakeRepository(rows);
    const service = new ListOrdersService(repository);

    await service.execute({});

    expect(findPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 20 }),
    );
  });

  it('rejects a malformed cursor with BadRequestException, same bucket as an invalid query param', async () => {
    const { repository } = makeFakeRepository([]);
    const service = new ListOrdersService(repository);
    const malformedCursor = Buffer.from('a|b|c').toString('base64');

    await expect(service.execute({ cursor: malformedCursor })).rejects.toThrow(
      BadRequestException,
    );
  });
});
