import { randomUUID } from 'crypto';

import { GetOrderService } from './get-order.service';
import { OrderNotFoundError } from './order-read.errors';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../../infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { OrdersReadRepository } from '../../infrastructure/database/repositories/orders-read.repository';

describe('GetOrderService (integration)', () => {
  let service: GetOrderService;
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    service = new GetOrderService(new OrdersReadRepository(AppDataSource));

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Get Order Test Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('throws OrderNotFoundError for an id with no UUID shape, without querying the database', async () => {
    await expect(service.execute('not-a-uuid')).rejects.toThrow(
      OrderNotFoundError,
    );
  });

  it('throws OrderNotFoundError for a well-formed but non-existent id', async () => {
    await expect(service.execute(randomUUID())).rejects.toThrow(
      OrderNotFoundError,
    );
  });

  it('returns the order assembled from all four queries for a real id', async () => {
    const order = await AppDataSource.getRepository(OrderOrmEntity).save({
      orderNumber: `CNL-T-${randomUUID().slice(0, 20)}`,
      customerId,
      warehouseId: null,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      totalCents: 1500,
      shippingAddress: {
        recipient: 'Test Recipient',
        line1: '1 Test Way',
        city: 'Test City',
        country: 'US',
      },
      shippingLocation: {
        type: 'Point',
        coordinates: [-74.006, 40.7128],
      },
    });

    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Test Product',
      condition: 'NEW',
      unitPriceCents: 1500,
      isActive: true,
    });
    await AppDataSource.getRepository(OrderItemOrmEntity).save({
      orderId: order.id,
      productId: product.id,
      quantity: 1,
      productSkuSnapshot: product.sku,
      productNameSnapshot: product.name,
      unitPriceCents: 1500,
    });

    await AppDataSource.getRepository(PaymentOrmEntity).save({
      orderId: order.id,
      attempt: 1,
      provider: 'mock',
      providerPaymentId: null,
      idempotencyKey: `idem-${randomUUID()}`,
      status: 'DECLINED',
      amountCents: 1500,
      currency: 'USD',
      cardLast4: null,
      cardBrand: null,
      failureCode: 'CARD_DECLINED',
      rawResponse: null,
      settledAt: null,
    });

    const result = await service.execute(order.id);

    expect(result.order.id).toBe(order.id);
    expect(result.order.warehouse_name).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].product_id).toBe(product.id);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].status).toBe('DECLINED');
    expect(result.shipment).toBeNull();
  });
});
