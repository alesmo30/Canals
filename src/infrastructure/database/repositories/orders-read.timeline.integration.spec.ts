import { randomUUID } from 'crypto';
import { PgBoss } from 'pg-boss';

import { OrdersReadRepository } from './orders-read.repository';
import { setupQueues } from '../../messaging/queue-setup';
import { AppDataSource } from '../data-source';
import { CustomerOrmEntity } from '../entities/customer.orm-entity';
import { IdempotencyKeyOrmEntity } from '../entities/idempotency-key.orm-entity';
import { InventoryMovementOrmEntity } from '../entities/inventory-movement.orm-entity';
import { OrderOrmEntity } from '../entities/order.orm-entity';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import { WarehouseOrmEntity } from '../entities/warehouse.orm-entity';

/**
 * specs/08-observability-console.md, step 2 — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Own randomUUID-scoped fixtures, no seed.ts (references/testing.md).
 *
 * Jobs are sent with a far-future `startAfter` (and one to a DLQ, which
 * has no consumer) so a worker that happens to be running never picks
 * them up mid-test; they are deleted afterwards so the fan-out queues
 * don't accumulate probe rows.
 */
describe('OrdersReadRepository — timeline reads (integration)', () => {
  let repo: OrdersReadRepository;
  let boss: PgBoss;
  const sentJobs: { queue: string; id: string }[] = [];

  let orderId: string;
  let productSku: string;
  let warehouseName: string;
  const correlationId = `corr-${randomUUID()}`;

  beforeAll(async () => {
    await AppDataSource.initialize();
    repo = new OrdersReadRepository(AppDataSource);

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Timeline Test Customer',
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Timeline WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      location: { type: 'Point', coordinates: [-74.006, 40.7128] },
      isActive: true,
    });
    warehouseName = warehouse.name;
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Timeline Product',
      condition: 'NEW',
      unitPriceCents: 1500,
      isActive: true,
    });
    productSku = product.sku;

    const confirmedAt = new Date();
    const order = await AppDataSource.getRepository(OrderOrmEntity).save({
      orderNumber: `CNL-T-${randomUUID().slice(0, 20)}`,
      customerId: customer.id,
      warehouseId: warehouse.id,
      status: 'CONFIRMED',
      currency: 'USD',
      totalCents: 1500,
      shippingAddress: {
        recipient: 'Test Recipient',
        line1: '1 Test Way',
        city: 'Test City',
        country: 'US',
      },
      shippingLocation: { type: 'Point', coordinates: [-74.006, 40.7128] },
      confirmedAt,
    });
    orderId = order.id;

    const movements = AppDataSource.getRepository(InventoryMovementOrmEntity);
    const reservedAt = new Date(confirmedAt.getTime() - 2000);
    await movements.save({
      warehouseId: warehouse.id,
      productId: product.id,
      orderId,
      type: 'RESERVE',
      quantityDelta: -1,
      availableAfter: 9,
      reservedAfter: 1,
      reason: null,
      createdAt: reservedAt,
    });
    await movements.save({
      warehouseId: warehouse.id,
      productId: product.id,
      orderId,
      type: 'COMMIT',
      quantityDelta: -1,
      availableAfter: 9,
      reservedAfter: 0,
      reason: null,
      createdAt: confirmedAt,
    });

    await AppDataSource.getRepository(IdempotencyKeyOrmEntity).save({
      scope: 'POST /orders',
      idempotencyKey: randomUUID(),
      requestFingerprint: 'f'.repeat(64),
      state: 'COMPLETED',
      orderId,
      responseStatus: 402,
      responseBody: { status: 402, correlationId },
      createdAt: new Date(reservedAt.getTime() - 1000),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const body = {
      payload: { orderId, occurredAt: confirmedAt.toISOString() },
      meta: { correlationId, traceparent: null, publishedAt: '' },
    };
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    for (const queue of ['shipment.create', 'customer.notify.dlq']) {
      const id = await boss.send(queue, body, { startAfter: farFuture });
      if (id) {
        sentJobs.push({ queue, id });
      }
    }
  });

  afterAll(async () => {
    for (const { queue, id } of sentJobs) {
      await boss.deleteJob(queue, id);
    }
    await boss.stop();
    await AppDataSource.destroy();
  });

  it('findTimelineOrderById returns the lifecycle columns, and null for an unknown id', async () => {
    const row = await repo.findTimelineOrderById(orderId);
    expect(row?.status).toBe('CONFIRMED');
    expect(row?.confirmed_at).toBeInstanceOf(Date);
    expect(row?.cancelled_at).toBeNull();

    expect(await repo.findTimelineOrderById(randomUUID())).toBeNull();
  });

  it('findIdempotencyRecordByOrderId returns state, status and the error body correlationId', async () => {
    const row = await repo.findIdempotencyRecordByOrderId(orderId);
    expect(row).toMatchObject({
      state: 'COMPLETED',
      response_status: 402,
      correlation_id: correlationId,
    });

    expect(await repo.findIdempotencyRecordByOrderId(randomUUID())).toBeNull();
  });

  it('findInventoryMovementsByOrderId returns RESERVE then COMMIT with sku and warehouse name', async () => {
    const rows = await repo.findInventoryMovementsByOrderId(orderId);
    expect(rows.map((row) => row.type)).toEqual(['RESERVE', 'COMMIT']);
    expect(rows[0]).toMatchObject({
      product_sku: productSku,
      warehouse_name: warehouseName,
      available_after: 9,
      reserved_after: 1,
    });

    expect(await repo.findInventoryMovementsByOrderId(randomUUID())).toEqual(
      [],
    );
  });

  it('findJobsByOrderId returns fan-out and DLQ jobs with their correlationId, never the payload', async () => {
    const rows = await repo.findJobsByOrderId(orderId);
    expect(rows.map((row) => row.queue).sort()).toEqual([
      'customer.notify.dlq',
      'shipment.create',
    ]);
    for (const row of rows) {
      expect(row.correlation_id).toBe(correlationId);
      expect(row.state).toBe('created');
      expect(row).not.toHaveProperty('data');
    }

    expect(await repo.findJobsByOrderId(randomUUID())).toEqual([]);
  });
});
