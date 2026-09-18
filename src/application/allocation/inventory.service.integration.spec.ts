import { randomUUID } from 'crypto';

import { InventoryService } from './inventory.service';
import { InsufficientStockError } from './errors';
import { Order } from '../../domain/entities/order';
import { Coordinates } from '../../domain/value-objects/coordinates';
import { Money } from '../../domain/value-objects/money';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { orderToPersistence } from '../../infrastructure/database/mappers/order.mapper';

/**
 * Integration test — same prerequisites as
 * warehouse-selection.repository.integration.spec.ts: DATABASE_URL (+
 * PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated
 * Postgres reachable. Builds its own customer/product/warehouse/order
 * fixtures (randomUUID-scoped), not seed.ts — the CI integration job
 * does not run the seed.
 */
describe('InventoryService (integration)', () => {
  const service = new InventoryService();
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Test Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  async function makeOrder(): Promise<string> {
    const order = new Order({
      id: randomUUID(),
      orderNumber: `CNL-TEST-${Math.floor(Math.random() * 1_000_000)}`,
      customerId,
      warehouseId: null,
      status: 'PENDING_PAYMENT',
      total: Money.of(1000, 'USD'),
      shippingAddress: ShippingAddress.of({
        recipient: 'Test Recipient',
        line1: '1 Test Way',
        city: 'Test City',
        country: 'US',
      }),
      shippingLocation: Coordinates.of({
        latitude: 40.7128,
        longitude: -74.006,
      }),
      reservationExpiresAt: null,
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const saved = await AppDataSource.getRepository(OrderOrmEntity).save(
      orderToPersistence(order),
    );
    return saved.id;
  }

  async function makeProduct(): Promise<string> {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Test iPad Pro',
      condition: 'NEW',
      unitPriceCents: 99900,
      isActive: true,
    });
    return product.id;
  }

  async function makeWarehouse(): Promise<string> {
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      location: { type: 'Point', coordinates: [-74.006, 40.7128] },
      isActive: true,
    });
    return warehouse.id;
  }

  async function setStock(
    warehouseId: string,
    productId: string,
    quantityAvailable: number,
  ): Promise<void> {
    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId,
      productId,
      quantityAvailable,
      quantityReserved: 0,
    });
  }

  async function countMovements(
    warehouseId: string,
    productId: string,
    type: string,
  ): Promise<number> {
    const rows = await AppDataSource.query<{ count: string }[]>(
      `SELECT count(*) FROM inventory_movements
       WHERE warehouse_id = $1 AND product_id = $2 AND type = $3`,
      [warehouseId, productId, type],
    );
    return Number(rows[0].count);
  }

  describe('reserve', () => {
    it('moves balances, writes RESERVE movements with the resulting balances, and stamps the order', async () => {
      const orderId = await makeOrder();
      const productId = await makeProduct();
      const warehouseId = await makeWarehouse();
      await setStock(warehouseId, productId, 5);

      await AppDataSource.transaction(async (manager) => {
        await service.reserve(manager, {
          orderId,
          warehouseId,
          lines: [{ productId, quantity: 3 }],
        });
      });

      const inventory = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });
      expect(inventory.quantityAvailable).toBe(2);
      expect(inventory.quantityReserved).toBe(3);

      const movements = await AppDataSource.query<
        {
          type: string;
          quantity_delta: number;
          available_after: number;
          reserved_after: number;
          order_id: string;
        }[]
      >(
        `SELECT type, quantity_delta, available_after, reserved_after, order_id
         FROM inventory_movements
         WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId],
      );
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'RESERVE',
        quantity_delta: -3,
        available_after: 2,
        reserved_after: 3,
        order_id: orderId,
      });

      const order = await AppDataSource.getRepository(
        OrderOrmEntity,
      ).findOneByOrFail({ id: orderId });
      expect(order.warehouseId).toBe(warehouseId);
      expect(order.reservationExpiresAt).not.toBeNull();
      const minutesOut =
        (order.reservationExpiresAt!.getTime() - Date.now()) / 60_000;
      expect(minutesOut).toBeGreaterThan(14.5);
      expect(minutesOut).toBeLessThan(15.5);
    });

    it('raises InsufficientStockError and leaves every balance untouched when the request exceeds what the lock reveals', async () => {
      const orderId = await makeOrder();
      const productId = await makeProduct();
      const warehouseId = await makeWarehouse();
      await setStock(warehouseId, productId, 2);

      await expect(
        AppDataSource.transaction(async (manager) => {
          await service.reserve(manager, {
            orderId,
            warehouseId,
            lines: [{ productId, quantity: 3 }],
          });
        }),
      ).rejects.toBeInstanceOf(InsufficientStockError);

      const inventory = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });
      expect(inventory.quantityAvailable).toBe(2);
      expect(inventory.quantityReserved).toBe(0);

      const movements = await AppDataSource.query<unknown[]>(
        `SELECT 1 FROM inventory_movements WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId],
      );
      expect(movements).toHaveLength(0);

      const order = await AppDataSource.getRepository(
        OrderOrmEntity,
      ).findOneByOrFail({ id: orderId });
      expect(order.warehouseId).toBeNull();
      expect(order.reservationExpiresAt).toBeNull();
    });
  });

  describe('release and commit', () => {
    async function reserveOne(
      orderId: string,
      warehouseId: string,
      productId: string,
      quantity: number,
    ): Promise<void> {
      await AppDataSource.transaction(async (manager) => {
        await service.reserve(manager, {
          orderId,
          warehouseId,
          lines: [{ productId, quantity }],
        });
      });
    }

    it('release is idempotent: calling it twice returns the stock exactly once, and leaves exactly one RELEASE movement', async () => {
      const orderId = await makeOrder();
      const productId = await makeProduct();
      const warehouseId = await makeWarehouse();
      await setStock(warehouseId, productId, 5);
      await reserveOne(orderId, warehouseId, productId, 3);

      for (let i = 0; i < 2; i++) {
        await AppDataSource.transaction(async (manager) => {
          await service.release(manager, {
            orderId,
            warehouseId,
            productIds: [productId],
          });
        });
      }

      const inventory = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });
      expect(inventory.quantityAvailable).toBe(5);
      expect(inventory.quantityReserved).toBe(0);
      expect(await countMovements(warehouseId, productId, 'RELEASE')).toBe(1);
    });

    it('commit is idempotent: calling it twice clears the reservation exactly once, and leaves exactly one COMMIT movement', async () => {
      const orderId = await makeOrder();
      const productId = await makeProduct();
      const warehouseId = await makeWarehouse();
      await setStock(warehouseId, productId, 5);
      await reserveOne(orderId, warehouseId, productId, 3);

      for (let i = 0; i < 2; i++) {
        await AppDataSource.transaction(async (manager) => {
          await service.commit(manager, {
            orderId,
            warehouseId,
            productIds: [productId],
          });
        });
      }

      const inventory = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });
      // commit never touches quantity_available (specs/02-fulfilment-core.md,
      // Decisions) — it stays at the post-reserve value, 5 - 3 = 2.
      expect(inventory.quantityAvailable).toBe(2);
      expect(inventory.quantityReserved).toBe(0);
      expect(await countMovements(warehouseId, productId, 'COMMIT')).toBe(1);
    });

    it('release after commit is a no-op: writes nothing and changes no balance', async () => {
      const orderId = await makeOrder();
      const productId = await makeProduct();
      const warehouseId = await makeWarehouse();
      await setStock(warehouseId, productId, 5);
      await reserveOne(orderId, warehouseId, productId, 3);

      await AppDataSource.transaction(async (manager) => {
        await service.commit(manager, {
          orderId,
          warehouseId,
          productIds: [productId],
        });
      });

      const afterCommit = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });

      await AppDataSource.transaction(async (manager) => {
        await service.release(manager, {
          orderId,
          warehouseId,
          productIds: [productId],
        });
      });

      const afterRelease = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });
      expect(afterRelease.quantityAvailable).toBe(
        afterCommit.quantityAvailable,
      );
      expect(afterRelease.quantityReserved).toBe(afterCommit.quantityReserved);
      expect(await countMovements(warehouseId, productId, 'RELEASE')).toBe(0);
      expect(await countMovements(warehouseId, productId, 'COMMIT')).toBe(1);
    });
  });
});
