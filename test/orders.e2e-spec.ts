import { randomUUID } from 'crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { ApiModule } from '../src/modules/api.module';
import type { OrderResponse } from '../src/infrastructure/http/dto/order-response.dto';
import type { ProblemDetails } from '../src/infrastructure/http/filters/problem-details.filter';
import { AppDataSource } from '../src/infrastructure/database/data-source';
import { CustomerOrmEntity } from '../src/infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../src/infrastructure/database/entities/inventory.orm-entity';
import { OrderOrmEntity } from '../src/infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../src/infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../src/infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../src/infrastructure/database/entities/warehouse.orm-entity';

const APPROVED_CARD = '4242424242424242';
const DECLINED_CARD = '4000000000000002';
const TIMEOUT_CARD = '4000000000000004';

/** supertest types `res.body` as `any`; every assertion below narrows it explicitly instead. */
function asOrder(body: unknown): OrderResponse {
  return body as OrderResponse;
}
function asProblem(body: unknown): ProblemDetails {
  return body as ProblemDetails;
}

/**
 * specs/05-order-creation-saga.md, step 13 — acceptance coverage for
 * R4.5's 7 error rows plus the happy path and idempotency semantics, all
 * through real HTTP requests against a fully booted `ApiModule`.
 *
 * Requires DATABASE_URL, PAYMENTS_URL (`payments-mock` reachable,
 * `docker compose up`) and OTEL_EXPORTER_OTLP_ENDPOINT exported, and a
 * migrated Postgres reachable. `AppDataSource` builds/asserts fixtures
 * directly (randomUUID-scoped, not seed.ts); the real HTTP requests go
 * through the booted Nest app's own connection.
 *
 * Not covered here, by design:
 * - `docker stop payments-mock` -> 502 + open circuit breaker (AC row 5):
 *   the breaker is global, in-process state — running it here would
 *   contaminate every other test's payment calls (Risks table,
 *   specs/05). It belongs in its own isolated run, same as P2 already
 *   decided.
 * - "no card number in logs/traces": verified by grepping
 *   `npm run events-check`'s own output, not a jest assertion.
 */
describe('POST /orders (e2e)', () => {
  let app: INestApplication<App>;
  let customerId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts's bootstrap() isn't invoked by Test.createTestingModule, so
    // the global ValidationPipe it sets up must be added here too.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Orders E2E Customer',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await app.close();
    await AppDataSource.destroy();
  });

  async function makeFixture(
    quantityAvailable = 5,
  ): Promise<{ productId: string; warehouseId: string }> {
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Orders E2E Product',
      condition: 'NEW',
      unitPriceCents: 1500,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Orders E2E WH ${randomUUID()}`,
      address: { line1: '1 Test Way', city: 'Test City', country: 'US' },
      // Near New York, matching the shipping address every test below uses.
      location: { type: 'Point', coordinates: [-74.0, 40.72] },
      isActive: true,
    });
    await AppDataSource.getRepository(InventoryOrmEntity).save({
      warehouseId: warehouse.id,
      productId: product.id,
      quantityAvailable,
      quantityReserved: 0,
    });
    return { productId: product.id, warehouseId: warehouse.id };
  }

  function validBody(
    productId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      customerId,
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Broadway',
        city: 'New York',
        state: 'NY',
        country: 'US',
      },
      items: [{ productId, quantity: 1 }],
      payment: { cardNumber: APPROVED_CARD },
      ...overrides,
    };
  }

  it('a valid order returns 201 and picks the nearest qualifying warehouse', async () => {
    const { productId, warehouseId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId))
      .expect(201);

    const body = asOrder(res.body);
    expect(body.status).toBe('CONFIRMED');
    expect(body.warehouse.id).toBe(warehouseId);
    expect(typeof body.warehouse.name).toBe('string');
    expect(typeof body.warehouse.distanceMeters).toBe('number');
    expect(body.items).toHaveLength(1);
    expect(body.totalCents).toBe(1500);
    expect(body.paymentStatus).toBe('CAPTURED');
  });

  it('400: an unknown property in the body is rejected (strict whitelist)', async () => {
    const { productId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId, { extraField: 'nope' }))
      .expect(400);

    const body = asProblem(res.body);
    expect(body.status).toBe(400);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'extraField' }),
      ]),
    );
  });

  it('400: a duplicate productId within items[] is rejected', async () => {
    const { productId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(
        validBody(productId, {
          items: [
            { productId, quantity: 1 },
            { productId, quantity: 1 },
          ],
        }),
      )
      .expect(400);

    expect(asProblem(res.body).status).toBe(400);
  });

  it('400: a missing Idempotency-Key header is rejected', async () => {
    const { productId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .send(validBody(productId))
      .expect(400);

    expect(asProblem(res.body).status).toBe(400);
  });

  it('404: an unknown customerId', async () => {
    const { productId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId, { customerId: randomUUID() }))
      .expect(404);

    expect(asProblem(res.body).status).toBe(404);
  });

  it('404: an unknown/inactive productId', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(randomUUID()))
      .expect(404);

    expect(asProblem(res.body).status).toBe(404);
  });

  it('422: no warehouse can fulfil the order at all (NO_CANDIDATES)', async () => {
    // A product that no warehouse ever stocks.
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Orders E2E Unstocked Product',
      condition: 'NEW',
      unitPriceCents: 1000,
      isActive: true,
    });

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(product.id))
      .expect(422);

    expect(asProblem(res.body).type).toBe(
      'urn:problem-type:no-fulfilment-possible',
    );
  });

  it('422: geocoding fails for an unrecognised city', async () => {
    const { productId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(
        validBody(productId, {
          shippingAddress: {
            recipient: 'Ada Lovelace',
            line1: '1 Nowhere Rd',
            city: 'Nowhereville',
            country: 'US',
          },
        }),
      )
      .expect(422);

    expect(asProblem(res.body).type).toBe('urn:problem-type:geocoding-failed');
  });

  it('409: two concurrent orders racing for the last unit — the loser gets a conflict, not a 422', async () => {
    const { productId } = await makeFixture(1); // exactly one unit available

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send(validBody(productId)),
      request(app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send(validBody(productId)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = first.status === 409 ? first : second;
    expect(asProblem(loser.body).type).toBe(
      'urn:problem-type:inventory-reservation-conflict',
    );
  });

  it('402: card ...0002 is declined — order becomes PAYMENT_FAILED, stock is released', async () => {
    const { productId, warehouseId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId, { payment: { cardNumber: DECLINED_CARD } }))
      .expect(402);

    expect(asProblem(res.body).status).toBe(402);

    const orders = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { warehouseId },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('PAYMENT_FAILED');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
  });

  it('502: card ...0004 times out at the provider — order stays PENDING_PAYMENT, reservation intact', async () => {
    const { productId, warehouseId } = await makeFixture();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId, { payment: { cardNumber: TIMEOUT_CARD } }))
      .expect(502);

    expect(asProblem(res.body).status).toBe(502);

    const orders = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { warehouseId },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('PENDING_PAYMENT');

    const persistedPayment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ orderId: orders[0].id });
    expect(persistedPayment.status).toBe('UNKNOWN');
  }, 15_000);

  it('idempotency: replaying the same key with the same body returns the identical response, no second order', async () => {
    const { productId } = await makeFixture();
    const idempotencyKey = randomUUID();
    const body = validBody(productId);

    const first = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    const firstOrderId = asOrder(first.body).id;
    const orders = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { id: firstOrderId },
    });
    expect(orders).toHaveLength(1);

    const payments = await AppDataSource.getRepository(PaymentOrmEntity).find({
      where: { orderId: firstOrderId },
    });
    expect(payments).toHaveLength(1);
  });

  it('idempotency: the same key with a different body returns 422', async () => {
    const { productId } = await makeFixture();
    const idempotencyKey = randomUUID();

    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(validBody(productId))
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(validBody(productId, { items: [{ productId, quantity: 2 }] }))
      .expect(422);

    expect(asProblem(res.body).status).toBe(422);
  });
});
