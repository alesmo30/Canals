import { Module } from '@nestjs/common';

import { SharedModule } from './shared.module';
import { JobRunner } from '../infrastructure/messaging/job-runner';
import { JOB_HANDLERS } from '../application/jobs/job-handler';
import { ShipmentCreateHandler } from '../application/jobs/shipment-create.handler';
import { ShipmentService } from '../application/jobs/shipment.service';
import { CustomerNotifyHandler } from '../application/jobs/customer-notify.handler';
import { AnalyticsRecordHandler } from '../application/jobs/analytics-record.handler';
import { ReservationReaperHandler } from '../application/jobs/reservation-reaper.handler';
import { PaymentReconciliationHandler } from '../application/jobs/payment-reconciliation.handler';
import { InventoryService } from '../application/allocation/inventory.service';
import { OrderSettlementService } from '../application/orders/order-settlement.service';

/**
 * SharedModule + job handlers. JOB_HANDLERS is a multi-provider array so
 * JobRunner stays at 3 constructor parameters.
 */
@Module({
  imports: [SharedModule.register('worker')],
  providers: [
    JobRunner,
    ShipmentService,
    ShipmentCreateHandler,
    CustomerNotifyHandler,
    AnalyticsRecordHandler,
    InventoryService,
    OrderSettlementService,
    ReservationReaperHandler,
    PaymentReconciliationHandler,
    {
      provide: JOB_HANDLERS,
      inject: [
        ShipmentCreateHandler,
        CustomerNotifyHandler,
        AnalyticsRecordHandler,
        ReservationReaperHandler,
        PaymentReconciliationHandler,
      ],
      useFactory: (
        shipmentCreate: ShipmentCreateHandler,
        customerNotify: CustomerNotifyHandler,
        analyticsRecord: AnalyticsRecordHandler,
        reservationReaper: ReservationReaperHandler,
        paymentReconciliation: PaymentReconciliationHandler,
      ) => [
        shipmentCreate,
        customerNotify,
        analyticsRecord,
        reservationReaper,
        paymentReconciliation,
      ],
    },
  ],
})
export class WorkerModule {}
