import { randomUUID } from 'crypto';

import { PgBoss } from 'pg-boss';

import { CreateOrderUseCase } from './create-order.use-case';
import { InventoryService } from '../allocation/inventory.service';
import { AllocateInventoryUseCase } from '../allocation/allocate-inventory.use-case';
import { StaticGeocodingProvider } from '../../infrastructure/geocoding/static-geocoding.provider';
import { setupQueues } from '../../infrastructure/messaging/queue-setup';
import { PgBossEventPublisher } from '../../infrastructure/messaging/pg-boss-event-publisher';
import { HttpPaymentGateway } from '../../infrastructure/payments/http-payment-gateway';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../../infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { WarehouseSelectionRepository } from '../../infrastructure/database/repositories/warehouse-selection.repository';

const DECLINED_CARD_NUMBER = '4000000000000002';

/**
 * Integration test — DATABASE_URL, PAYMENTS_URL (`payments-mock`
 * reachable, `docker compose up`) and OTEL_EXPORTER_OTLP_ENDPOINT
 * exported, a migrated Postgres reachable. Builds its own
 * customer/product/warehouse fixtures (randomUUID-scoped), not seed.ts.
 * Exercises all three phases: reserve, charge, settle.
 */
describe('CreateOrderUseCase (integration) — full saga', () => {
  let boss: PgBoss;
  let useCase: CreateOrderUseCase;
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);

    useCase = new CreateOrderUseCase(
      AppDataSource,
      new AllocateInventoryUseCase(
        new WarehouseSelectionRepository(AppDataSource),
        new InventoryService(),
        AppDataSource,
      ),
      new InventoryService(),
      new StaticGeocodingProvider(),
      new HttpPaymentGateway({ baseUrl: process.env.PAYMENTS_URL! }),
      new PgBossEventPublisher(boss),
    );

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Create Order Test Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await boss.stop();
    await AppDataSource.destroy();
  });

  async function makeFixture(unitPriceCents: number) {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Create Order Test Product',
      condition: 'NEW',
      unitPriceCents,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Create Order Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      // Near New York, same as the shipping address used below.
      location: { type: 'Point', coordinates: [-74.0, 40.72] },
      isActive: true,
    });
    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId: warehouse.id,
      productId: product.id,
      quantityAvailable: 5,
      quantityReserved: 0,
    });
    return { product, warehouse };
  }

  async function jobsForOrder(orderId: string): Promise<string[]> {
    const rows: { name: string }[] = await AppDataSource.query(
      `select name from pgboss.job where data->'payload'->>'orderId' = $1`,
      [orderId],
    );
    return rows.map((row) => row.name);
  }

  it('CAPTURED: reserves, charges, settles to CONFIRMED, commits stock and enqueues order.confirmed', async () => {
    const { product, warehouse } = await makeFixture(1500);

    const result = await useCase.execute({
      customerId,
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Broadway',
        city: 'New York',
        state: 'NY',
        country: 'US',
      },
      lines: [{ productId: product.id, quantity: 2 }],
      cardNumber: '4242424242424242',
      idempotencyKey: randomUUID(),
    });

    // Phase 1
    expect(result.allocation.warehouseId).toBe(warehouse.id);
    expect(result.allocation.name).toBe(warehouse.name);
    expect(typeof result.allocation.distanceMeters).toBe('number');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].getProductSkuSnapshot()).toBe(product.sku);

    const persistedItems = await AppDataSource.getRepository(
      OrderItemOrmEntity,
    ).find({ where: { orderId: result.order.getId() } });
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0].unitPriceCents).toBe(1500);

    // Phase 2
    expect(result.chargeResult.status).toBe('CAPTURED');
    expect(result.payment.idempotencyKey).toBe(
      `order:${result.order.getId()}:attempt:1`,
    );

    // Phase 3
    expect(result.order.getStatus()).toBe('CONFIRMED');

    const persistedOrder = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: result.order.getId() });
    expect(persistedOrder.status).toBe('CONFIRMED');
    expect(persistedOrder.confirmedAt).not.toBeNull();

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId: warehouse.id, productId: product.id });
    // Committed, not released: quantity_available stays at 5 - 2 = 3
    // (reserve() already moved it out of the available pool).
    expect(inventory.quantityAvailable).toBe(3);
    expect(inventory.quantityReserved).toBe(0);

    // PgBossEventPublisher fans `order.confirmed` out into its three
    // routed queues (event-routing.ts) — there is no job literally named
    // `order.confirmed`.
    const jobs = await jobsForOrder(result.order.getId());
    expect(jobs.sort()).toEqual(
      ['analytics.record', 'customer.notify', 'shipment.create'].sort(),
    );
  });

  it('DECLINED: releases stock back to quantity_available, marks PAYMENT_FAILED, and throws PaymentDeclinedError', async () => {
    const { product, warehouse } = await makeFixture(2000);

    const promise = useCase.execute({
      customerId,
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Broadway',
        city: 'New York',
        state: 'NY',
        country: 'US',
      },
      lines: [{ productId: product.id, quantity: 1 }],
      cardNumber: DECLINED_CARD_NUMBER,
      idempotencyKey: randomUUID(),
    });

    await expect(promise).rejects.toMatchObject({
      name: 'PaymentDeclinedError',
    });

    const orders = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { warehouseId: warehouse.id },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('PAYMENT_FAILED');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId: warehouse.id, productId: product.id });
    expect(inventory.quantityAvailable).toBe(5); // released back
    expect(inventory.quantityReserved).toBe(0);

    const persistedPayment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ orderId: orders[0].id });
    expect(persistedPayment.status).toBe('DECLINED');
  });
});
