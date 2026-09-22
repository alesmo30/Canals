import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { JobHandler } from './job-handler';
import {
  OrderSettlementService,
  PaymentResolution,
} from '../orders/order-settlement.service';
import { PAYMENT_GATEWAY } from '../../domain/ports/payment-gateway';
import type { PaymentGateway } from '../../domain/ports/payment-gateway';

/** Selection query's own LIMIT — a batch bounded run over run, not the whole backlog at once. */
export const RECONCILIATION_BATCH_SIZE = 50;

/** Grace before reconciling: longer than the gateway's worst case (3 × 2 s + backoff). */
export const RECONCILIATION_GRACE_MINUTES = 2;

interface UnsettledPaymentRow {
  id: string;
  order_id: string;
  idempotency_key: string;
}

/**
 * specs/07-hardening-demo.md, R6.2 — run every minute by the worker's
 * scheduler (queue-setup.ts's SCHEDULED_JOBS). Resolves every `payments`
 * row still unsettled past the grace period, through
 * `OrderSettlementService` so it can never race the saga's Phase 3 or the
 * reservation reaper.
 *
 * Acts only on a *definitive* answer — `CAPTURED`/`DECLINED`. `FAILED`
 * (the provider never saw this charge) and `UNKNOWN` are left to the
 * reaper: only it, after the reservation TTL, may conclude "never
 * charged" (Decisions — the two jobs overlap by design on the definitive
 * answers, and diverge on the ambiguous one).
 */
@Injectable()
export class PaymentReconciliationHandler implements JobHandler<
  Record<string, unknown>
> {
  readonly queue = 'payment.reconcile';
  private readonly logger = new Logger(PaymentReconciliationHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderSettlementService: OrderSettlementService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async handle(): Promise<void> {
    const rows = await this.selectUnsettledPayments();
    for (const row of rows) {
      try {
        await this.resolvePayment(row);
      } catch (error) {
        this.logger.warn({
          event: 'payment reconcile failed',
          orderId: row.order_id,
          paymentId: row.id,
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
   * (specs/07-hardening-demo.md, same discipline as the reaper).
   */
  private async selectUnsettledPayments(): Promise<UnsettledPaymentRow[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: UnsettledPaymentRow[] = await manager.query(
        `SELECT id, order_id, idempotency_key FROM payments
         WHERE settled_at IS NULL AND status IN ('PENDING', 'UNKNOWN')
           AND created_at < now() - ($1 * interval '1 minute')
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [RECONCILIATION_GRACE_MINUTES, RECONCILIATION_BATCH_SIZE],
      );
      return rows;
    });
  }

  private async resolvePayment(row: UnsettledPaymentRow): Promise<void> {
    const chargeResult = await this.paymentGateway.getStatus(
      row.idempotency_key,
    );
    const payment: PaymentResolution = { paymentId: row.id, chargeResult };

    if (chargeResult.status === 'CAPTURED') {
      await this.orderSettlementService.confirmCaptured({
        orderId: row.order_id,
        payment,
      });
      return;
    }
    if (chargeResult.status === 'DECLINED') {
      await this.orderSettlementService.failDeclined({
        orderId: row.order_id,
        payment,
      });
      return;
    }

    // FAILED (never charged) or UNKNOWN: neither is definitive enough for
    // reconciliation to act on — only the reaper, after the reservation
    // TTL, may conclude "never charged" (Decisions).
    this.logger.warn({
      event: 'payment reconcile left unresolved',
      orderId: row.order_id,
      paymentId: row.id,
      status: chargeResult.status,
    });
  }
}
