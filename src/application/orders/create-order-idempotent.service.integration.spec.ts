import { randomUUID } from 'crypto';

import { PgBoss } from 'pg-boss';

import { CreateOrderIdempotentService } from './create-order-idempotent.service';
import { CreateOrderUseCase } from './create-order.use-case';
import { OrderSettlementService } from './order-settlement.service';
import { AllocateInventoryUseCase } from '../allocation/allocate-inventory.use-case';
import { InventoryService } from '../allocation/inventory.service';
import { CreateOrderDto } from '../../infrastructure/http/dto/create-order.dto';
import type { ProblemDetails } from '../../infrastructure/http/filters/problem-details.filter';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { WarehouseSelectionRepository } from '../../infrastructure/database/repositories/warehouse-selection.repository';
import { StaticGeocodingProvider } from '../../infrastructure/geocoding/static-geocoding.provider';
import { setupQueues } from '../../infrastructure/messaging/queue-setup';
import { PgBossEventPublisher } from '../../infrastructure/messaging/pg-boss-event-publisher';
import { HttpPaymentGateway } from '../../infrastructure/payments/http-payment-gateway';

const DECLINED_CARD_NUMBER = '4000000000000002';

interface IdempotencyKeyRow {
  order_id: string | null;
  response_body: ProblemDetails;
}

/**
 * SPEC 07 Fix C — integration test: DATABASE_URL, PAYMENTS_URL
 * (`payments-mock` reachable, `docker compose up`) and
 * OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated Postgres reachable.
 * Asserts idempotency_keys.order_id is recorded for a 402, even though
 * the 402 response body itself carries no `orderId` extension member
 * (Decisions — only the 502 does).
 */
describe('CreateOrderIdempotentService (integration) — Fix C order_id recording', () => {
  let boss: PgBoss;
  let service: CreateOrderIdempotentService;
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();

    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);

    const useCase = new CreateOrderUseCase(
      AppDataSource,
      new AllocateInventoryUseCase(
        new WarehouseSelectionRepository(AppDataSource),
        new InventoryService(),
        AppDataSource,
      ),
      new OrderSettlementService(
        AppDataSource,
        new InventoryService(),
        new PgBossEventPublisher(boss),
      ),
      new StaticGeocodingProvider(),
      new HttpPaymentGateway({ baseUrl: process.env.PAYMENTS_URL! }),
    );
    service = new CreateOrderIdempotentService(useCase, AppDataSource);

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Idempotent Create Order Test Customer',
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
      name: 'Idempotent Create Order Test Product',
      condition: 'NEW',
      unitPriceCents,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Idempotent Create Order Test WH ${randomUUID()}`,
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
    return { product };
  }

  it('records idempotency_keys.order_id for a 402, without exposing orderId in the stored body', async () => {
    const { product } = await makeFixture(2500);
    const idempotencyKey = randomUUID();
    const dto: CreateOrderDto = {
      customerId,
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Broadway',
        city: 'New York',
        state: 'NY',
        country: 'US',
      },
      items: [{ productId: product.id, quantity: 1 }],
      payment: { cardNumber: DECLINED_CARD_NUMBER },
    };

    await expect(
      service.execute({ idempotencyKey, dto, instance: '/orders' }),
    ).rejects.toMatchObject({ name: 'PaymentDeclinedError' });

    const rows: IdempotencyKeyRow[] = await AppDataSource.query(
      `SELECT order_id, response_body FROM idempotency_keys
       WHERE scope = 'POST /orders' AND idempotency_key = $1`,
      [idempotencyKey],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).not.toBeNull();
    expect(rows[0].response_body.orderId).toBeUndefined();
  });
});
