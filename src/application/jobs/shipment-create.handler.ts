import { Injectable } from '@nestjs/common';

import { JobHandler } from './job-handler';
import { ShipmentService } from './shipment.service';
import { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

/**
 * SPEC 04 Scope: creates the shipment via `ShipmentService`
 * (`infrastructure.md` §3's own worked example for this exact handler).
 * A thrown error (order not found, null `warehouse_id`) is left to
 * pg-boss's retry/dead-letter mechanism (step 6) — this handler does not
 * catch it.
 */
@Injectable()
export class ShipmentCreateHandler implements JobHandler<OrderConfirmedPayload> {
  readonly queue = 'shipment.create';

  constructor(private readonly shipments: ShipmentService) {}

  async handle({ orderId }: OrderConfirmedPayload): Promise<void> {
    await this.shipments.createForOrder(orderId);
  }
}
