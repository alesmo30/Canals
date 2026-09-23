import { randomUUID } from 'crypto';

import {
  AllocateInventoryUseCase,
  AllocationResult,
} from './allocate-inventory.use-case';
import { NoFulfilmentPossibleError } from './errors';
import { InventoryService } from './inventory.service';
import { OnBeforeReserve } from './allocation.types';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { WarehouseSelectionRepository } from '../../infrastructure/database/repositories/warehouse-selection.repository';
import { Coordinates } from '../../domain/value-objects/coordinates';

describe('AllocateInventoryUseCase (integration)', () => {
  const useCase = new AllocateInventoryUseCase(
    new WarehouseSelectionRepository(AppDataSource),
    new InventoryService(),
    AppDataSource,
  );
  let customerId: string;

  // Shipping point every test in this file ships to — NYC. Warehouses
  // are placed at varying distances from it to control selection order.
  const shippingLocation = Coordinates.of({
    latitude: 40.7128,
    longitude: -74.006,
  });

  beforeAll(async () => {
    await AppDataSource.initialize();
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Allocation Test Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  async function makeProduct(): Promise<string> {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Allocation Test Product',
      condition: 'NEW',
      unitPriceCents: 1000,
      isActive: true,
    });
    return product.id;
  }

  async function makeWarehouse(
    latitude: number,
    longitude: number,
  ): Promise<string> {
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Allocation Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      location: { type: 'Point', coordinates: [longitude, latitude] },
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

  /** The stand-in order that onBeforeReserve inserts. */
  function insertMockOrder(): OnBeforeReserve {
    return async (manager, { orderId }) => {
      await manager.query(
        `INSERT INTO orders
           (id, order_number, customer_id, status, currency, total_cents, shipping_address, shipping_location)
         VALUES ($1, $2, $3, 'PENDING_PAYMENT', 'USD', 1000, $4::jsonb, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)`,
        [
          orderId,
          `CNL-${Math.floor(Math.random() * 1_000_000)}`,
          customerId,
          JSON.stringify({
            line1: '1 Test Way',
            city: 'Test City',
            country: 'US',
          }),
          -74.006,
          40.7128,
        ],
      );
    };
  }

  it('lands the reservation on the second candidate when the first loses its stock between selection and reservation, with no partial write left behind', async () => {
    const productId = await makeProduct();
    // Closer to shippingLocation than farWarehouse — selection ranks it first.
    const nearWarehouseId = await makeWarehouse(40.72, -74.0);
    const farWarehouseId = await makeWarehouse(34.0522, -118.2437);
    await setStock(nearWarehouseId, productId, 5);
    await setStock(farWarehouseId, productId, 5);

    let attempt = 0;
    const onBeforeReserve: OnBeforeReserve = async (manager, params) => {
      attempt += 1;
      if (attempt === 1) {
        // Simulates a concurrent order draining the near warehouse's
        // stock between the selection query (already run) and this
        // attempt's own reserve() call, still inside this attempt's
        // transaction — reserve()'s own lock will see it as 0.
        await manager.query(
          `UPDATE inventory SET quantity_available = 0
           WHERE warehouse_id = $1 AND product_id = $2`,
          [nearWarehouseId, productId],
        );
      }
      await insertMockOrder()(manager, params);
    };

    const result: AllocationResult = await useCase.execute({
      shippingLocation,
      lines: [{ productId, quantity: 3 }],
      onBeforeReserve,
    });

    expect(result.warehouseId).toBe(farWarehouseId);
    expect(attempt).toBe(2);

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: result.orderId });
    expect(order.warehouseId).toBe(farWarehouseId);

    const farMovements = await AppDataSource.query<unknown[]>(
      `SELECT 1 FROM inventory_movements WHERE warehouse_id = $1 AND product_id = $2 AND order_id = $3`,
      [farWarehouseId, productId, result.orderId],
    );
    expect(farMovements).toHaveLength(1);

    // Nothing from the failed first attempt survives: its whole transaction
    // rolled back.
    const nearMovements = await AppDataSource.query<unknown[]>(
      `SELECT 1 FROM inventory_movements WHERE warehouse_id = $1 AND product_id = $2`,
      [nearWarehouseId, productId],
    );
    expect(nearMovements).toHaveLength(0);

    const nearInventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId: nearWarehouseId, productId });
    expect(nearInventory.quantityAvailable).toBe(5); // rolled back to its pre-attempt value
  });

  it('returns the winning warehouse name and distance alongside its id', async () => {
    const productId = await makeProduct();
    const warehouseId = await makeWarehouse(40.72, -74.0);
    await setStock(warehouseId, productId, 5);
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).findOneByOrFail({ id: warehouseId });

    const result: AllocationResult = await useCase.execute({
      shippingLocation,
      lines: [{ productId, quantity: 1 }],
      onBeforeReserve: insertMockOrder(),
    });

    expect(result.warehouseId).toBe(warehouseId);
    expect(result.name).toBe(warehouse.name);
    expect(typeof result.distanceMeters).toBe('number');
    expect(result.distanceMeters).toBeGreaterThanOrEqual(0);
  });

  it('raises NoFulfilmentPossibleError(NO_CANDIDATES) naming every requested product id when no candidate qualifies', async () => {
    const productId = await makeProduct();
    // No warehouse stocks this product at all — selection returns nothing.

    const promise = useCase.execute({
      shippingLocation,
      lines: [{ productId, quantity: 1 }],
      onBeforeReserve: insertMockOrder(),
    });

    await expect(promise).rejects.toBeInstanceOf(NoFulfilmentPossibleError);
    await promise.catch((error: NoFulfilmentPossibleError) => {
      expect(error.productIds).toEqual([productId]);
      expect(error.reason).toBe('NO_CANDIDATES');
    });
  });

  it('raises NoFulfilmentPossibleError(RESERVATION_RACE_LOST) with the unmet product ids after every candidate fails', async () => {
    const productId = await makeProduct();
    const warehouseAId = await makeWarehouse(40.72, -74.0);
    const warehouseBId = await makeWarehouse(34.0522, -118.2437);
    // Both candidates qualify at selection time...
    await setStock(warehouseAId, productId, 5);
    await setStock(warehouseBId, productId, 5);

    const onBeforeReserve: OnBeforeReserve = async (manager, params) => {
      // ...but lose their stock inside each attempt's own transaction,
      // before reserve()'s lock re-checks it.
      await manager.query(
        `UPDATE inventory SET quantity_available = 0
         WHERE warehouse_id = $1 AND product_id = $2`,
        [params.warehouseId, productId],
      );
      await insertMockOrder()(manager, params);
    };

    const promise = useCase.execute({
      shippingLocation,
      lines: [{ productId, quantity: 3 }],
      onBeforeReserve,
    });

    await expect(promise).rejects.toBeInstanceOf(NoFulfilmentPossibleError);
    await promise.catch((error: NoFulfilmentPossibleError) => {
      expect(error.productIds).toEqual([productId]);
      expect(error.reason).toBe('RESERVATION_RACE_LOST');
    });

    for (const warehouseId of [warehouseAId, warehouseBId]) {
      const inventory = await AppDataSource.getRepository(
        InventoryOrmEntity,
      ).findOneByOrFail({ warehouseId, productId });
      expect(inventory.quantityAvailable).toBe(5); // both attempts rolled back
    }
  });
});
