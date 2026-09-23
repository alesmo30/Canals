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
 * A non-UUID :id behaves like an unknown id (OrderNotFoundError, no DB
 * call). 'loose' UUID check because fixture ids aren't v4. All queries run
 * in parallel.
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
