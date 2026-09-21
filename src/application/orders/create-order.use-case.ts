import { randomUUID } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';

import {
  CustomerNotFoundError,
  ProductNotFoundError,
} from './create-order.errors';
import type { CreateOrderCommand } from './create-order.types';
import { generateOrderNumber } from './helpers/order-number.helpers';
import {
  AllocateInventoryUseCase,
  AllocationResult,
} from '../allocation/allocate-inventory.use-case';
import { OnBeforeReserve } from '../allocation/allocation.types';
import { Order } from '../../domain/entities/order';
import { OrderItem } from '../../domain/entities/order-item';
import { GEOCODING_PROVIDER } from '../../domain/ports/geocoding-provider';
import type { GeocodingProvider } from '../../domain/ports/geocoding-provider';
import { Money } from '../../domain/value-objects/money';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { CustomerOrmEntity } from '../../infrastructure/database/entities/customer.orm-entity';
import { OrderItemOrmEntity } from '../../infrastructure/database/entities/order-item.orm-entity';
import { OrderOrmEntity } from '../../infrastructure/database/entities/order.orm-entity';
import { ProductOrmEntity } from '../../infrastructure/database/entities/product.orm-entity';
import {
  orderItemToPersistence,
  orderToPersistence,
} from '../../infrastructure/database/mappers/order.mapper';

/**
 * Phase 1's own result — what step 9 has to show for itself before
 * charging (step 10) and settling (step 11) exist. `order`/`items` are
 * the domain objects Phase 1 just persisted; `allocation` carries the
 * winning warehouse's name/distance for the eventual `201` response.
 */
export interface ReserveOrderResult {
  order: Order;
  items: OrderItem[];
  allocation: AllocationResult;
}

/**
 * specs/05-order-creation-saga.md — the three-phase `POST /orders` saga.
 * Only Phase 1 (reserve) is built here (step 9); Phase 2 (charge, step
 * 10) and Phase 3 (settle, step 11) extend `execute()`'s body in later
 * steps of the same plan, not a separate method.
 */
@Injectable()
export class CreateOrderUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly allocateInventoryUseCase: AllocateInventoryUseCase,
    @Inject(GEOCODING_PROVIDER)
    private readonly geocodingProvider: GeocodingProvider,
  ) {}

  async execute(command: CreateOrderCommand): Promise<ReserveOrderResult> {
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

    // Resolved before AllocateInventoryUseCase.execute() ever runs, never
    // inside onBeforeReserve — a hard rule as strict as R4.3's one for the
    // payment call (specs/05-order-creation-saga.md, Risks).
    const shippingAddress = ShippingAddress.of(command.shippingAddress);
    const shippingLocation =
      await this.geocodingProvider.geocode(shippingAddress);

    // Generated once, before the failover loop, and reused across every
    // retry — same reasoning as AllocateInventoryUseCase's own orderId
    // (specs/05, Decisions).
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
}
