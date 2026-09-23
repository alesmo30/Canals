import { randomUUID } from 'crypto';

import { WarehouseSelectionRepository } from './warehouse-selection.repository';
import { AppDataSource } from '../data-source';
import { InventoryOrmEntity } from '../entities/inventory.orm-entity';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import { WarehouseOrmEntity } from '../entities/warehouse.orm-entity';
import { Coordinates } from '../../../domain/value-objects/coordinates';

describe('WarehouseSelectionRepository (integration)', () => {
  let repo: WarehouseSelectionRepository;

  beforeAll(async () => {
    await AppDataSource.initialize();
    repo = new WarehouseSelectionRepository(AppDataSource);
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  async function makeProduct(
    overrides: Partial<ProductOrmEntity> = {},
  ): Promise<ProductOrmEntity> {
    return AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Test Product',
      condition: 'NEW',
      unitPriceCents: 1000,
      isActive: true,
      ...overrides,
    });
  }

  async function makeWarehouse(
    latitude: number,
    longitude: number,
    overrides: Partial<WarehouseOrmEntity> = {},
  ): Promise<WarehouseOrmEntity> {
    return AppDataSource.getRepository(WarehouseOrmEntity).save({
      name: `Test WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      location: { type: 'Point', coordinates: [longitude, latitude] },
      isActive: true,
      ...overrides,
    });
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

  it('returns the nearest warehouse first, distance matching a hand-computed ST_Distance', async () => {
    const product = await makeProduct();
    const near = await makeWarehouse(40.7128, -74.006); // NYC
    const far = await makeWarehouse(34.0522, -118.2437); // LA
    await setStock(near.id, product.id, 5);
    await setStock(far.id, product.id, 5);

    // Times Square — close to `near`, far from `far`.
    const shippingPoint = Coordinates.of({
      latitude: 40.7484,
      longitude: -73.9857,
    });

    const candidates = await repo.findCandidates(shippingPoint, [
      { productId: product.id, quantity: 1 },
    ]);

    expect(candidates.map((c) => c.warehouseId)).toEqual([near.id, far.id]);

    const [{ d }] = await AppDataSource.query<{ d: number }[]>(
      `SELECT ST_Distance(
         (SELECT location FROM warehouses WHERE id = $1),
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
       ) AS d`,
      [near.id, -73.9857, 40.7484],
    );
    expect(candidates[0].distanceMeters).toBeCloseTo(Number(d), 6);
  });

  it('returns no candidates when no single warehouse can supply the full quantity (C-6)', async () => {
    const product = await makeProduct();
    const whA = await makeWarehouse(40.7128, -74.006);
    const whB = await makeWarehouse(34.0522, -118.2437);
    // 2 units each — 4 combined would cover a request for 3, but an order
    // is never split across warehouses.
    await setStock(whA.id, product.id, 2);
    await setStock(whB.id, product.id, 2);

    const shippingPoint = Coordinates.of({
      latitude: 40.7128,
      longitude: -74.006,
    });
    const candidates = await repo.findCandidates(shippingPoint, [
      { productId: product.id, quantity: 3 },
    ]);

    expect(candidates).toEqual([]);
  });

  it('returns no candidates when order lines are spread across warehouses, each holding only part of them (C-6)', async () => {
    const productA = await makeProduct();
    const productB = await makeProduct();
    const whA = await makeWarehouse(40.7128, -74.006);
    const whB = await makeWarehouse(34.0522, -118.2437);
    await setStock(whA.id, productA.id, 10); // whA has A but not B
    await setStock(whB.id, productB.id, 10); // whB has B but not A

    const shippingPoint = Coordinates.of({
      latitude: 40.7128,
      longitude: -74.006,
    });
    const candidates = await repo.findCandidates(shippingPoint, [
      { productId: productA.id, quantity: 1 },
      { productId: productB.id, quantity: 1 },
    ]);

    expect(candidates).toEqual([]);
  });

  it('excludes an inactive warehouse, and excludes every warehouse when the product is inactive', async () => {
    const shippingPoint = Coordinates.of({
      latitude: 40.7128,
      longitude: -74.006,
    });

    const product = await makeProduct();
    const inactiveWarehouse = await makeWarehouse(40.7128, -74.006, {
      isActive: false,
    });
    await setStock(inactiveWarehouse.id, product.id, 5);

    expect(
      await repo.findCandidates(shippingPoint, [
        { productId: product.id, quantity: 1 },
      ]),
    ).toEqual([]);

    const inactiveProduct = await makeProduct({ isActive: false });
    const activeWarehouseOne = await makeWarehouse(40.7128, -74.006);
    const activeWarehouseTwo = await makeWarehouse(34.0522, -118.2437);
    await setStock(activeWarehouseOne.id, inactiveProduct.id, 5);
    await setStock(activeWarehouseTwo.id, inactiveProduct.id, 5);

    expect(
      await repo.findCandidates(shippingPoint, [
        { productId: inactiveProduct.id, quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('breaks ties by warehouse.id, and repeated runs return the same order', async () => {
    const product = await makeProduct();
    // Shared point, distinct from the other tests' coordinates so this
    // test's warehouses cannot be mistaken for theirs.
    const latitude = 41.0;
    const longitude = -75.0;
    const whX = await makeWarehouse(latitude, longitude);
    const whY = await makeWarehouse(latitude, longitude);
    await setStock(whX.id, product.id, 5);
    await setStock(whY.id, product.id, 5);

    const expectedOrder = [whX.id, whY.id].sort();

    const shippingPoint = Coordinates.of({ latitude, longitude });
    const lines = [{ productId: product.id, quantity: 1 }];

    const firstRun = await repo.findCandidates(shippingPoint, lines);
    const secondRun = await repo.findCandidates(shippingPoint, lines);

    expect(firstRun.map((c) => c.warehouseId)).toEqual(expectedOrder);
    expect(secondRun.map((c) => c.warehouseId)).toEqual(expectedOrder);
  });
});
