import { Injectable, Logger } from '@nestjs/common';

import { JobHandler } from './job-handler';
import { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

/**
 * SPEC 04 step 4 — placeholder: logs and returns. Step 5 replaces the body
 * with the real `INSERT INTO shipments ... ON CONFLICT (order_id) DO
 * NOTHING` via `ShipmentService` (Scope's queue/handler table).
 */
@Injectable()
export class ShipmentCreateHandler implements JobHandler<OrderConfirmedPayload> {
  readonly queue = 'shipment.create';
  private readonly logger = new Logger(ShipmentCreateHandler.name);

  handle(payload: OrderConfirmedPayload): Promise<void> {
    this.logger.log({
      queue: this.queue,
      orderId: payload.orderId,
    });
    return Promise.resolve();
  }
}
