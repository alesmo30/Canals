import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { OrderNotFoundError } from './order-read.errors';
import {
  OrderDetailRow,
  OrdersReadRepository,
  PaymentAttemptRow,
  ShipmentRow,
} from '../../infrastructure/database/repositories/orders-read.repository';

export interface GetOrderResult {
  order: OrderDetailRow;
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
 */
@Injectable()
export class GetOrderService {
  constructor(private readonly ordersReadRepository: OrdersReadRepository) {}

  async execute(id: string): Promise<GetOrderResult> {
    if (!isUUID(id, 'loose')) {
      throw new OrderNotFoundError(id);
    }

    // Independent queries (step 7) — no reason to serialize them.
    const [order, payments, shipment] = await Promise.all([
      this.ordersReadRepository.findOrderById(id),
      this.ordersReadRepository.findPaymentsByOrderId(id),
      this.ordersReadRepository.findShipmentByOrderId(id),
    ]);

    if (!order) {
      throw new OrderNotFoundError(id);
    }

    return { order, payments, shipment };
  }
}
