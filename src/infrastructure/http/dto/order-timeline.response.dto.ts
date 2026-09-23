import type { GetOrderTimelineResult } from '../../../application/orders/get-order-timeline.service';
import type {
  TimelineDetail,
  TimelineOutcome,
  TimelinePhase,
} from '../../../application/orders/order-timeline.types';
import type { OrderStatus } from '../../../domain/enum-types/order-status';

export interface OrderTimelineEvent {
  at: string;
  phase: TimelinePhase;
  kind: string;
  title: string;
  outcome: TimelineOutcome;
  detail: TimelineDetail;
}

export interface OrderTimelineResponse {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  correlationId: string | null;
  events: OrderTimelineEvent[];
}

/**
 * specs/08-observability-console.md — explicit projection, field by field
 * (same rule as SPEC 06's DTOs): nothing from the rows beyond what the
 * contract names can reach the response.
 */
export function toOrderTimelineResponse(
  result: GetOrderTimelineResult,
): OrderTimelineResponse {
  return {
    orderId: result.order.id,
    orderNumber: result.order.order_number,
    status: result.order.status,
    correlationId: result.correlationId,
    events: result.events.map((event) => ({
      at: event.at.toISOString(),
      phase: event.phase,
      kind: event.kind,
      title: event.title,
      outcome: event.outcome,
      detail: { ...event.detail },
    })),
  };
}
