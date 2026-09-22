import { randomUUID } from 'crypto';

import { Logger } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

import {
  PaymentReconciliationHandler,
  RECONCILIATION_GRACE_MINUTES,
} from './payment-reconciliation.handler';
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

/** Answers getStatus() from a fixed map, keyed by idempotencyKey — set up per test. charge() is never called by reconciliation. */
class FakePaymentGateway implements PaymentGateway {
  private readonly statusByKey = new Map<string, ChargeResult>();

  stub(idempotencyKey: string, result: ChargeResult): void {
    this.statusByKey.set(idempotencyKey, result);
  }

  charge(): Promise<ChargeResult> {
    throw new Error(
      'FakePaymentGateway.charge() is not used by reconciliation',
    );
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
 * specs/07-hardening-demo.md, R6.2 — integration test: DATABASE_URL,
 * PAYMENTS_URL and OTEL_EXPORTER_OTLP_ENDPOINT exported, a migrated
 * Postgres reachable. Builds its own unsettled-payment fixtures directly
 * (randomUUID-scoped).
 */
describe('PaymentReconciliationHandler (integration)', () => {
  let boss: PgBoss;
  let paymentGateway: FakePaymentGateway;
  let handler: PaymentReconciliationHandler;
  let warnSpy: jest.SpyInstance;

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
    handler = new PaymentReconciliationHandler(
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
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  /** An order PENDING_PAYMENT with an unsettled payments row, `created_at` back-dated by `minutesOld`. */
  async function makeUnsettledPayment(params: {
    minutesOld: number;
    status?: 'PENDING' | 'UNKNOWN';
    idempotencyKey?: string;
  }) {
    const {
      minutesOld,
      status = 'UNKNOWN',
      idempotencyKey = `order:${randomUUID()}:attempt:1`,
    } = params;

    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Reconciliation Test Customer',
    });
    const product = await AppDataSource.getRepository(ProductOrmEntity).save({
      sku: `SKU-${randomUUID()}`,
      name: 'Reconciliation Test Product',
      condition: 'NEW',
      unitPriceCents: 1000,
      isActive: true,
    });
    const warehouse = await AppDataSource.getRepository(
      WarehouseOrmEntity,
    ).save({
      name: `Reconciliation Test WH ${randomUUID()}`,
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
      // Far in the future — reconciliation does not look at this field;
      // only the reaper does.
      reservationExpiresAt: new Date(Date.now() + 15 * 60_000),
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

    const paymentId = randomUUID();
    const createdAt = new Date(Date.now() - minutesOld * 60_000);
    await AppDataSource.getRepository(PaymentOrmEntity).save({
      id: paymentId,
      orderId,
      attempt: 1,
      provider: 'mock-gateway',
      providerPaymentId: null,
      idempotencyKey,
      status,
      amountCents: 2000,
      currency: 'USD',
      cardLast4: null,
      cardBrand: null,
      failureCode: status === 'UNKNOWN' ? 'TIMEOUT' : null,
      rawResponse: null,
      settledAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    // save() would otherwise let TypeORM's default overwrite createdAt —
    // set it explicitly with a raw UPDATE to be sure it stuck.
    await AppDataSource.getRepository(PaymentOrmEntity).update(paymentId, {
      createdAt,
    });

    return {
      orderId,
      paymentId,
      warehouseId: warehouse.id,
      productId: product.id,
      idempotencyKey,
    };
  }

  const OLD_ENOUGH_MINUTES = RECONCILIATION_GRACE_MINUTES + 3;

  it('getStatus() -> CAPTURED: settles the payment, confirms the order', async () => {
    const { orderId, paymentId, warehouseId, productId, idempotencyKey } =
      await makeUnsettledPayment({ minutesOld: OLD_ENOUGH_MINUTES });
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({
        status: 'CAPTURED',
        providerPaymentId: 'ch_reconcile_1',
      }),
    );

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('CONFIRMED');

    const payment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ id: paymentId });
    expect(payment.status).toBe('CAPTURED');
    expect(payment.settledAt).not.toBeNull();

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityReserved).toBe(0);
  });

  it('getStatus() -> DECLINED: settles the payment, fails the order, releases stock', async () => {
    const { orderId, paymentId, warehouseId, productId, idempotencyKey } =
      await makeUnsettledPayment({ minutesOld: OLD_ENOUGH_MINUTES });
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({ status: 'DECLINED', failureCode: 'CARD_DECLINED' }),
    );

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PAYMENT_FAILED');

    const payment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ id: paymentId });
    expect(payment.status).toBe('DECLINED');
    expect(payment.settledAt).not.toBeNull();

    const inventory = await AppDataSource.getRepository(
      InventoryOrmEntity,
    ).findOneByOrFail({ warehouseId, productId });
    expect(inventory.quantityAvailable).toBe(5);
    expect(inventory.quantityReserved).toBe(0);
  });

  it('getStatus() -> FAILED (NOT_FOUND): left to the reaper, nothing changes', async () => {
    const { orderId, paymentId, idempotencyKey } = await makeUnsettledPayment({
      minutesOld: OLD_ENOUGH_MINUTES,
    });
    paymentGateway.stub(
      idempotencyKey,
      chargeResult({ status: 'FAILED', failureCode: 'NOT_FOUND' }),
    );

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PENDING_PAYMENT');

    const payment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ id: paymentId });
    expect(payment.status).toBe('UNKNOWN');
    expect(payment.settledAt).toBeNull();
  });

  it('getStatus() -> UNKNOWN: left to the reaper, nothing changes', async () => {
    const { orderId, paymentId, idempotencyKey } = await makeUnsettledPayment({
      minutesOld: OLD_ENOUGH_MINUTES,
    });
    paymentGateway.stub(idempotencyKey, chargeResult({ status: 'UNKNOWN' }));

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PENDING_PAYMENT');

    const payment = await AppDataSource.getRepository(
      PaymentOrmEntity,
    ).findOneByOrFail({ id: paymentId });
    expect(payment.settledAt).toBeNull();
  });

  it('a payment younger than the grace period is not selected', async () => {
    const { orderId, paymentId } = await makeUnsettledPayment({
      minutesOld: RECONCILIATION_GRACE_MINUTES - 1,
    });
    // No stub registered — if this payment were selected, getStatus()
    // would throw "no stub" and the failure would show up as a warn line.

    await handler.handle();

    const order = await AppDataSource.getRepository(
      OrderOrmEntity,
    ).findOneByOrFail({ id: orderId });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(
      warnSpy.mock.calls.some(
        ([arg]: [Record<string, unknown>]) => arg.paymentId === paymentId,
      ),
    ).toBe(false);
  });
});
