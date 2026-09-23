import { Injectable, Logger } from '@nestjs/common';

import { withJobSpan } from './helpers/tracing.helper';
import { JobHandler } from './job-handler';
import { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

/** Logs a structured "notification sent" event; no real email sink — nothing leaves the process. */
@Injectable()
export class CustomerNotifyHandler implements JobHandler<OrderConfirmedPayload> {
  readonly queue = 'customer.notify';
  private readonly logger = new Logger(CustomerNotifyHandler.name);

  handle(payload: OrderConfirmedPayload): Promise<void> {
    return withJobSpan(
      'notify customer',
      () => {
        this.logger.log({
          event: 'notification sent',
          queue: this.queue,
          orderId: payload.orderId,
        });
        return Promise.resolve();
      },
      { 'app.order_id': payload.orderId },
    );
  }
}
