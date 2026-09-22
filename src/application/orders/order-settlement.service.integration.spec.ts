import { randomUUID } from 'crypto';

import { PgBoss } from 'pg-boss';

import { OrderSettlementService } from './order-settlement.service';
import { InventoryService } from '../allocation/inventory.service';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../../infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { setupQueues } from '../../infrastructure/messaging/queue-setup';
import { PgBossEventPublisher } from '../../infrastructure/messaging/pg-boss-event-publisher';

/**
 * specs/07-hardening-demo.md, step 6 — integration test: DATABASE_URL,
 * PAYMENTS_URL and OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated
 * Postgres reachable. Builds `orders`/`order_items`/`inventory` fixtures
 * directly (randomUUID-scoped) — this service never creates an order
 * itself, only settles one that already exists at `PENDING_PAYMENT`.
 */
describe('OrderSettlementService (integration)', () => {
  let boss: PgBoss;
  let service: OrderSettlementService;
  let inventoryService: InventoryService;

  beforeAll(async () => {
    await AppDataSource.initialize();

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);

    inventoryService = new InventoryService();
    service = new OrderSettlementService(
      AppDataSource,
      inventoryService,
      new PgBossEventPublisher(boss),
    );
  });

  afterAll(async () => {
    await boss.stop();
    await AppDataSource.destroy();
  });

  /** A PENDING_PAYMENT order, reserved (not yet settled) — the state every method above expects to find. */
  async function makePendingOrder(quantityAvailable = 5, quantity = 2) {
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Settlement Test Customer',
    });
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Settlement Test Product',
      condition: 'NEW',
      unitPriceCents: 1000,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Settlement Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      location: { type: 'Point', coordinates: [-74.0, 40.72] },
      isActive: true,
    });
    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId: warehouse.id,
      productId: product.id,
      quantityAvailable,
      quantityReserved: 0,
    });

    const orderId = randomUUID();
    await AppDataSource.getRepository(OrderOrmEntity).save({
      id: orderId,
      orderNumber: `CNL-TEST-${randomUUID().slice(0, 8)}`,
      customerId: customer.id,
      warehouseId: warehouse.id,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      totalCents: 1000 * quantity,
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Broadway',
        city: 'New York',
        country: 'US',
      },
      shippingLocation: { type: 'Point', coordinates: [-74.0, 40.72] },
      reservationExpiresAt: null,
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await AppDataSource.getRepository(OrderItemOrmEntity).save({
      id: randomUUID(),
      orderId,
      productId: product.id,
      quantity,
      productSkuSnapshot: product.sku,
      productNameSnapshot: product.name,
      unitPriceCents: 1000,
    });

    await AppDataSource.transaction((manager) =>
      inventoryService.reserve(manager, {
        orderId,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, quantity }],
      }),
    );

    return { orderId, warehouseId: warehouse.id, productId: product.id };
  }

  async function makePayment(orderId: string): Promise<string> {
    const paymentId = randomUUID();
    await AppDataSource.getRepository(PaymentOrmEntity).save({
      id: paymentId,
      orderId,
      attempt: 1,
      provider: 'mock-gateway',
      providerPaymentId: null,
      idempotencyKey: `order:${orderId}:attempt:1`,
      status: 'PENDING',
      amountCents: 2000,
      currency: 'USD',
      cardLast4: null,
      cardBrand: null,
      failureCode: null,
      rawResponse: null,
      settledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return paymentId;
  }

  async function jobsForOrder(orderId: string): Promise<string[]> {
    const rows: { name: string }[] = await AppDataSource.query(
      `select name from pgboss.job where data->'payload'->>'orderId' = $1`,
      [orderId],
    );
    return rows.map((row) => row.name);
  }

  async function movementCount(orderId: string): Promise<number> {
    const rows: { count: string }[] = await AppDataSource.query(
      `SELECT count(*) FROM inventory_movements WHERE order_id = $1`,
      [orderId],
    );
    return Number(rows[0].count);
  }

  it('confirmCaptured: PENDING_PAYMENT -> CONFIRMED, commits inventory, updates the given payment row, publishes order.confirmed', async () => {
    const { orderId, warehouseId, productId } = await makePendingOrder();
    const paymentId = await makePayment(orderId);
    const movementsBefore = await movementCount(orderId);

    const result = await service.confirmCaptured({
      orderId,
      payment: {
        paymentId,
        chargeResult: {
          status: 'CAPTURED',
          providerPaymentId: 'ch_test',
          cardLast4: '4242',
          cardBrand: 'visa',
          failureCode: null,
          rawResponse: { status: 'approved' },
        },
      },
    });

    expect(result.outcome).toBe('SETTLED');
    expect(result.order.getStatus()).toBe('CONFIRMED');

    const persisted = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(persisted.status).toBe('CONFIRMED');
    expect(persisted.confirmedAt).not.toBeNull();

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityReserved).toBe(0);

    const payment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ id: paymentId });
    expect(payment.status).toBe('CAPTURED');
    expect(payment.settledAt).not.toBeNull();

    const jobs = await jobsForOrder(orderId);
    expect(jobs.sort()).toEqual(
      ['analytics.record', 'customer.notify', 'shipment.create'].sort(),
    );

    // Exactly one movement was written for the commit.
    expect(await movementCount(orderId)).toBe(movementsBefore + 1);
  });

  it('failDeclined: PENDING_PAYMENT -> PAYMENT_FAILED, releases inventory', async () => {
    const { orderId, warehouseId, productId } = await makePendingOrder();

    const result = await service.failDeclined({ orderId });

    expect(result.outcome).toBe('SETTLED');
    expect(result.order.getStatus()).toBe('PAYMENT_FAILED');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
    expect(inventory.quantityReserved).toBe(0);
  });

  it('cancelUnpaid: PENDING_PAYMENT -> CANCELLED(reason), releases inventory', async () => {
    const { orderId, warehouseId, productId } = await makePendingOrder();

    const result = await service.cancelUnpaid({
      orderId,
      reason: 'RESERVATION_EXPIRED_NO_PAYMENT',
    });

    expect(result.outcome).toBe('SETTLED');
    expect(result.order.getStatus()).toBe('CANCELLED');
    expect(result.order.getCancellationReason()).toBe(
      'RESERVATION_EXPIRED_NO_PAYMENT',
    );

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
    expect(inventory.quantityReserved).toBe(0);
  });

  it('ALREADY_SETTLED: any method on an order already settled changes nothing — no new movement, no job', async () => {
    const { orderId } = await makePendingOrder();
    await service.cancelUnpaid({
      orderId,
      reason: 'RESERVATION_EXPIRED_NO_PAYMENT',
    });
    const movementsAfterCancel = await movementCount(orderId);

    const result = await service.confirmCaptured({ orderId });

    expect(result.outcome).toBe('ALREADY_SETTLED');
    expect(result.order.getStatus()).toBe('CANCELLED');
    expect(await movementCount(orderId)).toBe(movementsAfterCancel);
    expect(await jobsForOrder(orderId)).toHaveLength(0);
  });

  it('two settlers racing on the same order: exactly one wins', async () => {
    const { orderId } = await makePendingOrder();
    const movementsBefore = await movementCount(orderId);

    const [first, second] = await Promise.all([
      service.confirmCaptured({ orderId }),
      service.cancelUnpaid({
        orderId,
        reason: 'RESERVATION_EXPIRED_NO_PAYMENT',
      }),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['ALREADY_SETTLED', 'SETTLED']);

    const persisted = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(['CONFIRMED', 'CANCELLED']).toContain(persisted.status);

    // Exactly one settlement's worth of inventory movement, whichever won.
    expect(await movementCount(orderId)).toBe(movementsBefore + 1);
  });
});
