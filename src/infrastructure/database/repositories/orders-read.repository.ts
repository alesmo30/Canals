import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { OrderStatus } from '../../../domain/enum-types/order-status';
import type { PaymentStatus } from '../../../domain/enum-types/payment-status';
import type { ShipmentStatus } from '../../../domain/enum-types/shipment-status';

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
  cursor?: { createdAt: Date; id: string };
  pageSize: number;
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

const ORDER_ROW_COLUMNS =
  'id, order_number, customer_id, warehouse_id, status, currency, total_cents, created_at';

@Injectable()
export class OrdersReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * WHERE built from parameterized fragments (filters are optional and
   * combinable). The cursor uses a row comparison so `created_at` ties
   * resolve by `id`. `LIMIT pageSize + 1` gives `hasMore` without COUNT(*).
   */
  async findPage(filters: OrdersPageFilters): Promise<OrderRow[]> {
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
        `(created_at, id) < ($${params.length - 1}, $${params.length})`,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(filters.pageSize + 1);

    const rows: OrderRow[] = await this.dataSource.query(
      `SELECT ${ORDER_ROW_COLUMNS}
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
}
