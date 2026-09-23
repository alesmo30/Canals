import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  sortTimeline,
  toIdempotencyEvent,
  toIso,
  toJobEvent,
  toMovementEvent,
  toPaymentEvent,
  toShipmentEvent,
} from './helpers/timeline.helpers';
import { OrderNotFoundError } from './order-read.errors';
import type { TimelineEvent } from './order-timeline.types';
import {
  OrdersReadRepository,
  type TimelineOrderRow,
} from '../../infrastructure/database/repositories/orders-read.repository';

export interface GetOrderTimelineResult {
  order: TimelineOrderRow;
  correlationId: string | null;
  events: TimelineEvent[];
}

const SHIPMENT_QUEUE = 'shipment.create';

/**
 * specs/08-observability-console.md — `GET /orders/:id/timeline`. Same
 * 404 semantics as `GetOrderService` (SPEC 06 Decisions): a non-UUID id
 * never reaches the database. The six reads are independent, so they run
 * together.
 *
 * Events are pushed in saga order before sorting — several of them are
 * written in the same transaction and share a timestamp, and the stable
 * sort keeps that push order within a phase (e.g. COMMIT before
 * CONFIRMED).
 */
@Injectable()
export class GetOrderTimelineService {
  constructor(private readonly ordersReadRepository: OrdersReadRepository) {}

  async execute(id: string): Promise<GetOrderTimelineResult> {
    if (!isUUID(id, 'loose')) {
      throw new OrderNotFoundError(id);
    }

    const [order, idempotency, movements, payments, shipment, jobs] =
      await Promise.all([
        this.ordersReadRepository.findTimelineOrderById(id),
        this.ordersReadRepository.findIdempotencyRecordByOrderId(id),
        this.ordersReadRepository.findInventoryMovementsByOrderId(id),
        this.ordersReadRepository.findPaymentsByOrderId(id),
        this.ordersReadRepository.findShipmentByOrderId(id),
        this.ordersReadRepository.findJobsByOrderId(id),
      ]);

    if (!order) {
      throw new OrderNotFoundError(id);
    }

    const events: TimelineEvent[] = [];

    if (idempotency) {
      events.push(toIdempotencyEvent(idempotency));
    }

    events.push({
      at: order.created_at,
      phase: 'RESERVE',
      kind: 'ORDER_CREATED',
      title: 'Order created (PENDING_PAYMENT)',
      outcome: 'OK',
      detail: {
        orderNumber: order.order_number,
        reservationExpiresAt: toIso(order.reservation_expires_at),
      },
    });

    events.push(...movements.map(toMovementEvent));
    events.push(...payments.map(toPaymentEvent));

    // PAID has no timestamp of its own: it is transient inside the same
    // transaction that sets CONFIRMED (spec Decisions), so no PAID event.
    if (order.confirmed_at) {
      events.push({
        at: order.confirmed_at,
        phase: 'SETTLE',
        kind: 'ORDER_CONFIRMED',
        title: 'Order CONFIRMED',
        outcome: 'OK',
        detail: {},
      });
    }
    if (order.status === 'PAYMENT_FAILED') {
      events.push({
        at: order.updated_at,
        phase: 'SETTLE',
        kind: 'ORDER_PAYMENT_FAILED',
        title: 'Order PAYMENT_FAILED — stock released',
        outcome: 'FAILED',
        detail: {},
      });
    }
    if (order.cancelled_at) {
      events.push({
        at: order.cancelled_at,
        phase: 'SETTLE',
        kind: 'ORDER_CANCELLED',
        title: 'Order CANCELLED',
        outcome: 'FAILED',
        detail: { reason: order.cancellation_reason },
      });
    }
    // A 502 (provider error/timeout) leaves the order here until the
    // reaper or reconciliation job settles it.
    if (order.status === 'PENDING_PAYMENT') {
      events.push({
        at: order.updated_at,
        phase: 'SETTLE',
        kind: 'ORDER_AWAITING_SETTLEMENT',
        title: 'Awaiting payment settlement (reservation held)',
        outcome: 'PENDING',
        detail: {
          reservationExpiresAt: toIso(order.reservation_expires_at),
        },
      });
    }

    events.push(...jobs.map(toJobEvent));

    if (shipment) {
      const shipmentJob = jobs.find((job) => job.queue === SHIPMENT_QUEUE);
      const at =
        shipment.dispatched_at ??
        shipmentJob?.completed_on ??
        order.confirmed_at ??
        order.updated_at;
      events.push(toShipmentEvent(shipment, at));
    }

    // Job meta carries the request's correlationId on every confirmed
    // order; the idempotency record only has it for error responses.
    const correlationId =
      jobs.find((job) => job.correlation_id)?.correlation_id ??
      idempotency?.correlation_id ??
      null;

    return { order, correlationId, events: sortTimeline(events) };
  }
}
