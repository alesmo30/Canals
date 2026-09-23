import { randomUUID } from 'crypto';

import { OrdersReadRepository } from './orders-read.repository';
import { AppDataSource } from '../data-source';
import { CustomerOrmEntity } from '../entities/customer.orm-entity';
import { OrderItemOrmEntity } from '../entities/order-item.orm-entity';
import { OrderOrmEntity } from '../entities/order.orm-entity';
import { PaymentOrmEntity } from '../entities/payment.orm-entity';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import { ShipmentOrmEntity } from '../entities/shipment.orm-entity';
import { WarehouseOrmEntity } from '../entities/warehouse.orm-entity';

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
    let cursor: { createdAt: string; id: string } | undefined;
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
      cursor = { createdAt: lastRow.cursor_created_at, id: lastRow.id };
    }

    expect(seenIds).toEqual(expectedIds);
    expect(pageCount).toBe(3); // 20 + 20 + 10
  });

  it('does not skip rows when a page boundary splits a group sharing a sub-millisecond created_at', async () => {
    const tieCustomer = await AppDataSource.getRepository(
      CustomerOrmEntity,
    ).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Microsecond Tie Customer',
    });
    const savedOrders = [];
    for (let index = 0; index < 25; index += 1) {
      savedOrders.push(
        await AppDataSource.getRepository(OrderOrmEntity).save({
          ...orderPayload(index, new Date()),
          customerId: tieCustomer.id,
        }),
      );
    }
    const expectedIds = savedOrders.map((order) => order.id);
    // Same instant for all 25, like `now()` inside one transaction; a JS
    // Date can't hold the microseconds, so set it in SQL.
    await AppDataSource.query(
      `UPDATE orders SET created_at = '2026-09-23T05:42:05.132167Z' WHERE id = ANY($1::uuid[])`,
      [expectedIds],
    );

    const seenIds = new Set<string>();
    let cursor: { createdAt: string; id: string } | undefined;

    for (;;) {
      const rows = await repo.findPage({
        customerId: tieCustomer.id,
        pageSize: 5,
        cursor,
      });

      const hasMore = rows.length > 5;
      const pageRows = hasMore ? rows.slice(0, 5) : rows;
      for (const row of pageRows) {
        expect(seenIds.has(row.id)).toBe(false);
        seenIds.add(row.id);
      }

      if (!hasMore) {
        break;
      }
      const lastRow = pageRows[pageRows.length - 1];
      expect(lastRow.cursor_created_at).toBe('2026-09-23T05:42:05.132167Z');
      cursor = { createdAt: lastRow.cursor_created_at, id: lastRow.id };
    }

    expect(seenIds).toEqual(new Set(expectedIds));
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

  it('findOrderById returns the order with its warehouse name/distance, and findPaymentsByOrderId/findShipmentByOrderId return the seeded rows', async () => {
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Test WH ${randomUUID()}`,
      address: { line1: '1 Warehouse Rd', city: 'Newark', country: 'US' },
      location: { type: 'Point', coordinates: [-74.172363, 40.735657] },
      isActive: true,
    });

    const order = await AppDataSource.getRepository(OrderOrmEntity).save({
      ...orderPayload(200, new Date()),
      warehouseId: warehouse.id,
    });

    await AppDataSource.getRepository(PaymentOrmEntity).save({
      orderId: order.id,
      attempt: 1,
      provider: 'mock',
      providerPaymentId: null,
      idempotencyKey: `idem-${randomUUID()}`,
      status: 'DECLINED',
      amountCents: 1000,
      currency: 'USD',
      cardLast4: null,
      cardBrand: null,
      failureCode: 'CARD_DECLINED',
      rawResponse: null,
      settledAt: null,
    });
    await AppDataSource.getRepository(PaymentOrmEntity).save({
      orderId: order.id,
      attempt: 2,
      provider: 'mock',
      providerPaymentId: null,
      idempotencyKey: `idem-${randomUUID()}`,
      status: 'CAPTURED',
      amountCents: 1000,
      currency: 'USD',
      cardLast4: '4242',
      cardBrand: 'visa',
      failureCode: null,
      rawResponse: { ok: true },
      settledAt: new Date(),
    });

    await AppDataSource.getRepository(ShipmentOrmEntity).save({
      orderId: order.id,
      warehouseId: warehouse.id,
      status: 'PENDING_DISPATCH',
      carrier: null,
      trackingNumber: null,
      dispatchedAt: null,
      deliveredAt: null,
    });

    const detail = await repo.findOrderById(order.id);
    expect(detail).not.toBeNull();
    expect(detail?.warehouse_name).toBe(warehouse.name);
    expect(detail?.distance_meters).toBeGreaterThan(0);
    expect(detail?.shipping_address).toEqual(order.shippingAddress);

    const payments = await repo.findPaymentsByOrderId(order.id);
    expect(payments).toHaveLength(2);
    expect(payments.map((payment) => payment.attempt)).toEqual([1, 2]);
    expect(payments.map((payment) => payment.status)).toEqual([
      'DECLINED',
      'CAPTURED',
    ]);

    const shipment = await repo.findShipmentByOrderId(order.id);
    expect(shipment?.status).toBe('PENDING_DISPATCH');
  });

  it('findOrderById returns null for an id that does not exist (never throws)', async () => {
    const result = await repo.findOrderById(randomUUID());
    expect(result).toBeNull();
  });
});
