import { Injectable, Logger } from '@nestjs/common';

import { JobHandler } from './job-handler';
import { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

/**
 * SPEC 04 Scope: "logs a structured domain event". No real analytics sink —
 * nothing leaves the process (Decisions, "The event contract" / "Out of
 * scope").
 */
@Injectable()
export class AnalyticsRecordHandler implements JobHandler<OrderConfirmedPayload> {
  readonly queue = 'analytics.record';
  private readonly logger = new Logger(AnalyticsRecordHandler.name);

  handle(payload: OrderConfirmedPayload): Promise<void> {
    this.logger.log({
      event: 'order.confirmed',
      queue: this.queue,
      orderId: payload.orderId,
    });
    return Promise.resolve();
  }
}
