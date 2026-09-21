import { randomUUID } from 'crypto';

import { CreateOrderUseCase } from './create-order.use-case';
import { InventoryService } from '../allocation/inventory.service';
import { AllocateInventoryUseCase } from '../allocation/allocate-inventory.use-case';
import { StaticGeocodingProvider } from '../../infrastructure/geocoding/static-geocoding.provider';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { WarehouseSelectionRepository } from '../../infrastructure/database/repositories/warehouse-selection.repository';

/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Builds its own customer/product/warehouse fixtures (randomUUID-scoped),
 * not seed.ts. Exercises Phase 1 (reserve) only — Phase 2/3 land in
 * steps 10-11.
 */
describe('CreateOrderUseCase (integration) — Phase 1 (reserve)', () => {
  const useCase = new CreateOrderUseCase(
    AppDataSource,
    new AllocateInventoryUseCase(
      new WarehouseSelectionRepository(AppDataSource),
      new InventoryService(),
      AppDataSource,
    ),
    new StaticGeocodingProvider(),
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
  });
});
