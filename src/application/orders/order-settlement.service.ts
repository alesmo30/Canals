import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { InventoryService } from '../allocation/inventory.service';
import { Order } from '../../domain/entities/order';
import { EVENT_PUBLISHER } from '../../domain/ports/event-publisher';
import type {
  EventPublisher,
  TransactionContext,
} from '../../domain/ports/event-publisher';
import type { ChargeResult } from '../../domain/ports/payment-gateway';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import {
  orderToDomain,
  orderToPersistence,
} from '../../infrastructure/database/mappers/order.mapper';
import type { OrderConfirmedPayload } from '../../infrastructure/messaging/event-routing';

export type SettlementOutcome = 'SETTLED' | 'ALREADY_SETTLED';

/** A job (reaper/reconciliation) passes this; the saga's Phase 3 doesn't — it already wrote the `payments` row itself in Phase 2. */
export interface PaymentResolution {
  paymentId: string;
  chargeResult: ChargeResult;
}

export interface SettlementResult {
  outcome: SettlementOutcome;
  order: Order;
}

interface ConfirmCapturedParams {
  orderId: string;
  payment?: PaymentResolution;
}

interface FailDeclinedParams {
  orderId: string;
  payment?: PaymentResolution;
}

interface CancelUnpaidParams {
  orderId: string;
  reason: string;
  payment?: PaymentResolution;
}

/**
 * The one "settle this order" path, shared by the saga, the reaper and
 * reconciliation; its row lock makes racing settlers resolve to one winner.
 * See knowledge/orders-saga.md#settlement
 */
@Injectable()
export class OrderSettlementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher,
  ) {}

  /** CAPTURED: commit reservation, PENDING_PAYMENT -> PAID -> CONFIRMED, publish order.confirmed — one transaction. */
  async confirmCaptured(
    params: ConfirmCapturedParams,
  ): Promise<SettlementResult> {
    return this.settle(params.orderId, params.payment, async (context) => {
      const { manager, order, warehouseId, productIds } = context;

      await this.inventoryService.commit(manager, {
        orderId: order.getId(),
        warehouseId,
        productIds,
      });
      order.markPaid();
      order.confirm();
      await manager
        .getRepository(OrderOrmEntity)
        .save(orderToPersistence(order));

      const tx: TransactionContext = {
        executeSql: (sql, values) => manager.query(sql, values),
      };
      await this.eventPublisher.publish(
        {
          type: 'order.confirmed',
          payload: {
            orderId: order.getId(),
            occurredAt: new Date().toISOString(),
          } satisfies OrderConfirmedPayload,
        },
        tx,
      );
    });
  }

  /** DECLINED: release reservation, PENDING_PAYMENT -> PAYMENT_FAILED. */
  async failDeclined(params: FailDeclinedParams): Promise<SettlementResult> {
    return this.settle(params.orderId, params.payment, async (context) => {
      const { manager, order, warehouseId, productIds } = context;

      await this.inventoryService.release(manager, {
        orderId: order.getId(),
        warehouseId,
        productIds,
      });
      order.markPaymentFailed();
      await manager
        .getRepository(OrderOrmEntity)
        .save(orderToPersistence(order));
    });
  }

  /** Never charged: release reservation, PENDING_PAYMENT -> CANCELLED(reason). */
  async cancelUnpaid(params: CancelUnpaidParams): Promise<SettlementResult> {
    return this.settle(params.orderId, params.payment, async (context) => {
      const { manager, order, warehouseId, productIds } = context;

      await this.inventoryService.release(manager, {
        orderId: order.getId(),
        warehouseId,
        productIds,
      });
      order.cancel(params.reason);
      await manager
        .getRepository(OrderOrmEntity)
        .save(orderToPersistence(order));
    });
  }

  /**
   * Shared steps: lock the order row, return ALREADY_SETTLED if it moved on,
   * update payments if a resolution was passed, then run the caller's own
   * transition.
   */
  private async settle(
    orderId: string,
    payment: PaymentResolution | undefined,
    transition: (context: {
      manager: EntityManager;
      order: Order;
      warehouseId: string;
      productIds: string[];
    }) => Promise<void>,
  ): Promise<SettlementResult> {
    return this.dataSource.transaction(async (manager) => {
      // Raw SQL for the lock itself — concurrency-critical
      // (references/coding-conventions.md); the read-back below goes
      // through the ORM as usual, now protected by the lock this holds
      // for the rest of the transaction.
      await manager.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
        orderId,
      ]);
      const orderRow = await manager
        .getRepository(OrderOrmEntity)
        .findOneByOrFail({ id: orderId });
      const order = orderToDomain(orderRow);

      if (order.getStatus() !== 'PENDING_PAYMENT') {
        return { outcome: 'ALREADY_SETTLED', order };
      }

      if (payment) {
        // Raw SQL — concurrency-critical: the `WHERE status IN (...)`
        // guard is what stops this from overwriting a row a concurrent
        // settler already finished with (references/coding-conventions.md).
        await manager.query(
          `UPDATE payments
           SET status = $2, provider_payment_id = $3, card_last4 = $4,
               card_brand = $5, failure_code = $6, raw_response = $7::jsonb,
               settled_at = now(), updated_at = now()
           WHERE id = $1 AND status IN ('PENDING', 'UNKNOWN')`,
          [
            payment.paymentId,
            payment.chargeResult.status,
            payment.chargeResult.providerPaymentId,
            payment.chargeResult.cardLast4,
            payment.chargeResult.cardBrand,
            payment.chargeResult.failureCode,
            payment.chargeResult.rawResponse === null
              ? null
              : JSON.stringify(payment.chargeResult.rawResponse),
          ],
        );
      }

      const warehouseId = order.getWarehouseId()!;
      const items = await manager
        .getRepository(OrderItemOrmEntity)
        .find({ where: { orderId } });
      const productIds = items.map((item) => item.productId);

      await transition({ manager, order, warehouseId, productIds });

      return { outcome: 'SETTLED', order };
    });
  }
}
