import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { AppDataSource } from './data-source';
import { InventoryOrmEntity } from './entities/inventory.orm-entity';
import { OrderOrmEntity } from './entities/order.orm-entity';
import { ProductOrmEntity } from './entities/product.orm-entity';
import { WarehouseOrmEntity } from './entities/warehouse.orm-entity';
import { orderToPersistence } from './mappers/order.mapper';
import { InventoryService } from '../../application/allocation/inventory.service';
import { Order } from '../../domain/entities/order';
import { Coordinates } from '../../domain/value-objects/coordinates';
import { Money } from '../../domain/value-objects/money';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { CustomerOrmEntity } from './entities/customer.orm-entity';

/**
 * specs/02-fulfilment-core.md, step 7. Integration test — same
 * prerequisites as the other `*.integration.spec.ts` files: DATABASE_URL
 * (+ PAYMENTS_URL, OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated
 * Postgres reachable. Builds its own customer/product/warehouse/order
 * fixtures, not seed.ts.
 */
describe('verify-ledger.sql (integration)', () => {
  const service = new InventoryService();
  const sql = readFileSync(join(__dirname, 'sql/verify-ledger.sql'), 'utf-8');

  interface LedgerRow {
    warehouse_id: string;
    product_id: string;
    expected_available: number;
    actual_available: number;
    expected_reserved: number;
    actual_reserved: number;
  }

  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('returns nothing for a pair whose balance matches its latest movement, and exactly that row after a manual UPDATE, undone afterwards', async () => {
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Ledger Test Customer',
    });

    const order = new Order({
      id: randomUUID(),
      orderNumber: `CNL-LEDGER-${Math.floor(Math.random() * 1_000_000)}`,
      customerId: customer.id,
      warehouseId: null,
      status: 'PENDING_PAYMENT',
      total: Money.of(1000, 'USD'),
      shippingAddress: ShippingAddress.of({
        recipient: 'Ledger Test',
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
    const orderId = (
      await AppDataSource.getRepository(OrderOrmEntity).save(
        orderToPersistence(order),
      )
    ).id;

    const productId = (
      await AppDataSource.getRepository(ProductOrmEntity).save({
        sku: `SKU-${randomUUID()}`,
        name: 'Ledger Test Product',
        condition: 'NEW',
        unitPriceCents: 1000,
        isActive: true,
      })
    ).id;

    const warehouseId = (
      await AppDataSource.getRepository(WarehouseOrmEntity).save({
        name: `Ledger Test WH ${randomUUID()}`,
        address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
        location: { type: 'Point', coordinates: [-74.006, 40.7128] },
        isActive: true,
      })
    ).id;

    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId,
      productId,
      quantityAvailable: 5,
      quantityReserved: 0,
    });

    await AppDataSource.transaction(async (manager) => {
      await service.reserve(manager, {
        orderId,
        warehouseId,
        lines: [{ productId, quantity: 3 }],
      });
    });

    const rowsForThisPair = (rows: LedgerRow[]): LedgerRow[] =>
      rows.filter(
        (row) =>
          row.warehouse_id === warehouseId && row.product_id === productId,
      );

    const before: LedgerRow[] = await AppDataSource.query(sql);
    expect(rowsForThisPair(before)).toEqual([]);

    // Deliberate tamper: bypass reserve/release/commit entirely.
    await AppDataSource.query(
      `UPDATE inventory SET quantity_available = 999
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId],
    );

    try {
      const afterTamper: LedgerRow[] = await AppDataSource.query(sql);
      const discrepancies = rowsForThisPair(afterTamper);
      expect(discrepancies).toHaveLength(1);
      expect(discrepancies[0]).toMatchObject({
        expected_available: 2,
        actual_available: 999,
        expected_reserved: 3,
        actual_reserved: 3,
      });
    } finally {
      // Undo the tamper — the query returns to zero rows for this pair.
      await AppDataSource.query(
        `UPDATE inventory SET quantity_available = 2
         WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId],
      );
    }

    const after: LedgerRow[] = await AppDataSource.query(sql);
    expect(rowsForThisPair(after)).toEqual([]);
  });
});
