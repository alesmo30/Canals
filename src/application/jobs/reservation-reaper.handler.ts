import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { withJobSpan } from './helpers/tracing.helper';
import { JobHandler } from './job-handler';
import {
  OrderSettlementService,
  PaymentResolution,
} from '../orders/order-settlement.service';
import { PAYMENT_GATEWAY } from '../../domain/ports/payment-gateway';
import type { PaymentGateway } from '../../domain/ports/payment-gateway';

/** Selection query's own LIMIT — a batch bounded run over run, not the whole backlog at once. */
export const REAPER_BATCH_SIZE = 50;

/** Past expiry by this much and still UNKNOWN → alert on every run (the reaper keeps retrying after it alerts). */
export const REAPER_ALERT_AFTER_MINUTES = 30;

const MS_PER_MINUTE = 60_000;

interface ExpiredReservationRow {
  id: string;
  reservation_expires_at: Date;
  payment_id: string | null;
  idempotency_key: string | null;
}

/**
 * specs/07-hardening-demo.md, R6.1 — run every minute by the worker's
 * scheduler (queue-setup.ts's SCHEDULED_JOBS). Resolves every
 * `PENDING_PAYMENT` order whose reservation has expired, through
 * `OrderSettlementService` so it can never race the saga's Phase 3 or
 * reconciliation. One order's failure is logged and does not abort the
 * batch (Decisions) — a crash mid-batch is simply the next minute's run.
 */
@Injectable()
export class ReservationReaperHandler implements JobHandler<
  Record<string, unknown>
> {
  readonly queue = 'reservation.reap';
  private readonly logger = new Logger(ReservationReaperHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderSettlementService: OrderSettlementService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async handle(): Promise<void> {
    const rows = await withJobSpan('select expired reservations', () =>
      this.selectExpiredReservations(),
    );
    for (const row of rows) {
      try {
        await withJobSpan(
          'resolve reservation',
          () => this.resolveReservation(row),
          { 'app.order_id': row.id },
        );
      } catch (error) {
        this.logger.warn({
          event: 'reservation reap failed',
          orderId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Selection only — this transaction commits (and its `FOR UPDATE` lock
   * releases) the moment the query returns; `OrderSettlementService`
   * re-locks and re-checks each order's status itself, in its own
   * transaction, once this method's row is actually resolved
   * (specs/07-hardening-demo.md).
   */
  private async selectExpiredReservations(): Promise<ExpiredReservationRow[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: ExpiredReservationRow[] = await manager.query(
        `SELECT o.id, o.reservation_expires_at,
                p.id AS payment_id, p.idempotency_key
         FROM orders o
         LEFT JOIN LATERAL (
           SELECT id, idempotency_key FROM payments
           WHERE order_id = o.id ORDER BY attempt DESC LIMIT 1
         ) p ON true
         WHERE o.status = 'PENDING_PAYMENT' AND o.reservation_expires_at < now()
         ORDER BY o.reservation_expires_at
         LIMIT $1
         FOR UPDATE OF o SKIP LOCKED`,
        [REAPER_BATCH_SIZE],
      );
      return rows;
    });
  }

  private async resolveReservation(row: ExpiredReservationRow): Promise<void> {
    // Crash between Phase 1 and Phase 2 of the saga — never charged, not
    // even attempted.
    if (!row.payment_id || !row.idempotency_key) {
      await this.orderSettlementService.cancelUnpaid({
        orderId: row.id,
        reason: 'RESERVATION_EXPIRED_NO_PAYMENT',
      });
      return;
    }

    const chargeResult = await this.paymentGateway.getStatus(
      row.idempotency_key,
    );
    const payment: PaymentResolution = {
      paymentId: row.payment_id,
      chargeResult,
    };

    if (chargeResult.status === 'CAPTURED') {
      await this.orderSettlementService.confirmCaptured({
        orderId: row.id,
        payment,
      });
      return;
    }
    if (chargeResult.status === 'DECLINED') {
      await this.orderSettlementService.failDeclined({
        orderId: row.id,
        payment,
      });
      return;
    }
    if (chargeResult.status === 'FAILED') {
      // getStatus()'s only route to FAILED is a 404 — the provider never
      // saw this charge (Fix B's table).
      await this.orderSettlementService.cancelUnpaid({
        orderId: row.id,
        reason: 'RESERVATION_EXPIRED_NOT_CHARGED',
        payment,
      });
      return;
    }

    // UNKNOWN: never auto-released — releasing stock for a charge that
    // did go through is worse than holding it until a human looks
    // (Decisions).
    this.warnUnresolved(row);
  }

  private warnUnresolved(row: ExpiredReservationRow): void {
    const minutesPastExpiry = Math.round(
      (Date.now() - row.reservation_expires_at.getTime()) / MS_PER_MINUTE,
    );

    if (minutesPastExpiry >= REAPER_ALERT_AFTER_MINUTES) {
      this.logger.error({
        event: 'reservation unresolved',
        orderId: row.id,
        minutesPastExpiry,
      });
      return;
    }
    this.logger.warn({
      event: 'reservation still UNKNOWN',
      orderId: row.id,
      minutesPastExpiry,
    });
  }
}
