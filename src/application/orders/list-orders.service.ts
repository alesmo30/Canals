import { BadRequestException, Injectable } from '@nestjs/common';

import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from './helpers/cursor.helpers';
import type { OrderStatus } from '../../domain/enum-types/order-status';
import {
  OrderItemRow,
  OrderRow,
  OrdersReadRepository,
} from '../../infrastructure/database/repositories/orders-read.repository';

const DEFAULT_PAGE_SIZE = 20;

export interface ListOrdersParams {
  customerId?: string;
  status?: OrderStatus;
  warehouseId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  cursor?: string;
  pageSize?: number;
}

export interface ListOrdersOrder {
  order: OrderRow;
  items: OrderItemRow[];
}

export interface ListOrdersResult {
  orders: ListOrdersOrder[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * specs/06-read-side.md, step 5 — orchestrates the two queries from
 * OrdersReadRepository behind `GET /orders`: `hasMore` comes from the
 * `LIMIT pageSize + 1` lookahead (step 4's Decisions), and `nextCursor` is
 * built from the last *retained* row, never the lookahead row.
 */
@Injectable()
export class ListOrdersService {
  constructor(private readonly ordersReadRepository: OrdersReadRepository) {}

  async execute(params: ListOrdersParams): Promise<ListOrdersResult> {
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const cursor = params.cursor
      ? this.decodeCursorOrThrow(params.cursor)
      : undefined;

    const rows = await this.ordersReadRepository.findPage({
      customerId: params.customerId,
      status: params.status,
      warehouseId: params.warehouseId,
      createdAtFrom: params.createdAtFrom
        ? new Date(params.createdAtFrom)
        : undefined,
      createdAtTo: params.createdAtTo
        ? new Date(params.createdAtTo)
        : undefined,
      cursor,
      pageSize,
    });

    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

    const items = await this.ordersReadRepository.findItemsByOrderIds(
      pageRows.map((row) => row.id),
    );
    const itemsByOrderId = new Map<string, OrderItemRow[]>();
    for (const item of items) {
      const existing = itemsByOrderId.get(item.order_id);
      if (existing) {
        existing.push(item);
      } else {
        itemsByOrderId.set(item.order_id, [item]);
      }
    }

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null;

    return {
      orders: pageRows.map((row) => ({
        order: row,
        items: itemsByOrderId.get(row.id) ?? [],
      })),
      hasMore,
      nextCursor,
    };
  }

  /**
   * specs/06-read-side.md, cursor.helpers.ts's Decisions — an invalid
   * cursor is "the same bucket as an invalid query param", not a new
   * problem-details case: rethrown as BadRequestException so the existing
   * filter branch handles it.
   */
  private decodeCursorOrThrow(cursor: string): { createdAt: Date; id: string } {
    try {
      return decodeCursor(cursor);
    } catch (error: unknown) {
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException(`Invalid cursor: ${cursor}`);
      }
      throw error;
    }
  }
}
