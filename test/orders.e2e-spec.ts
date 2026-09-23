import { randomUUID } from 'crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { ApiModule } from '../src/modules/api.module';
import type { OrderResponse } from '../src/infrastructure/http/dto/order-response.dto';
import type { OrderTimelineResponse } from '../src/infrastructure/http/dto/order-timeline.response.dto';
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
function asTimeline(body: unknown): OrderTimelineResponse {
  return body as OrderTimelineResponse;
}

/**
 * Acceptance coverage for POST /orders over real HTTP. Not covered here:
 * payments-mock down → 502 (the breaker is global in-process state) and
 * "no card numbers in logs" (checked by grepping logs).
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
    expect(typeof body.warehouse.distance.meters).toBe('number');
    expect(typeof body.warehouse.distance.kilometers).toBe('number');
    expect(typeof body.warehouse.distance.miles).toBe('number');
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

  it('409/422: two concurrent orders racing for the last unit — exactly one succeeds, no double-booking', async () => {
    const { productId, warehouseId } = await makeFixture(1); // exactly one unit available

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

    const statuses = [first.status, second.status];
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);

    // The loser gets 422 or 409 depending on interleaving, which can't be
    // forced here; the deterministic 409 proof is in
    // allocate-inventory.use-case.integration.spec.ts. This asserts no
    // double-booking.
    const loserStatus = statuses.find((status) => status !== 201);
    expect([409, 422]).toContain(loserStatus);

    const orders = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { warehouseId },
    });
    expect(orders).toHaveLength(1);
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
    // SPEC 08: the 402 names the declined order so a client can open it.
    expect(asProblem(res.body).orderId).toBe(orders[0].id);

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
  });

  it('502: card ...0004 times out at the provider — order stays PENDING_PAYMENT, reservation intact', async () => {
    const { productId, warehouseId } = await makeFixture();
    const idempotencyKey = randomUUID();

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(validBody(productId, { payment: { cardNumber: TIMEOUT_CARD } }))
      .expect(502);

    const problem = asProblem(res.body);
    expect(problem.status).toBe(502);

    // The 502 body carries orderId so the client polls GET /orders/:id
    // instead of retrying with a new key.
    expect(problem.orderId).toBeDefined();
    expect(problem.detail).toContain(`poll GET /orders/${problem.orderId}`);

    const orders = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { warehouseId },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('PENDING_PAYMENT');
    expect(orders[0].id).toBe(problem.orderId);

    const persistedPayment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ orderId: orders[0].id });
    expect(persistedPayment.status).toBe('UNKNOWN');

    const getRes = await request(app.getHttpServer())
      .get(`/orders/${problem.orderId}`)
      .expect(200);
    expect(asOrder(getRes.body).status).toBe('PENDING_PAYMENT');

    // A replay with the same key returns the identical body — including
    // the same orderId — never a second order or charge.
    const replay = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(validBody(productId, { payment: { cardNumber: TIMEOUT_CARD } }))
      .expect(502);
    expect(replay.body).toEqual(res.body);

    const ordersAfterReplay = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).find({ where: { warehouseId } });
    expect(ordersAfterReplay).toHaveLength(1);
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

  it('GET /orders/:id/timeline: a confirmed order shows idempotency → reserve → charge → settle, with no card data', async () => {
    const { productId } = await makeFixture();

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/orders/${asOrder(created.body).id}/timeline`)
      .expect(200);

    const timeline = asTimeline(res.body);
    expect(timeline.status).toBe('CONFIRMED');
    const phases = new Set(timeline.events.map((event) => event.phase));
    for (const phase of ['IDEMPOTENCY', 'RESERVE', 'CHARGE', 'SETTLE']) {
      expect(phases.has(phase as never)).toBe(true);
    }
    const kinds = timeline.events.map((event) => event.kind);
    expect(kinds.indexOf('INVENTORY_COMMIT')).toBeLessThan(
      kinds.indexOf('ORDER_CONFIRMED'),
    );
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(APPROVED_CARD);
    expect(json).not.toContain('raw_response');
  });

  it('GET /orders/:id/timeline: a declined order ends in RELEASE + PAYMENT_FAILED', async () => {
    const { productId, warehouseId } = await makeFixture();

    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send(validBody(productId, { payment: { cardNumber: DECLINED_CARD } }))
      .expect(402);
    const [order] = await AppDataSource.getRepository(OrderOrmEntity).find({
      where: { warehouseId },
    });

    const res = await request(app.getHttpServer())
      .get(`/orders/${order.id}/timeline`)
      .expect(200);

    const timeline = asTimeline(res.body);
    expect(timeline.correlationId).toEqual(expect.any(String));
    expect(timeline.events.slice(-2).map((event) => event.kind)).toEqual([
      'INVENTORY_RELEASE',
      'ORDER_PAYMENT_FAILED',
    ]);
  });

  it('GET /orders/:id/timeline: an unknown or malformed id is 404', async () => {
    await request(app.getHttpServer())
      .get(`/orders/${randomUUID()}/timeline`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/orders/not-a-uuid/timeline')
      .expect(404);
  });
});
