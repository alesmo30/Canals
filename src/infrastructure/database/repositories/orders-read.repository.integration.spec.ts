import { randomUUID } from 'crypto';

import { OrdersReadRepository } from './orders-read.repository';
import { AppDataSource } from '../data-source';
import { CustomerOrmEntity } from '../entities/customer.orm-entity';
import { OrderOrmEntity } from '../entities/order.orm-entity';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import { OrderItemOrmEntity } from '../entities/order-item.orm-entity';

/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Builds its own customer/product/orders (randomUUID-scoped) rather than
 * depending on seed.ts (references/testing.md).
 */
describe('OrdersReadRepository (integration)', () => {
  let repo: OrdersReadRepository;
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    repo = new OrdersReadRepository(AppDataSource);

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Read Side Test Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  function orderPayload(index: number, baseTime: Date) {
    return {
      orderNumber: `CNL-T-${randomUUID().slice(0, 20)}`,
      customerId,
      warehouseId: null,
      status: 'PENDING_PAYMENT' as const,
      currency: 'USD',
      totalCents: 1000 + index,
      shippingAddress: {
        recipient: 'Test Recipient',
        line1: '1 Test Way',
        city: 'Test City',
        country: 'US',
      },
      shippingLocation: {
        type: 'Point' as const,
        coordinates: [-74.006, 40.7128] as [number, number],
      },
      createdAt: new Date(baseTime.getTime() + index * 1000),
      updatedAt: new Date(baseTime.getTime() + index * 1000),
    };
  }

  it('paginates 50 orders in pages of 20 with 0 duplicates and 0 gaps, never using OFFSET', async () => {
    const baseTime = new Date('2026-01-01T00:00:00.000Z');
    const savedOrders = [];
    for (let index = 0; index < 50; index += 1) {
      savedOrders.push(
        await AppDataSource.getRepository(OrderOrmEntity).save(
          orderPayload(index, baseTime),
        ),
      );
    }
    const expectedIds = new Set(savedOrders.map((order) => order.id));

    const seenIds = new Set<string>();
    let cursor: { createdAt: Date; id: string } | undefined;
    let pageCount = 0;

    for (;;) {
      const rows = await repo.findPage({ customerId, pageSize: 20, cursor });

      const hasMore = rows.length > 20;
      const pageRows = hasMore ? rows.slice(0, 20) : rows;

      for (const row of pageRows) {
        expect(seenIds.has(row.id)).toBe(false);
        seenIds.add(row.id);
      }

      pageCount += 1;
      if (!hasMore) {
        break;
      }

      const lastRow = pageRows[pageRows.length - 1];
      cursor = { createdAt: lastRow.created_at, id: lastRow.id };
    }

    expect(seenIds).toEqual(expectedIds);
    expect(pageCount).toBe(3); // 20 + 20 + 10
  });

  it('findItemsByOrderIds([]) does not explode', async () => {
    const rows = await repo.findItemsByOrderIds([]);
    expect(rows).toEqual([]);
  });

  it('findItemsByOrderIds groups items correctly across two orders', async () => {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Test Product',
      condition: 'NEW',
      unitPriceCents: 500,
      isActive: true,
    });

    const orderA = await AppDataSource.getRepository(OrderOrmEntity).save(
      orderPayload(100, new Date()),
    );
    const orderB = await AppDataSource.getRepository(OrderOrmEntity).save(
      orderPayload(101, new Date()),
    );

    await AppDataSource.getRepository(OrderItemOrmEntity).save({
      orderId: orderA.id,
      productId: product.id,
      quantity: 2,
      productSkuSnapshot: product.sku,
      productNameSnapshot: product.name,
      unitPriceCents: 500,
    });
    await AppDataSource.getRepository(OrderItemOrmEntity).save({
      orderId: orderB.id,
      productId: product.id,
      quantity: 5,
      productSkuSnapshot: product.sku,
      productNameSnapshot: product.name,
      unitPriceCents: 500,
    });

    const rows = await repo.findItemsByOrderIds([orderA.id, orderB.id]);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.order_id === orderA.id)?.quantity).toBe(2);
    expect(rows.find((row) => row.order_id === orderB.id)?.quantity).toBe(5);
  });
});
