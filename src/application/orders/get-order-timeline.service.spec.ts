import { randomUUID } from 'crypto';

import { GetOrderTimelineService } from './get-order-timeline.service';
import { OrderNotFoundError } from './order-read.errors';
import type {
  IdempotencyRecordRow,
  InventoryMovementTimelineRow,
  OrderJobRow,
  OrdersReadRepository,
  PaymentAttemptRow,
  ShipmentRow,
  TimelineOrderRow,
} from '../../infrastructure/database/repositories/orders-read.repository';

const T0 = new Date('2026-09-22T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

interface Fixture {
  order: TimelineOrderRow | null;
  idempotency?: IdempotencyRecordRow | null;
  movements?: InventoryMovementTimelineRow[];
  payments?: PaymentAttemptRow[];
  shipment?: ShipmentRow | null;
  jobs?: OrderJobRow[];
}

function makeService(fixture: Fixture) {
  const repository = {
    findTimelineOrderById: jest.fn().mockResolvedValue(fixture.order),
    findIdempotencyRecordByOrderId: jest
      .fn()
      .mockResolvedValue(fixture.idempotency ?? null),
    findInventoryMovementsByOrderId: jest
      .fn()
      .mockResolvedValue(fixture.movements ?? []),
    findPaymentsByOrderId: jest.fn().mockResolvedValue(fixture.payments ?? []),
    findShipmentByOrderId: jest
      .fn()
      .mockResolvedValue(fixture.shipment ?? null),
    findJobsByOrderId: jest.fn().mockResolvedValue(fixture.jobs ?? []),
  };
  return {
    service: new GetOrderTimelineService(
      repository as unknown as OrdersReadRepository,
    ),
    repository,
  };
}

function makeOrder(
  overrides: Partial<TimelineOrderRow> = {},
): TimelineOrderRow {
  return {
    id: randomUUID(),
    order_number: 'CNL-2026-000001',
    status: 'CONFIRMED',
    created_at: at(1),
    updated_at: at(3),
    reservation_expires_at: at(900),
    confirmed_at: at(3),
    cancelled_at: null,
    cancellation_reason: null,
    ...overrides,
  };
}

function movement(
  type: InventoryMovementTimelineRow['type'],
  seconds: number,
): InventoryMovementTimelineRow {
  return {
    type,
    quantity_delta: -1,
    available_after: 9,
    reserved_after: type === 'RESERVE' ? 1 : 0,
    reason: null,
    created_at: at(seconds),
    product_sku: 'APL-IP16-128-BLK',
    warehouse_name: 'Newark DC, NJ',
  };
}

function payment(
  status: PaymentAttemptRow['status'],
  seconds: number,
): PaymentAttemptRow {
  return {
    attempt: 1,
    status,
    amount_cents: '69900',
    currency: 'USD',
    failure_code: status === 'DECLINED' ? 'CARD_DECLINED' : null,
    settled_at: null,
    created_at: at(seconds),
  };
}

function job(
  queue: string,
  state: OrderJobRow['state'],
  seconds: number,
  correlationId: string | null = 'corr-jobs',
): OrderJobRow {
  return {
    id: randomUUID(),
    queue,
    state,
    retry_count: 0,
    retry_limit: 4,
    created_on: at(seconds),
    started_on: null,
    completed_on: state === 'completed' ? at(seconds + 1) : null,
    correlation_id: correlationId,
  };
}

describe('GetOrderTimelineService', () => {
  it('orders the happy path idempotency → reserve → charge → settle → jobs → fulfilment, COMMIT before CONFIRMED on a shared timestamp', async () => {
    const order = makeOrder();
    const { service } = makeService({
      order,
      idempotency: {
        state: 'COMPLETED',
        response_status: 201,
        created_at: at(0),
        correlation_id: null,
      },
      movements: [movement('RESERVE', 1), movement('COMMIT', 3)],
      payments: [payment('CAPTURED', 2)],
      jobs: [job('shipment.create', 'completed', 3)],
      shipment: {
        status: 'PENDING_DISPATCH',
        carrier: null,
        tracking_number: null,
        dispatched_at: null,
        delivered_at: null,
      },
    });

    const result = await service.execute(order.id);

    expect(result.events.map((event) => event.kind)).toEqual([
      'IDEMPOTENCY_KEY',
      'ORDER_CREATED',
      'INVENTORY_RESERVE',
      'PAYMENT_ATTEMPT',
      'INVENTORY_COMMIT',
      'ORDER_CONFIRMED',
      'JOB',
      'SHIPMENT',
    ]);
    expect(result.events.every((event) => event.outcome !== 'FAILED')).toBe(
      true,
    );
    // Shipment has no timestamp of its own until dispatch — it falls back
    // to the shipment.create job's completion.
    expect(result.events.at(-1)?.at).toEqual(at(4));
    expect(result.events.at(-1)?.outcome).toBe('PENDING');
  });

  it('declined path: RESERVE → payment FAILED → RELEASE → PAYMENT_FAILED', async () => {
    const order = makeOrder({
      status: 'PAYMENT_FAILED',
      confirmed_at: null,
      updated_at: at(3),
    });
    const { service } = makeService({
      order,
      movements: [movement('RESERVE', 1), movement('RELEASE', 3)],
      payments: [payment('DECLINED', 2)],
    });

    const { events } = await service.execute(order.id);

    expect(events.map((event) => [event.kind, event.outcome])).toEqual([
      ['ORDER_CREATED', 'OK'],
      ['INVENTORY_RESERVE', 'OK'],
      ['PAYMENT_ATTEMPT', 'FAILED'],
      ['INVENTORY_RELEASE', 'FAILED'],
      ['ORDER_PAYMENT_FAILED', 'FAILED'],
    ]);
  });

  it('an UNKNOWN payment leaves a PENDING attempt and an awaiting-settlement event', async () => {
    const order = makeOrder({
      status: 'PENDING_PAYMENT',
      confirmed_at: null,
    });
    const { service } = makeService({
      order,
      movements: [movement('RESERVE', 1)],
      payments: [payment('UNKNOWN', 2)],
    });

    const { events } = await service.execute(order.id);

    expect(
      events.find((event) => event.kind === 'PAYMENT_ATTEMPT')?.outcome,
    ).toBe('PENDING');
    expect(events.at(-1)).toMatchObject({
      kind: 'ORDER_AWAITING_SETTLEMENT',
      outcome: 'PENDING',
    });
  });

  it('a cancelled order carries its cancellation reason', async () => {
    const order = makeOrder({
      status: 'CANCELLED',
      confirmed_at: null,
      cancelled_at: at(900),
      cancellation_reason: 'RESERVATION_EXPIRED_NO_PAYMENT',
    });
    const { service } = makeService({ order });

    const { events } = await service.execute(order.id);

    expect(events.at(-1)).toMatchObject({
      kind: 'ORDER_CANCELLED',
      outcome: 'FAILED',
      detail: { reason: 'RESERVATION_EXPIRED_NO_PAYMENT' },
    });
  });

  it('a job in a dead-letter queue is FAILED even though its own state is created', async () => {
    const order = makeOrder();
    const { service } = makeService({
      order,
      jobs: [
        job('shipment.create', 'failed', 3),
        job('shipment.create.dlq', 'created', 60),
      ],
    });

    const { events } = await service.execute(order.id);
    const jobEvents = events.filter((event) => event.phase === 'JOBS');

    expect(jobEvents.map((event) => [event.kind, event.outcome])).toEqual([
      ['JOB', 'FAILED'],
      ['JOB_DEAD_LETTER', 'FAILED'],
    ]);
  });

  it('prefers the job meta correlationId over the idempotency error body, and falls back to it', async () => {
    const order = makeOrder();

    const withJobs = makeService({
      order,
      idempotency: {
        state: 'COMPLETED',
        response_status: 502,
        created_at: at(0),
        correlation_id: 'corr-idem',
      },
      jobs: [job('customer.notify', 'completed', 3, 'corr-jobs')],
    });
    expect((await withJobs.service.execute(order.id)).correlationId).toBe(
      'corr-jobs',
    );

    const withoutJobs = makeService({
      order,
      idempotency: {
        state: 'COMPLETED',
        response_status: 502,
        created_at: at(0),
        correlation_id: 'corr-idem',
      },
    });
    expect((await withoutJobs.service.execute(order.id)).correlationId).toBe(
      'corr-idem',
    );

    const neither = makeService({ order });
    expect((await neither.service.execute(order.id)).correlationId).toBeNull();
  });

  it('throws OrderNotFoundError for a malformed id without touching the repository', async () => {
    const { service, repository } = makeService({ order: makeOrder() });

    await expect(service.execute('not-a-uuid')).rejects.toThrow(
      OrderNotFoundError,
    );
    expect(repository.findTimelineOrderById).not.toHaveBeenCalled();
  });

  it('throws OrderNotFoundError when no order row exists', async () => {
    const { service } = makeService({ order: null });

    await expect(service.execute(randomUUID())).rejects.toThrow(
      OrderNotFoundError,
    );
  });
});
