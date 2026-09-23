import { randomUUID } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';

import {
  CustomerNotFoundError,
  PaymentDeclinedError,
  PaymentProviderUnavailableError,
  ProductNotFoundError,
} from './create-order.errors';
import type { CreateOrderCommand } from './create-order.types';
import { buildChargeIdempotencyKey } from './charge-idempotency-key';
import { generateOrderNumber } from './helpers/order-number.helpers';
import { OrderSettlementService } from './order-settlement.service';
import {
  AllocateInventoryUseCase,
  AllocationResult,
} from '../allocation/allocate-inventory.use-case';
import { OnBeforeReserve } from '../allocation/allocation.types';
import { Order } from '../../domain/entities/order';
import { OrderItem } from '../../domain/entities/order-item';
import { GEOCODING_PROVIDER } from '../../domain/ports/geocoding-provider';
import type { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { PAYMENT_GATEWAY } from '../../domain/ports/payment-gateway';
import type {
  ChargeResult,
  PaymentGateway,
} from '../../domain/ports/payment-gateway';
import { Money } from '../../domain/value-objects/money';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { PaymentOrmEntity } from '../../infrastructure/database/entities/payment.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import {
  orderItemToPersistence,
  orderToPersistence,
} from '../../infrastructure/database/mappers/order.mapper';

/** A second charge attempt is out of scope today — always 1. */
const FIRST_PAYMENT_ATTEMPT = 1;

/** The only two ChargeResult statuses that mean the provider gave a final answer. */
function isDefinitiveOutcome(status: ChargeResult['status']): boolean {
  return status === 'CAPTURED' || status === 'DECLINED';
}

/**
 * Phase 1's own result. `order`/`items` are the domain objects Phase 1
 * just persisted; `allocation` carries the winning warehouse's
 * name/distance for the eventual `201` response.
 */
export interface ReserveOrderResult {
  order: Order;
  items: OrderItem[];
  allocation: AllocationResult;
}

/** Phase 2's own result — the persisted `payments` row and the gateway's raw outcome. */
export interface ChargeOrderResult {
  payment: PaymentOrmEntity;
  chargeResult: ChargeResult;
}

/**
 * What `execute()` resolves with on the only path that returns
 * normally — `CAPTURED`. `DECLINED` and `UNKNOWN` both throw instead
 * (`PaymentDeclinedError`/`PaymentProviderUnavailableError`), after
 * Phase 3 has already settled the order and inventory accordingly.
 */
export interface CreateOrderResult
  extends ReserveOrderResult, ChargeOrderResult {}

interface SettleOrderParams extends ReserveOrderResult, ChargeOrderResult {}

/**
 * The three-phase POST /orders saga. execute() reads as its table of
 * contents (resolve, reserve, charge, settle); each phase keeps its
 * decisions in its own private method.
 */
@Injectable()
export class CreateOrderUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly allocateInventoryUseCase: AllocateInventoryUseCase,
    private readonly orderSettlementService: OrderSettlementService,
    @Inject(GEOCODING_PROVIDER)
    private readonly geocodingProvider: GeocodingProvider,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async execute(command: CreateOrderCommand): Promise<CreateOrderResult> {
    const productById = await this.resolveCustomerAndProducts(command);
    const reserved = await this.reserveOrder(command, productById);
    const charged = await this.chargeOrder(command, reserved.order);
    return this.settleOrder({ ...reserved, ...charged });
  }

  /** Cliente inexistente -> CustomerNotFoundError (404); producto inexistente o inactivo -> ProductNotFoundError (404). */
  private async resolveCustomerAndProducts(
    command: CreateOrderCommand,
  ): Promise<Map<string, ProductOrmEntity>> {
    const customer = await this.dataSource
      .getRepository(CustomerOrmEntity)
      .findOne({ where: { id: command.customerId, deletedAt: IsNull() } });
    if (!customer) {
      throw new CustomerNotFoundError(command.customerId);
    }

    const requestedProductIds = command.lines.map((line) => line.productId);
    const products = await this.dataSource
      .getRepository(ProductOrmEntity)
      .find({
        where: {
          id: In(requestedProductIds),
          isActive: true,
          deletedAt: IsNull(),
        },
      });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );
    const missingProductIds = requestedProductIds.filter(
      (productId) => !productById.has(productId),
    );
    if (missingProductIds.length > 0) {
      throw new ProductNotFoundError(missingProductIds);
    }

    return productById;
  }

  /**
   * Phase 1 (reserve): geocode + `AllocateInventoryUseCase`, whose
   * `onBeforeReserve` inserts `orders` (`PENDING_PAYMENT`) and
   * `order_items` with price snapshots in the same short transaction as
   * the reservation itself.
   */
  private async reserveOrder(
    command: CreateOrderCommand,
    productById: Map<string, ProductOrmEntity>,
  ): Promise<ReserveOrderResult> {
    // Geocode before AllocateInventoryUseCase runs, never inside
    // onBeforeReserve — no network call inside the reservation transaction.
    const shippingAddress = ShippingAddress.of(command.shippingAddress);
    const shippingLocation =
      await this.geocodingProvider.geocode(shippingAddress);

    // Generated once before the failover loop so it stays stable across
    // retries.
    const orderNumber = await generateOrderNumber(this.dataSource);

    const total = command.lines.reduce(
      (sum, line) =>
        sum.add(
          Money.of(productById.get(line.productId)!.unitPriceCents).multiply(
            line.quantity,
          ),
        ),
      Money.zero(),
    );

    let reservedOrder!: Order;
    let reservedItems: OrderItem[] = [];

    const onBeforeReserve: OnBeforeReserve = async (manager, params) => {
      const order = new Order({
        id: params.orderId,
        orderNumber,
        customerId: command.customerId,
        warehouseId: params.warehouseId,
        status: 'PENDING_PAYMENT',
        total,
        shippingAddress,
        shippingLocation,
        reservationExpiresAt: null,
        confirmedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await manager
        .getRepository(OrderOrmEntity)
        .save(orderToPersistence(order));

      const items = command.lines.map((line) => {
        const product = productById.get(line.productId)!;
        return new OrderItem({
          id: randomUUID(),
          orderId: params.orderId,
          productId: line.productId,
          quantity: line.quantity,
          productSkuSnapshot: product.sku,
          productNameSnapshot: product.name,
          unitPrice: Money.of(product.unitPriceCents),
          createdAt: new Date(),
        });
      });
      await manager
        .getRepository(OrderItemOrmEntity)
        .save(items.map(orderItemToPersistence));

      reservedOrder = order;
      reservedItems = items;
    };

    const allocation = await this.allocateInventoryUseCase.execute({
      shippingLocation,
      lines: command.lines,
      onBeforeReserve,
    });

    return { order: reservedOrder, items: reservedItems, allocation };
  }

  /**
   * Phase 2 (charge). No transaction may be open while charge() is in
   * flight. The idempotency key is persisted to payments first, so
   * reconciliation reads it back instead of rebuilding it.
   */
  private async chargeOrder(
    command: CreateOrderCommand,
    order: Order,
  ): Promise<ChargeOrderResult> {
    const total = order.getTotal();
    const chargeIdempotencyKey = buildChargeIdempotencyKey({
      orderId: order.getId(),
      attempt: FIRST_PAYMENT_ATTEMPT,
    });

    const paymentRepository = this.dataSource.getRepository(PaymentOrmEntity);
    const initialPayment: PaymentOrmEntity = {
      id: randomUUID(),
      orderId: order.getId(),
      attempt: FIRST_PAYMENT_ATTEMPT,
      provider: 'mock-gateway',
      providerPaymentId: null,
      idempotencyKey: chargeIdempotencyKey,
      status: 'PENDING',
      amountCents: total.getAmountCents(),
      currency: total.getCurrency(),
      cardLast4: null,
      cardBrand: null,
      failureCode: null,
      rawResponse: null,
      settledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const pendingPayment = await paymentRepository.save(initialPayment);

    const chargeResult = await this.paymentGateway.charge({
      cardNumber: command.cardNumber,
      amountMinor: total.getAmountCents(),
      currency: total.getCurrency(),
      description: `Order ${order.getOrderNumber()}`,
      idempotencyKey: chargeIdempotencyKey,
    });

    const payment = await paymentRepository.save({
      ...pendingPayment,
      status: chargeResult.status,
      providerPaymentId: chargeResult.providerPaymentId,
      cardLast4: chargeResult.cardLast4,
      cardBrand: chargeResult.cardBrand,
      failureCode: chargeResult.failureCode,
      rawResponse: chargeResult.rawResponse,
      // settled_at only for a definitive outcome: reconciliation finds
      // UNKNOWN payments via settled_at IS NULL.
      settledAt: isDefinitiveOutcome(chargeResult.status) ? new Date() : null,
      updatedAt: new Date(),
    });

    return { payment, chargeResult };
  }

  /**
   * Phase 3 (settle). Delegates to OrderSettlementService, whose row lock
   * stops this phase overwriting a settlement a job already made.
   * `payment` is omitted: Phase 2 already wrote that row.
   */
  private async settleOrder(
    params: SettleOrderParams,
  ): Promise<CreateOrderResult> {
    const { order, items, allocation, payment, chargeResult } = params;

    if (chargeResult.status === 'CAPTURED') {
      const { order: settledOrder } =
        await this.orderSettlementService.confirmCaptured({
          orderId: order.getId(),
        });
      return { order: settledOrder, items, allocation, payment, chargeResult };
    }

    if (chargeResult.status === 'DECLINED') {
      await this.orderSettlementService.failDeclined({
        orderId: order.getId(),
      });
      throw new PaymentDeclinedError({
        orderId: order.getId(),
        failureCode: chargeResult.failureCode,
      });
    }

    // UNKNOWN: leave PENDING_PAYMENT with the reservation intact;
    // reconciliation decides.
    throw new PaymentProviderUnavailableError({
      orderId: order.getId(),
      failureCode: chargeResult.failureCode,
    });
  }
}
