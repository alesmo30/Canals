import { randomUUID } from 'crypto';

import { ShipmentCreateHandler } from './shipment-create.handler';
import { ShipmentService } from './shipment.service';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { ShipmentOrmEntity } from '../../infrastructure/database/entities/shipment.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';

describe('ShipmentCreateHandler (integration)', () => {
  let handler: ShipmentCreateHandler;
  let customerId: string;
  let warehouseId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    handler = new ShipmentCreateHandler(new ShipmentService(AppDataSource));

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Shipment Fixture Customer',
    });
    customerId = customer.id;

    // Newark, NJ — matches order.mapper.integration.spec.ts's fixture.
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: 'Shipment Fixture DC',
      address: { line1: '1 Warehouse Rd', city: 'Newark', country: 'US' },
      location: { type: 'Point', coordinates: [-74.172363, 40.735657] },
      isActive: true,
    });
    warehouseId = warehouse.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  /** Minimal, valid `orders` row — see pg-boss-event-publisher.integration.spec.ts's own fixture for the same shape. */
  function orderFixture(
    id: string,
    warehouseIdOrNull: string | null,
  ): Partial<OrderOrmEntity> {
    return {
      id,
      orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      customerId,
      warehouseId: warehouseIdOrNull,
      status: 'CONFIRMED',
      currency: 'USD',
      totalCents: 1099,
      shippingAddress: { line1: '1 Test St', city: 'Newark', country: 'US' },
      shippingLocation: {
        type: 'Point',
        coordinates: [-74.172363, 40.735657],
      },
      reservationExpiresAt: null,
      confirmedAt: new Date(),
      cancelledAt: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('running the handler twice for the same order creates exactly one shipments row and raises no error', async () => {
    const orderId = randomUUID();
    await AppDataSource.getRepository(OrderOrmEntity).save(
      orderFixture(orderId, warehouseId),
    );

    await expect(
      handler.handle({ orderId, occurredAt: new Date().toISOString() }),
    ).resolves.toBeUndefined();
    await expect(
      handler.handle({ orderId, occurredAt: new Date().toISOString() }),
    ).resolves.toBeUndefined();

    const shipments = await AppDataSource.getRepository(ShipmentOrmEntity).find(
      { where: { orderId } },
    );
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({
      warehouseId,
      status: 'DISPATCHED',
    });
    expect(['UPS', 'FedEx', 'USPS', 'DHL']).toContain(shipments[0].carrier);
    expect(shipments[0].trackingNumber).toEqual(expect.any(String));
    expect(shipments[0].dispatchedAt).toBeInstanceOf(Date);
  });

  it('throws rather than writing a partial row for an order with no warehouse_id', async () => {
    const orderId = randomUUID();
    await AppDataSource.getRepository(OrderOrmEntity).save(
      orderFixture(orderId, null),
    );

    await expect(
      handler.handle({ orderId, occurredAt: new Date().toISOString() }),
    ).rejects.toThrow();

    const shipments = await AppDataSource.getRepository(ShipmentOrmEntity).find(
      { where: { orderId } },
    );
    expect(shipments).toHaveLength(0);
  });
});
