import { Module } from '@nestjs/common';

import { SharedModule } from './shared.module';
import { JobRunner } from '../infrastructure/messaging/job-runner';
import { JOB_HANDLERS } from '../application/jobs/job-handler';
import { ShipmentCreateHandler } from '../application/jobs/shipment-create.handler';
import { ShipmentService } from '../application/jobs/shipment.service';
import { CustomerNotifyHandler } from '../application/jobs/customer-notify.handler';
import { AnalyticsRecordHandler } from '../application/jobs/analytics-record.handler';

/**
 * SharedModule + job handlers (infrastructure.md §3). main.worker.ts's
 * entrypoint (`await app.get(JobRunner).start()`). `JOB_HANDLERS` is a
 * multi-provider array so `JobRunner` stays at 3 constructor parameters
 * (references/coding-conventions.md) instead of one per handler.
 */
@Module({
  imports: [SharedModule.register('worker')],
  providers: [
    JobRunner,
    ShipmentService,
    ShipmentCreateHandler,
    CustomerNotifyHandler,
    AnalyticsRecordHandler,
    {
      provide: JOB_HANDLERS,
      inject: [
        ShipmentCreateHandler,
        CustomerNotifyHandler,
        AnalyticsRecordHandler,
      ],
      useFactory: (
        shipmentCreate: ShipmentCreateHandler,
        customerNotify: CustomerNotifyHandler,
        analyticsRecord: AnalyticsRecordHandler,
      ) => [shipmentCreate, customerNotify, analyticsRecord],
    },
  ],
})
export class WorkerModule {}
