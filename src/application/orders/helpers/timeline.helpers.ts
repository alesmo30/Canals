import type {
  IdempotencyRecordRow,
  InventoryMovementTimelineRow,
  OrderJobRow,
  PaymentAttemptRow,
  ShipmentRow,
} from '../../../infrastructure/database/repositories/orders-read.repository';
import { QUEUE_TOPOLOGY } from '../../../infrastructure/messaging/queue-setup';
import {
  TIMELINE_PHASES,
  type TimelineEvent,
  type TimelineOutcome,
} from '../order-timeline.types';

/**
 * specs/08-observability-console.md — mechanical row → event mappers for
 * `GetOrderTimelineService`. Which events exist for the order itself, and
 * which correlation source wins, are decisions and stay in the service
 * (references/coding-conventions.md).
 */

const DEAD_LETTER_QUEUES: ReadonlySet<string> = new Set(
  QUEUE_TOPOLOGY.map(({ deadLetter }) => deadLetter),
);

const PAYMENT_OUTCOME: Record<PaymentAttemptRow['status'], TimelineOutcome> = {
  CAPTURED: 'OK',
  AUTHORIZED: 'OK',
  REFUNDED: 'OK',
  PENDING: 'PENDING',
  UNKNOWN: 'PENDING',
  DECLINED: 'FAILED',
  FAILED: 'FAILED',
};

const MOVEMENT_VERB: Record<InventoryMovementTimelineRow['type'], string> = {
  RESERVE: 'Reserved',
  COMMIT: 'Committed',
  RELEASE: 'Released',
  RESTOCK: 'Restocked',
  ADJUST: 'Adjusted',
};

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toIdempotencyEvent(row: IdempotencyRecordRow): TimelineEvent {
  const inProgress = row.state === 'IN_PROGRESS';
  return {
    at: row.created_at,
    phase: 'IDEMPOTENCY',
    kind: 'IDEMPOTENCY_KEY',
    title: inProgress
      ? 'Idempotency key claimed — request still in progress'
      : `Idempotency key recorded — response ${row.response_status}`,
    outcome: inProgress ? 'PENDING' : 'OK',
    detail: { state: row.state, responseStatus: row.response_status },
  };
}

/**
 * RESERVE is the forward step of the reserve phase; COMMIT/RELEASE are how
 * settlement resolves it. A RELEASE is always the compensating path
 * (declined payment, expired reservation), so it is shown as FAILED.
 */
export function toMovementEvent(
  row: InventoryMovementTimelineRow,
): TimelineEvent {
  const quantity = Math.abs(row.quantity_delta);
  return {
    at: row.created_at,
    phase: row.type === 'RESERVE' ? 'RESERVE' : 'SETTLE',
    kind: `INVENTORY_${row.type}`,
    title: `${MOVEMENT_VERB[row.type]} ${quantity} × ${row.product_sku} at ${row.warehouse_name}`,
    outcome: row.type === 'RELEASE' ? 'FAILED' : 'OK',
    detail: {
      sku: row.product_sku,
      warehouse: row.warehouse_name,
      quantity,
      availableAfter: row.available_after,
      reservedAfter: row.reserved_after,
      reason: row.reason,
    },
  };
}

export function toPaymentEvent(row: PaymentAttemptRow): TimelineEvent {
  return {
    at: row.created_at,
    phase: 'CHARGE',
    kind: 'PAYMENT_ATTEMPT',
    title: `Payment attempt #${row.attempt} ${row.status}`,
    outcome: PAYMENT_OUTCOME[row.status],
    detail: {
      attempt: row.attempt,
      status: row.status,
      amountCents: Number(row.amount_cents),
      currency: row.currency,
      failureCode: row.failure_code,
      settledAt: toIso(row.settled_at),
    },
  };
}

export function toJobEvent(row: OrderJobRow): TimelineEvent {
  const deadLettered = DEAD_LETTER_QUEUES.has(row.queue);
  let outcome: TimelineOutcome = 'PENDING';
  if (deadLettered || row.state === 'failed' || row.state === 'cancelled') {
    outcome = 'FAILED';
  } else if (row.state === 'completed') {
    outcome = 'OK';
  }

  return {
    at: row.completed_on ?? row.started_on ?? row.created_on,
    phase: 'JOBS',
    kind: deadLettered ? 'JOB_DEAD_LETTER' : 'JOB',
    title: deadLettered
      ? `${row.queue} — dead-lettered (${row.state})`
      : `${row.queue} ${row.state}`,
    outcome,
    detail: {
      queue: row.queue,
      state: row.state,
      retryCount: row.retry_count,
      retryLimit: row.retry_limit,
      createdOn: toIso(row.created_on),
      startedOn: toIso(row.started_on),
      completedOn: toIso(row.completed_on),
    },
  };
}

export function toShipmentEvent(row: ShipmentRow, at: Date): TimelineEvent {
  return {
    at,
    phase: 'FULFILMENT',
    kind: 'SHIPMENT',
    title: `Shipment ${row.status}`,
    outcome:
      row.status === 'CANCELLED'
        ? 'FAILED'
        : row.status === 'PENDING_DISPATCH'
          ? 'PENDING'
          : 'OK',
    detail: {
      status: row.status,
      carrier: row.carrier,
      trackingNumber: row.tracking_number,
      dispatchedAt: toIso(row.dispatched_at),
      deliveredAt: toIso(row.delivered_at),
    },
  };
}

/**
 * Ascending by time; ties (same-transaction writes) by TIMELINE_PHASES
 * order. `Array.prototype.sort` is stable, so events of the same phase and
 * instant keep the order the service pushed them in.
 */
export function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      TIMELINE_PHASES.indexOf(a.phase) - TIMELINE_PHASES.indexOf(b.phase),
  );
}
