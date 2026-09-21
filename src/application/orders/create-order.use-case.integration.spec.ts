import { randomUUID } from 'crypto';

import { CreateOrderUseCase } from './create-order.use-case';
import { InventoryService } from '../allocation/inventory.service';
import { AllocateInventoryUseCase } from '../allocation/allocate-inventory.use-case';
import { StaticGeocodingProvider } from '../../infrastructure/geocoding/static-geocoding.provider';
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
 * Exercises Phase 1 (reserve) + Phase 2 (charge) — Phase 3 lands in
 * step 11.
 */
describe('CreateOrderUseCase (integration) — Phase 1 (reserve) + Phase 2 (charge)', () => {
  const useCase = new CreateOrderUseCase(
    AppDataSource,
    new AllocateInventoryUseCase(
      new WarehouseSelectionRepository(AppDataSource),
      new InventoryService(),
      AppDataSource,
    ),
    new StaticGeocodingProvider(),
    new HttpPaymentGateway({ baseUrl: process.env.PAYMENTS_URL! }),
  );
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Create Order Test Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('reserves stock, inserts orders (PENDING_PAYMENT) with order_items snapshots, and returns the winning warehouse', async () => {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Create Order Test Product',
      condition: 'NEW',
      unitPriceCents: 1500,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Create Order Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      // Near New York, same as the shipping address below.
      location: { type: 'Point', coordinates: [-74.0, 40.72] },
      isActive: true,
    });
    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId: warehouse.id,
      productId: product.id,
      quantityAvailable: 5,
      quantityReserved: 0,
    });

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

    expect(result.order.getStatus()).toBe('PENDING_PAYMENT');
    expect(result.allocation.warehouseId).toBe(warehouse.id);
    expect(result.allocation.name).toBe(warehouse.name);
    expect(typeof result.allocation.distanceMeters).toBe('number');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].getProductSkuSnapshot()).toBe(product.sku);

    const persistedOrder = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: result.order.getId() });
    expect(persistedOrder.status).toBe('PENDING_PAYMENT');
    expect(persistedOrder.warehouseId).toBe(warehouse.id);
    expect(persistedOrder.totalCents).toBe(3000); // 1500 * 2

    const persistedItems = await AppDataSource.getRepository(
      OrderItemOrmEntity,
    ).find({ where: { orderId: result.order.getId() } });
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0].quantity).toBe(2);
    expect(persistedItems[0].productSkuSnapshot).toBe(product.sku);
    expect(persistedItems[0].unitPriceCents).toBe(1500);

    expect(result.chargeResult.status).toBe('CAPTURED');
    expect(result.payment.status).toBe('CAPTURED');
    expect(result.payment.idempotencyKey).toBe(
      `order:${result.order.getId()}:attempt:1`,
    );
    expect(result.payment.amountCents).toBe(3000);

    const persistedPayment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ orderId: result.order.getId() });
    expect(persistedPayment.status).toBe('CAPTURED');
  });

  it('persists a DECLINED payment for card ...0002, without touching the order status (Phase 3 does that)', async () => {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Create Order Test Product (declined)',
      condition: 'NEW',
      unitPriceCents: 2000,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Create Order Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      location: { type: 'Point', coordinates: [-74.0, 40.72] },
      isActive: true,
    });
    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId: warehouse.id,
      productId: product.id,
      quantityAvailable: 5,
      quantityReserved: 0,
    });

    const result = await useCase.execute({
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

    expect(result.chargeResult.status).toBe('DECLINED');

    const persistedPayment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ orderId: result.order.getId() });
    expect(persistedPayment.status).toBe('DECLINED');

    // Phase 3 (step 11) owns the order/inventory branch on this outcome —
    // untouched here.
    const persistedOrder = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: result.order.getId() });
    expect(persistedOrder.status).toBe('PENDING_PAYMENT');
  });
});
