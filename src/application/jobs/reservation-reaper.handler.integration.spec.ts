import { randomUUID } from 'crypto';

import { Logger } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

import {
  REAPER_ALERT_AFTER_MINUTES,
  ReservationReaperHandler,
} from './reservation-reaper.handler';
import { InventoryService } from '../allocation/inventory.service';
import { OrderSettlementService } from '../orders/order-settlement.service';
import type {
  ChargeResult,
  PaymentGateway,
} from '../../domain/ports/payment-gateway';
import { AppDataSource } from '../../infrastructure/database/data-source';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { InventoryOrmEntity } from '../../infrastructure/database/entities/inventory.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../../infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import { WarehouseOrmEntity } from '../../infrastructure/database/entities/warehouse.orm-entity';
import { setupQueues } from '../../infrastructure/messaging/queue-setup';
import { PgBossEventPublisher } from '../../infrastructure/messaging/pg-boss-event-publisher';

/** Answers getStatus() from a fixed map, keyed by idempotencyKey — set up per test. charge() is never called by the reaper. */
class FakePaymentGateway implements PaymentGateway {
  private readonly statusByKey = new Map<string, ChargeResult>();

  stub(idempotencyKey: string, result: ChargeResult): void {
    this.statusByKey.set(idempotencyKey, result);
  }

  charge(): Promise<ChargeResult> {
    throw new Error('FakePaymentGateway.charge() is not used by the reaper');
  }

  getStatus(idempotencyKey: string): Promise<ChargeResult> {
    const result = this.statusByKey.get(idempotencyKey);
    if (!result) {
      throw new Error(`FakePaymentGateway: no stub for ${idempotencyKey}`);
    }
    return Promise.resolve(result);
  }
}

function chargeResult(overrides: Partial<ChargeResult>): ChargeResult {
  return {
    status: 'UNKNOWN',
    providerPaymentId: null,
    cardLast4: null,
    cardBrand: null,
    failureCode: null,
    rawResponse: null,
    ...overrides,
  };
}

/**
 * specs/07-hardening-demo.md, R6.1 — integration test: DATABASE_URL,
 * PAYMENTS_URL and OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated
 * Postgres reachable. Builds its own expired-reservation fixtures
 * directly (randomUUID-scoped), one per outcome the table in the spec
 * describes.
 */
describe('ReservationReaperHandler (integration)', () => {
  let boss: PgBoss;
  let paymentGateway: FakePaymentGateway;
  let handler: ReservationReaperHandler;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    await AppDataSource.initialize();
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    await boss.start();
    await setupQueues(boss);
  });

  afterAll(async () => {
    await boss.stop();
    await AppDataSource.destroy();
  });

  beforeEach(() => {
    paymentGateway = new FakePaymentGateway();
    handler = new ReservationReaperHandler(
      AppDataSource,
      new OrderSettlementService(
        AppDataSource,
        new InventoryService(),
        new PgBossEventPublisher(boss),
      ),
      paymentGateway,
    );
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  /** An order past its reservation_expires_at, reserved (quantityReserved > 0), still PENDING_PAYMENT. */
  async function makeExpiredOrder(params: {
    minutesPastExpiry?: number;
    withPayment?: boolean;
    idempotencyKey?: string;
  }) {
    const {
      minutesPastExpiry = 5,
      withPayment = true,
      idempotencyKey = `order:${randomUUID()}:attempt:1`,
    } = params;

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Reaper Test Customer',
    });
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Reaper Test Product',
      condition: 'NEW',
      unitPriceCents: 1000,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Reaper Test WH ${randomUUID()}`,
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

    const orderId = randomUUID();
    const expiresAt = new Date(Date.now() - minutesPastExpiry * 60_000);
    await AppDataSource.getRepository(OrderOrmEntity).save({
      id: orderId,
      orderNumber: `CNL-TEST-${randomUUID().slice(0, 8)}`,
      customerId: customer.id,
      warehouseId: warehouse.id,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      totalCents: 2000,
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Broadway',
        city: 'New York',
        country: 'US',
      },
      shippingLocation: { type: 'Point', coordinates: [-74.0, 40.72] },
      reservationExpiresAt: expiresAt,
      confirmedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await AppDataSource.getRepository(OrderItemOrmEntity).save({
      id: randomUUID(),
      orderId,
      productId: product.id,
      quantity: 2,
      productSkuSnapshot: product.sku,
      productNameSnapshot: product.name,
      unitPriceCents: 1000,
    });

    await AppDataSource.transaction((manager) =>
      new InventoryService().reserve(manager, {
        orderId,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, quantity: 2 }],
      }),
    );
    // reserve() sets reservation_expires_at to "now + TTL" — overwrite it
    // back to the expired value this fixture needs.
    await AppDataSource.getRepository(OrderOrmEntity).update(orderId, {
      reservationExpiresAt: expiresAt,
    });

    let paymentId: string | null = null;
    if (withPayment) {
      paymentId = randomUUID();
      await AppDataSource.getRepository(PaymentOrmEntity).save({
        id: paymentId,
        orderId,
        attempt: 1,
        provider: 'mock-gateway',
        providerPaymentId: null,
        idempotencyKey,
        status: 'UNKNOWN',
        amountCents: 2000,
        currency: 'USD',
        cardLast4: null,
        cardBrand: null,
        failureCode: 'TIMEOUT',
        rawResponse: null,
        settledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return {
      orderId,
      warehouseId: warehouse.id,
      productId: product.id,
      paymentId,
      idempotencyKey,
    };
  }

  it('no payments row: cancels, releases the reservation back to available', async () => {
    const { orderId, warehouseId, productId } = await makeExpiredOrder({
      withPayment: false,
    });

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('CANCELLED');
    expect(order.cancellationReason).toBe('RESERVATION_EXPIRED_NO_PAYMENT');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
    expect(inventory.quantityReserved).toBe(0);
  });

  it('getStatus() -> CAPTURED: confirms the order, commits the reservation', async () => {
    const { orderId, warehouseId, productId, idempotencyKey } =
      await makeExpiredOrder({});
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({ status: 'CAPTURED', providerPaymentId: 'ch_reaper_1' }),
    );

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('CONFIRMED');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityReserved).toBe(0);
  });

  it('getStatus() -> DECLINED: fails the order, releases the reservation', async () => {
    const { orderId, warehouseId, productId, idempotencyKey } =
      await makeExpiredOrder({});
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({ status: 'DECLINED', failureCode: 'CARD_DECLINED' }),
    );

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PAYMENT_FAILED');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
    expect(inventory.quantityReserved).toBe(0);
  });

  it('getStatus() -> FAILED (404/NOT_FOUND): cancels, releases the reservation', async () => {
    const { orderId, warehouseId, productId, idempotencyKey } =
      await makeExpiredOrder({});
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({ status: 'FAILED', failureCode: 'NOT_FOUND' }),
    );

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('CANCELLED');
    expect(order.cancellationReason).toBe('RESERVATION_EXPIRED_NOT_CHARGED');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
    expect(inventory.quantityReserved).toBe(0);
  });

  it('getStatus() -> UNKNOWN, under the alert threshold: leaves it, warns, never releases', async () => {
    const { orderId, idempotencyKey } = await makeExpiredOrder({
      minutesPastExpiry: 5,
    });
    paymentGateway.stub(idempotencyKey, chargeResult({ status: 'UNKNOWN' }));

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reservation still UNKNOWN', orderId }),
    );
  });

  it('getStatus() -> UNKNOWN, past REAPER_ALERT_AFTER_MINUTES: leaves it, alerts with an error log', async () => {
    const { orderId, idempotencyKey } = await makeExpiredOrder({
      minutesPastExpiry: REAPER_ALERT_AFTER_MINUTES + 5,
    });
    paymentGateway.stub(idempotencyKey, chargeResult({ status: 'UNKNOWN' }));

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reservation unresolved', orderId }),
    );
  });

  it('a non-expired order is left untouched', async () => {
    const { orderId, warehouseId, productId } = await makeExpiredOrder({
      minutesPastExpiry: -10, // in the future
      withPayment: false,
    });

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PENDING_PAYMENT');

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityReserved).toBe(2);
  });

  it("one order's getStatus() failure is logged and does not stop the others", async () => {
    const failing = await makeExpiredOrder({
      idempotencyKey: `unstubbed-key-${randomUUID()}`,
    });
    const { orderId: capturedOrderId, idempotencyKey } = await makeExpiredOrder(
      {},
    );
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({ status: 'CAPTURED', providerPaymentId: 'ch_reaper_2' }),
    );

    await handler.handle();

    const capturedOrder = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: capturedOrderId });
    expect(capturedOrder.status).toBe('CONFIRMED');

    const failingOrder = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: failing.orderId });
    expect(failingOrder.status).toBe('PENDING_PAYMENT');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reservation reap failed',
        orderId: failing.orderId,
      }),
    );
  });
});
