import { randomUUID } from 'crypto';

import {
  orderItemToDomain,
  orderItemToPersistence,
  orderToDomain,
  orderToPersistence,
} from './order.mapper';
import { Order } from '../../../domain/entities/order';
import { OrderItem } from '../../../domain/entities/order-item';
import { Coordinates } from '../../../domain/value-objects/coordinates';
import { Money } from '../../../domain/value-objects/money';
import { ShippingAddress } from '../../../domain/value-objects/shipping-address';
import { AppDataSource } from '../data-source';
import { CustomerOrmEntity } from '../entities/customer.orm-entity';
import { OrderItemOrmEntity } from '../entities/order-item.orm-entity';
import { OrderOrmEntity } from '../entities/order.orm-entity';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import { WarehouseOrmEntity } from '../entities/warehouse.orm-entity';

describe('order.mapper (integration)', () => {
  let customerId: string;
  let productId: string;
  let warehouseId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Jane Doe',
    });
    customerId = customer.id;

    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'iPhone 15',
      condition: 'NEW',
      unitPriceCents: 1099,
      isActive: true,
    });
    productId = product.id;

    // Newark, NJ — same coordinates as the seed's Newark warehouse.
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: 'Newark DC',
      address: { line1: '1 Warehouse Rd', city: 'Newark', country: 'US' },
      location: { type: 'Point', coordinates: [-74.172363, 40.735657] },
      isActive: true,
    });
    warehouseId = warehouse.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('round-trips an Order through orderToPersistence -> save -> find -> orderToDomain', async () => {
    const original = new Order({
      id: randomUUID(),
      orderNumber: `CNL-2026-${Math.floor(Math.random() * 1_000_000)}`,
      customerId,
      warehouseId,
      status: 'PENDING_PAYMENT',
      total: Money.of(3297, 'USD'),
      shippingAddress: ShippingAddress.of({
        recipient: 'Jane Doe',
        line1: '1 Apple Park Way',
        city: 'Cupertino',
        state: 'CA',
        postalCode: '95014',
        country: 'US',
      }),
      // San Jose, CA — deliberately different from the warehouse's
      // coordinates, so a lat/lng swap in either direction would surface
      // as a wrong value, not an accidental match.
      shippingLocation: Coordinates.of({
        latitude: 37.334606,
        longitude: -121.89496,
      }),
      reservationExpiresAt: new Date('2026-01-01T00:15:00Z'),
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await AppDataSource.getRepository(OrderOrmEntity).save(
      orderToPersistence(original),
    );

    const entity = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({
      id: original.getId(),
    });
    const roundTripped = orderToDomain(entity);

    expect(roundTripped.getId()).toBe(original.getId());
    expect(roundTripped.getOrderNumber()).toBe(original.getOrderNumber());
    expect(roundTripped.getCustomerId()).toBe(customerId);
    expect(roundTripped.getWarehouseId()).toBe(warehouseId);
    expect(roundTripped.getStatus()).toBe('PENDING_PAYMENT');
    expect(roundTripped.getTotal().equals(Money.of(3297, 'USD'))).toBe(true);
    expect(
      roundTripped.getShippingAddress().equals(original.getShippingAddress()),
    ).toBe(true);
    expect(roundTripped.getShippingLocation().getLatitude()).toBe(37.334606);
    expect(roundTripped.getShippingLocation().getLongitude()).toBe(-121.89496);
  });

  it('round-trips an OrderItem through orderItemToPersistence -> save -> find -> orderItemToDomain', async () => {
    const order = await AppDataSource.getRepository(OrderOrmEntity).save(
      orderToPersistence(
        new Order({
          id: randomUUID(),
          orderNumber: `CNL-2026-${Math.floor(Math.random() * 1_000_000)}`,
          customerId,
          warehouseId,
          status: 'PENDING_PAYMENT',
          total: Money.of(3297, 'USD'),
          shippingAddress: ShippingAddress.of({
            recipient: 'Jane Doe',
            line1: '1 Apple Park Way',
            city: 'Cupertino',
            country: 'US',
          }),
          shippingLocation: Coordinates.of({
            latitude: 37.334606,
            longitude: -122.009102,
          }),
          reservationExpiresAt: null,
          confirmedAt: null,
          cancelledAt: null,
          cancellationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    );

    const originalItem = new OrderItem({
      id: randomUUID(),
      orderId: order.id,
      productId,
      quantity: 3,
      productSkuSnapshot: 'SKU-SNAPSHOT',
      productNameSnapshot: 'iPhone 15 (snapshot)',
      unitPrice: Money.of(1099),
      createdAt: new Date(),
    });

    await AppDataSource.getRepository(OrderItemOrmEntity).save(
      orderItemToPersistence(originalItem),
    );

    const entity = await AppDataSource.getRepository(
      OrderItemOrmEntity,
    ).findOneByOrFail({
      id: originalItem.getId(),
    });
    const roundTripped = orderItemToDomain(entity);

    expect(roundTripped.getId()).toBe(originalItem.getId());
    expect(roundTripped.getOrderId()).toBe(order.id);
    expect(roundTripped.getProductId()).toBe(productId);
    expect(roundTripped.getQuantity()).toBe(3);
    expect(roundTripped.getLineTotal().getAmountCents()).toBe(3297);
  });
});
