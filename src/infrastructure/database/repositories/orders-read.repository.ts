import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { OrderStatus } from '../../../domain/enum-types/order-status';

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

const ORDER_ROW_COLUMNS =
  'id, order_number, customer_id, warehouse_id, status, currency, total_cents, created_at';

@Injectable()
export class OrdersReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * specs/06-read-side.md, Decisions — the WHERE clause is an array of
   * parameterized fragments assembled in TypeScript, not a static .sql
   * file: R5.3's filters are optional and combinable, so no single fixed
   * statement can express every subset. The cursor condition is a real
   * Postgres row comparison (`(created_at, id) < (...)`), not two `OR`
   * branches, so a `created_at` tie resolves correctly by `id`. `LIMIT
   * pageSize + 1` is the lookahead the service (step 5) uses to compute
   * `hasMore` without a second `COUNT(*)` query.
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
   * `WHERE order_id = ANY($1)` — one query for the whole page, grouped by
   * `order_id` in the service (R5.4). The explicit `::uuid[]` cast is
   * what keeps this valid SQL when `orderIds` is empty (an empty page),
   * rather than relying on the driver to infer the array's element type.
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
}
