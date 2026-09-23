/**
 * Response shapes mirrored from the backend DTOs
 * (src/infrastructure/http/dto/*.ts). Hand-copied: web/ is a separate
 * package and never imports from src/.
 */

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED';

export interface Distance {
  meters: number;
  kilometers: number;
  miles: number;
}

export interface OrderWarehouse {
  id: string;
  name: string;
  distance: Distance | null;
}

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  unitPriceDollars: string;
}

export interface OrderResponse {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalCents: number;
  totalDollars: string;
  currency: string;
  paymentStatus: string;
  warehouse: OrderWarehouse;
  items: OrderItem[];
}

export interface PaymentAttempt {
  attempt: number;
  status: string;
  amountCents: number;
  amountDollars: string;
  currency: string;
  failureCode: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface Shipment {
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderDetailResponse {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouse: OrderWarehouse | null;
  items: OrderItem[];
  payments: PaymentAttempt[];
  shipment: Shipment | null;
  totalCents: number;
  totalDollars: string;
  currency: string;
  createdAt: string;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  warehouseId: string | null;
  totalCents: number;
  totalDollars: string;
  currency: string;
  createdAt: string;
  items: OrderItem[];
}

export interface OrderListResponse {
  items: OrderListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
  errors?: { field: string; message: string }[];
  orderId?: string;
}

export type TimelinePhase =
  | 'IDEMPOTENCY'
  | 'RESERVE'
  | 'CHARGE'
  | 'SETTLE'
  | 'JOBS'
  | 'FULFILMENT';

export type TimelineOutcome = 'OK' | 'PENDING' | 'FAILED';

export interface TimelineEvent {
  at: string;
  phase: TimelinePhase;
  kind: string;
  title: string;
  outcome: TimelineOutcome;
  detail: Record<string, string | number | null>;
}

export interface OrderTimelineResponse {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  correlationId: string | null;
  events: TimelineEvent[];
}

export function isProblem(body: unknown): body is ProblemDetails {
  return (
    typeof body === 'object' &&
    body !== null &&
    'type' in body &&
    'title' in body &&
    'status' in body
  );
}
