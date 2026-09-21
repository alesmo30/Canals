import { Injectable, Logger } from '@nestjs/common';

import { JobHandler } from './job-handler';
import { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

/**
 * SPEC 04 Scope: "logs a structured 'notification sent' event". No real
 * email sink — nothing leaves the process (Decisions, "The event
 * contract" / "Out of scope").
 */
@Injectable()
export class CustomerNotifyHandler implements JobHandler<OrderConfirmedPayload> {
  readonly queue = 'customer.notify';
  private readonly logger = new Logger(CustomerNotifyHandler.name);

  handle(payload: OrderConfirmedPayload): Promise<void> {
    this.logger.log({
      event: 'notification sent',
      queue: this.queue,
      orderId: payload.orderId,
    });
    return Promise.resolve();
  }
}
