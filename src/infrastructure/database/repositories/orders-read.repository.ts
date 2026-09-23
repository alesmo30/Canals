import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { OrderStatus } from '../../../domain/enum-types/order-status';
import type { PaymentStatus } from '../../../domain/enum-types/payment-status';
import type { ShipmentStatus } from '../../../domain/enum-types/shipment-status';
import { QUEUE_TOPOLOGY } from '../../messaging/queue-setup';

export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  warehouse_id: string | null;
  status: OrderStatus;
  currency: string;
  total_cents: string;
  created_at: Date;
}

export interface OrderItemRow {
  order_id: string;
  product_id: string;
  quantity: number;
  product_sku_snapshot: string;
  product_name_snapshot: string;
  unit_price_cents: string;
  created_at: Date;
}

export interface OrdersPageFilters {
  customerId?: string;
  status?: OrderStatus;
  warehouseId?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  cursor?: { createdAt: string; id: string };
  pageSize: number;
}

/** `cursor_created_at` keeps Postgres's microseconds, which `created_at: Date` loses. */
export interface OrderPageRow extends OrderRow {
  cursor_created_at: string;
}

export interface OrderDetailRow extends OrderRow {
  shipping_address: Record<string, unknown>;
  warehouse_name: string | null;
  distance_meters: number | null;
}

export interface PaymentAttemptRow {
  attempt: number;
  status: PaymentStatus;
  amount_cents: string;
  currency: string;
  failure_code: string | null;
  settled_at: Date | null;
  created_at: Date;
}

export interface ShipmentRow {
  status: ShipmentStatus;
  carrier: string | null;
  tracking_number: string | null;
  dispatched_at: Date | null;
  delivered_at: Date | null;
}

/** specs/08-observability-console.md — the order columns the lifecycle timeline reads. */
export interface TimelineOrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  created_at: Date;
  updated_at: Date;
  reservation_expires_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

export interface IdempotencyRecordRow {
  state: 'IN_PROGRESS' | 'COMPLETED';
  response_status: number | null;
  created_at: Date;
  /** Only error bodies (ProblemDetails) carry it — null for a 201. */
  correlation_id: string | null;
}

export interface InventoryMovementTimelineRow {
  type: 'RESERVE' | 'RELEASE' | 'COMMIT' | 'RESTOCK' | 'ADJUST';
  quantity_delta: number;
  available_after: number;
  reserved_after: number;
  reason: string | null;
  created_at: Date;
  product_sku: string;
  warehouse_name: string;
}

export interface OrderJobRow {
  id: string;
  queue: string;
  state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  retry_count: number;
  retry_limit: number;
  created_on: Date;
  started_on: Date | null;
  completed_on: Date | null;
  correlation_id: string | null;
}

/**
 * Every queue an `order.confirmed` fan-out job (or its dead-letter copy)
 * can live in. Derived from QUEUE_TOPOLOGY rather than re-listed, and
 * passed as `name = ANY($2)` so Postgres prunes `pgboss.job`'s
 * `LIST (name)` partitions before the JSON predicate runs.
 */
const ORDER_JOB_QUEUES: readonly string[] = QUEUE_TOPOLOGY.flatMap(
  ({ queue, deadLetter }) => [queue, deadLetter],
);

const ORDER_ROW_COLUMNS =
  'id, order_number, customer_id, warehouse_id, status, currency, total_cents, created_at';

const CURSOR_CREATED_AT_COLUMN = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`;

@Injectable()
export class OrdersReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * WHERE built from parameterized fragments (filters are optional and
   * combinable). The cursor uses a row comparison so `created_at` ties
   * resolve by `id`. `LIMIT pageSize + 1` gives `hasMore` without COUNT(*).
   */
  async findPage(filters: OrdersPageFilters): Promise<OrderPageRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.customerId) {
      params.push(filters.customerId);
      conditions.push(`customer_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.warehouseId) {
      params.push(filters.warehouseId);
      conditions.push(`warehouse_id = $${params.length}`);
    }
    if (filters.createdAtFrom) {
      params.push(filters.createdAtFrom);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filters.createdAtTo) {
      params.push(filters.createdAtTo);
      conditions.push(`created_at <= $${params.length}`);
    }
    if (filters.cursor) {
      params.push(filters.cursor.createdAt, filters.cursor.id);
      conditions.push(
        `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(filters.pageSize + 1);

    const rows: OrderPageRow[] = await this.dataSource.query(
      `SELECT ${ORDER_ROW_COLUMNS}, ${CURSOR_CREATED_AT_COLUMN}
       FROM orders
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows;
  }

  /**
   * One query for the whole page, grouped in the service. The `::uuid[]`
   * cast keeps it valid when `orderIds` is empty.
   */
  async findItemsByOrderIds(orderIds: string[]): Promise<OrderItemRow[]> {
    const rows: OrderItemRow[] = await this.dataSource.query(
      `SELECT order_id, product_id, quantity, product_sku_snapshot,
              product_name_snapshot, unit_price_cents, created_at
       FROM order_items
       WHERE order_id = ANY($1::uuid[])`,
      [orderIds],
    );

    return rows;
  }

  /**
   * LEFT JOIN warehouses: `warehouse_id` is nullable, so the order still
   * returns with null warehouse fields.
   */
  async findOrderById(id: string): Promise<OrderDetailRow | null> {
    const rows: OrderDetailRow[] = await this.dataSource.query(
      `SELECT o.id, o.order_number, o.customer_id, o.warehouse_id, o.status,
              o.currency, o.total_cents, o.created_at, o.shipping_address,
              w.name AS warehouse_name,
              ST_Distance(w.location, o.shipping_location) AS distance_meters
       FROM orders o
       LEFT JOIN warehouses w ON w.id = o.warehouse_id
       WHERE o.id = $1`,
      [id],
    );

    return rows[0] ?? null;
  }

  async findPaymentsByOrderId(orderId: string): Promise<PaymentAttemptRow[]> {
    const rows: PaymentAttemptRow[] = await this.dataSource.query(
      `SELECT attempt, status, amount_cents, currency, failure_code, settled_at, created_at
       FROM payments
       WHERE order_id = $1
       ORDER BY attempt ASC`,
      [orderId],
    );

    return rows;
  }

  async findShipmentByOrderId(orderId: string): Promise<ShipmentRow | null> {
    const rows: ShipmentRow[] = await this.dataSource.query(
      `SELECT status, carrier, tracking_number, dispatched_at, delivered_at
       FROM shipments
       WHERE order_id = $1`,
      [orderId],
    );

    return rows[0] ?? null;
  }

  async findTimelineOrderById(id: string): Promise<TimelineOrderRow | null> {
    const rows: TimelineOrderRow[] = await this.dataSource.query(
      `SELECT id, order_number, status, created_at, updated_at,
              reservation_expires_at, confirmed_at, cancelled_at,
              cancellation_reason
       FROM orders
       WHERE id = $1`,
      [id],
    );

    return rows[0] ?? null;
  }

  /**
   * `order_id` is only set once the saga has inserted the order, so a
   * request rejected before that (404/422 at resolve/reserve) has no row
   * here — the timeline simply has no IDEMPOTENCY event for it.
   */
  async findIdempotencyRecordByOrderId(
    orderId: string,
  ): Promise<IdempotencyRecordRow | null> {
    const rows: IdempotencyRecordRow[] = await this.dataSource.query(
      `SELECT state, response_status, created_at,
              response_body->>'correlationId' AS correlation_id
       FROM idempotency_keys
       WHERE order_id = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [orderId],
    );

    return rows[0] ?? null;
  }

  async findInventoryMovementsByOrderId(
    orderId: string,
  ): Promise<InventoryMovementTimelineRow[]> {
    const rows: InventoryMovementTimelineRow[] = await this.dataSource.query(
      `SELECT m.type, m.quantity_delta, m.available_after, m.reserved_after,
              m.reason, m.created_at,
              p.sku AS product_sku, w.name AS warehouse_name
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       JOIN warehouses w ON w.id = m.warehouse_id
       WHERE m.order_id = $1
       ORDER BY m.created_at ASC, m.id ASC`,
      [orderId],
    );

    return rows;
  }

  /**
   * specs/08-observability-console.md, Data sources — pg-boss 12 keeps
   * completed/failed jobs and DLQ copies in `pgboss.job` itself (no
   * `archive` table). Only the columns the timeline shows are selected:
   * never `data`/`output`, so no payload reaches the response by accident.
   */
  async findJobsByOrderId(orderId: string): Promise<OrderJobRow[]> {
    const rows: OrderJobRow[] = await this.dataSource.query(
      `SELECT id, name AS queue, state, retry_count, retry_limit,
              created_on, started_on, completed_on,
              data->'meta'->>'correlationId' AS correlation_id
       FROM pgboss.job
       WHERE name = ANY($2::text[])
         AND data->'payload'->>'orderId' = $1
       ORDER BY created_on ASC, name ASC`,
      [orderId, ORDER_JOB_QUEUES],
    );

    return rows;
  }
}
