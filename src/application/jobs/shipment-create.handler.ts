import { Injectable } from '@nestjs/common';

import { withJobSpan } from './helpers/tracing.helper';
import { JobHandler } from './job-handler';
import { ShipmentService } from './shipment.service';
import { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

/**
 * Errors (missing order, null warehouse_id) are left to pg-boss
 * retry/dead-letter.
 */
@Injectable()
export class ShipmentCreateHandler implements JobHandler<OrderConfirmedPayload> {
  readonly queue = 'shipment.create';

  constructor(private readonly shipments: ShipmentService) {}

  async handle({ orderId }: OrderConfirmedPayload): Promise<void> {
    await withJobSpan(
      'create shipment',
      () => this.shipments.createForOrder(orderId),
      { 'app.order_id': orderId },
    );
  }
}
