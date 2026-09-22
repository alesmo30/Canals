import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { OrderNotFoundError } from './order-read.errors';
import {
  OrderDetailRow,
  OrderItemRow,
  OrdersReadRepository,
  PaymentAttemptRow,
  ShipmentRow,
} from '../../infrastructure/database/repositories/orders-read.repository';

export interface GetOrderResult {
  order: OrderDetailRow;
  items: OrderItemRow[];
  payments: PaymentAttemptRow[];
  shipment: ShipmentRow | null;
}

/**
 * specs/06-read-side.md, step 8/Decisions — a `:id` with no UUID shape is
 * treated exactly like a well-formed but non-existent id: both throw
 * `OrderNotFoundError`, without a second `400` branch and without
 * reaching the database for a malformed id. `'loose'` — same reasoning as
 * CreateOrderDto's `productId`/`customerId` (this codebase's own fixed
 * test/seed ids are readable, non-v4 "uuid-shaped" strings).
 *
 * Items come from `findItemsByOrderIds` (step 4) — the response's
 * `items` field (Decisions, DTOs de respuesta) has no other source, so
 * this joins step 4's query to the three from step 7, still all
 * independent and run together.
 */
@Injectable()
export class GetOrderService {
  constructor(private readonly ordersReadRepository: OrdersReadRepository) {}

  async execute(id: string): Promise<GetOrderResult> {
    if (!isUUID(id, 'loose')) {
      throw new OrderNotFoundError(id);
    }

    const [order, items, payments, shipment] = await Promise.all([
      this.ordersReadRepository.findOrderById(id),
      this.ordersReadRepository.findItemsByOrderIds([id]),
      this.ordersReadRepository.findPaymentsByOrderId(id),
      this.ordersReadRepository.findShipmentByOrderId(id),
    ]);

    if (!order) {
      throw new OrderNotFoundError(id);
    }

    return { order, items, payments, shipment };
  }
}
