import { randomUUID } from 'crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { ApiModule } from '../src/modules/api.module';
import type { OrderDetailResponse } from '../src/infrastructure/http/dto/order-detail.response.dto';
import type { OrderListResponse } from '../src/infrastructure/http/dto/order-list.response.dto';
import type { ProblemDetails } from '../src/infrastructure/http/filters/problem-details.filter';
import { AppDataSource } from '../src/infrastructure/database/data-source';
import { CustomerOrmEntity } from '../src/infrastructure/database/entities/customer.orm-entity';
import { OrderItemOrmEntity } from '../src/infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../src/infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../src/infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../src/infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../src/infrastructure/database/entities/warehouse.orm-entity';
import type { OrderStatus } from '../src/domain/enum-types/order-status';

function asOrderList(body: unknown): OrderListResponse {
  return body as OrderListResponse;
}
function asOrderDetail(body: unknown): OrderDetailResponse {
  return body as OrderDetailResponse;
}
function asProblem(body: unknown): ProblemDetails {
  return body as ProblemDetails;
}

/**
 * Acceptance coverage over real HTTP; the EXPLAIN check lives in
 * `orders-read.explain.integration.spec.ts`. Query spies target the app's
 * own DataSource (`app.get(DataSource)`), not `AppDataSource`.
 */
describe('GET /orders, GET /orders/:id (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    dataSource = app.get(DataSource);

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Orders Read E2E Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await app.close();
    await AppDataSource.destroy();
  });

  async function makeOrder(
    overrides: Partial<{
      createdAt: Date;
      status: OrderStatus;
      warehouseId: string | null;
      customerId: string;
    }> = {},
  ): Promise<OrderOrmEntity> {
    const createdAt = overrides.createdAt ?? new Date();
    return AppDataSource.getRepository(OrderOrmEntity).save({
      orderNumber: `CNL-T-${randomUUID().slice(0, 20)}`,
      customerId: overrides.customerId ?? customerId,
      warehouseId: overrides.warehouseId ?? null,
      status: overrides.status ?? 'PENDING_PAYMENT',
      currency: 'USD',
      totalCents: 1000,
      shippingAddress: {
        recipient: 'Test Recipient',
        line1: '1 Test Way',
        city: 'Test City',
        country: 'US',
      },
      shippingLocation: { type: 'Point', coordinates: [-74.006, 40.7128] },
      createdAt,
      updatedAt: createdAt,
    });
  }

  it('1/2/3: paginates 50 seeded orders with 0 duplicates/gaps, a mid-pagination insert does not shift or duplicate later pages, and no query ever uses OFFSET', async () => {
    const baseTime = new Date('2026-02-01T00:00:00.000Z');
    const seededIds: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      const order = await makeOrder({
        createdAt: new Date(baseTime.getTime() + index * 1000),
      });
      seededIds.push(order.id);
    }
    const expectedIds = new Set(seededIds);

    const querySpy = jest.spyOn(dataSource, 'query');

    const seenIds = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    let insertedMidPagination = false;

    for (;;) {
      const qs = new URLSearchParams({ customerId, pageSize: '20' });
      if (cursor) {
        qs.set('cursor', cursor);
      }

      const res = await request(app.getHttpServer())
        .get(`/orders?${qs.toString()}`)
        .expect(200);
      const body = asOrderList(res.body);

      for (const item of body.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }

      pageCount += 1;

      // Insert a newer order between pages: it must not leak into an
      // in-flight cursor walk.
      if (pageCount === 1 && !insertedMidPagination) {
        await makeOrder({
          createdAt: new Date(baseTime.getTime() + 1_000_000),
        });
        insertedMidPagination = true;
      }

      if (!body.hasMore) {
        break;
      }
      cursor = body.nextCursor ?? undefined;
    }

    expect(seenIds).toEqual(expectedIds);
    expect(pageCount).toBe(3); // 20 + 20 + 10

    const usedOffset = querySpy.mock.calls.some(
      ([sql]) => typeof sql === 'string' && /\bOFFSET\b/i.test(sql),
    );
    expect(usedOffset).toBe(false);

    querySpy.mockRestore();
  });

  describe('5: filters, alone and combined', () => {
    it('customerId alone', async () => {
      const otherCustomer = await AppDataSource.getRepository(
        CustomerOrmEntity,
      ).save({
        email: `${randomUUID()}@example.com`,
        fullName: 'Other Customer',
      });
      const mine = await makeOrder();
      const other = await AppDataSource.getRepository(OrderOrmEntity).save({
        orderNumber: `CNL-T-${randomUUID().slice(0, 20)}`,
        customerId: otherCustomer.id,
        warehouseId: null,
        status: 'PENDING_PAYMENT',
        currency: 'USD',
        totalCents: 1000,
        shippingAddress: {
          recipient: 'Other',
          line1: '1 Test Way',
          city: 'Test City',
          country: 'US',
        },
        shippingLocation: { type: 'Point', coordinates: [-74.006, 40.7128] },
      });

      const res = await request(app.getHttpServer())
        .get(`/orders?customerId=${customerId}&pageSize=100`)
        .expect(200);
      const body = asOrderList(res.body);

      expect(body.items.every((item) => item.customerId === customerId)).toBe(
        true,
      );
      expect(body.items.some((item) => item.id === mine.id)).toBe(true);
      expect(body.items.some((item) => item.id === other.id)).toBe(false);
    });

    it('status alone', async () => {
      const paid = await makeOrder({ status: 'PAID' });
      const pending = await makeOrder({ status: 'PENDING_PAYMENT' });

      const res = await request(app.getHttpServer())
        .get(`/orders?customerId=${customerId}&status=PAID&pageSize=100`)
        .expect(200);
      const body = asOrderList(res.body);

      expect(body.items.every((item) => item.status === 'PAID')).toBe(true);
      expect(body.items.some((item) => item.id === paid.id)).toBe(true);
      expect(body.items.some((item) => item.id === pending.id)).toBe(false);
    });

    it('warehouseId alone', async () => {
      const warehouse = await AppDataSource.getRepository(
        WarehouseOrmEntity,
      ).save({
        name: `Filter WH ${randomUUID()}`,
        address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
        location: { type: 'Point', coordinates: [-74.006, 40.7128] },
        isActive: true,
      });
      const withWarehouse = await makeOrder({ warehouseId: warehouse.id });
      const withoutWarehouse = await makeOrder();

      const res = await request(app.getHttpServer())
        .get(
          `/orders?customerId=${customerId}&warehouseId=${warehouse.id}&pageSize=100`,
        )
        .expect(200);
      const body = asOrderList(res.body);

      expect(
        body.items.every((item) => item.warehouseId === warehouse.id),
      ).toBe(true);
      expect(body.items.some((item) => item.id === withWarehouse.id)).toBe(
        true,
      );
      expect(body.items.some((item) => item.id === withoutWarehouse.id)).toBe(
        false,
      );
    });

    it('createdAtFrom/createdAtTo alone', async () => {
      const early = await makeOrder({
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      const inRange = await makeOrder({
        createdAt: new Date('2027-06-01T00:00:00.000Z'),
      });
      const late = await makeOrder({
        createdAt: new Date('2032-01-01T00:00:00.000Z'),
      });

      const res = await request(app.getHttpServer())
        .get(
          `/orders?customerId=${customerId}&createdAtFrom=2025-01-01T00:00:00.000Z&createdAtTo=2028-01-01T00:00:00.000Z&pageSize=100`,
        )
        .expect(200);
      const body = asOrderList(res.body);

      expect(body.items.some((item) => item.id === inRange.id)).toBe(true);
      expect(body.items.some((item) => item.id === early.id)).toBe(false);
      expect(body.items.some((item) => item.id === late.id)).toBe(false);
    });

    it('combined: status + warehouseId + createdAtFrom together', async () => {
      const warehouse = await AppDataSource.getRepository(
        WarehouseOrmEntity,
      ).save({
        name: `Combined WH ${randomUUID()}`,
        address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
        location: { type: 'Point', coordinates: [-74.006, 40.7128] },
        isActive: true,
      });
      const matching = await makeOrder({
        status: 'CONFIRMED',
        warehouseId: warehouse.id,
        createdAt: new Date('2028-06-01T00:00:00.000Z'),
      });
      const wrongStatus = await makeOrder({
        status: 'PENDING_PAYMENT',
        warehouseId: warehouse.id,
        createdAt: new Date('2028-06-01T00:00:00.000Z'),
      });
      const wrongWarehouse = await makeOrder({
        status: 'CONFIRMED',
        createdAt: new Date('2028-06-01T00:00:00.000Z'),
      });

      const qs = new URLSearchParams({
        customerId,
        status: 'CONFIRMED',
        warehouseId: warehouse.id,
        createdAtFrom: '2027-01-01T00:00:00.000Z',
        pageSize: '100',
      });
      const res = await request(app.getHttpServer())
        .get(`/orders?${qs.toString()}`)
        .expect(200);
      const body = asOrderList(res.body);

      expect(body.items.some((item) => item.id === matching.id)).toBe(true);
      expect(body.items.some((item) => item.id === wrongStatus.id)).toBe(false);
      expect(body.items.some((item) => item.id === wrongWarehouse.id)).toBe(
        false,
      );
    });
  });

  it('6: a page of 20 orders with items emits a bounded number of queries, not 21', async () => {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Query Count Test Product',
      condition: 'NEW',
      unitPriceCents: 500,
      isActive: true,
    });

    for (let index = 0; index < 20; index += 1) {
      const order = await makeOrder({
        createdAt: new Date(Date.now() + index * 1000),
      });
      await AppDataSource.getRepository(OrderItemOrmEntity).save({
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        productSkuSnapshot: product.sku,
        productNameSnapshot: product.name,
        unitPriceCents: 500,
      });
    }

    const querySpy = jest.spyOn(dataSource, 'query');
    querySpy.mockClear();

    const res = await request(app.getHttpServer())
      .get(`/orders?customerId=${customerId}&pageSize=20`)
      .expect(200);

    const queryCount = querySpy.mock.calls.length;
    querySpy.mockRestore();

    const body = asOrderList(res.body);
    expect(body.items.length).toBeGreaterThan(0);
    // findPage + findItemsByOrderIds — a small constant, never one query
    // per order (which a page of 20 would make 21: 1 + 20).
    expect(queryCount).toBeLessThanOrEqual(5);
  });

  it('7: no card data or raw_response is reachable from either GET /orders or GET /orders/:id', async () => {
    // Own customer, not the describe-level `customerId` shared with every
    // other test: the list assertion below scans for the literal "4242"
    // across ALL of that customer's orders, and by this point in the suite
    // there are dozens with random UUIDs — one occasionally contains "4242"
    // by chance, failing the test for a reason that has nothing to do with
    // card-data leakage. Isolating the customer keeps the list to just this
    // order.
    const isolatedCustomer = await AppDataSource.getRepository(
      CustomerOrmEntity,
    ).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Orders Read E2E Customer (isolated)',
    });
    const order = await makeOrder({ customerId: isolatedCustomer.id });
    await AppDataSource.getRepository(PaymentOrmEntity).save({
      orderId: order.id,
      attempt: 1,
      provider: 'mock',
      providerPaymentId: 'prov_secret_123',
      idempotencyKey: `idem-${randomUUID()}`,
      status: 'CAPTURED',
      amountCents: 1000,
      currency: 'USD',
      cardLast4: '4242',
      cardBrand: 'visa',
      failureCode: null,
      rawResponse: { secret: 'do-not-leak' },
      settledAt: new Date(),
    });

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .expect(200);
    const listRes = await request(app.getHttpServer())
      .get(`/orders?customerId=${isolatedCustomer.id}&pageSize=100`)
      .expect(200);

    asOrderDetail(detailRes.body);
    asOrderList(listRes.body);
    const combined =
      JSON.stringify(detailRes.body) + JSON.stringify(listRes.body);

    const forbidden = [
      '4242',
      'visa',
      'prov_secret_123',
      'do-not-leak',
      'card_last4',
      'card_brand',
      'raw_response',
      'provider_payment_id',
      'idempotency_key',
      'cardLast4',
      'cardBrand',
      'rawResponse',
      'providerPaymentId',
      'idempotencyKey',
    ];
    for (const value of forbidden) {
      expect(combined).not.toContain(value);
    }
  });

  it('8: an unknown query param returns 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders?bogus=1')
      .expect(400);

    expect(asProblem(res.body).status).toBe(400);
  });
});
