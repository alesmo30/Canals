import { Order } from '../../../domain/entities/order';
import { OrderItem } from '../../../domain/entities/order-item';
import { Coordinates } from '../../../domain/value-objects/coordinates';
import { Money } from '../../../domain/value-objects/money';
import {
  ShippingAddress,
  ShippingAddressProps,
} from '../../../domain/value-objects/shipping-address';
import { OrderItemOrmEntity } from '../entities/order-item.orm-entity';
import { OrderOrmEntity } from '../entities/order.orm-entity';

/**
 * Only Order/OrderItem have domain classes, so this is the only mapper.
 * `shippingLocation` ↔ GeoPoint (see geo-point.ts).
 */
export function orderToDomain(entity: OrderOrmEntity): Order {
  return new Order({
    id: entity.id,
    orderNumber: entity.orderNumber,
    customerId: entity.customerId,
    warehouseId: entity.warehouseId,
    status: entity.status,
    total: Money.of(entity.totalCents, entity.currency),
    // Trusts the shape written at order creation; this read path doesn't validate it.
    shippingAddress: ShippingAddress.of(
      entity.shippingAddress as unknown as ShippingAddressProps,
    ),
    shippingLocation: Coordinates.of({
      longitude: entity.shippingLocation.coordinates[0],
      latitude: entity.shippingLocation.coordinates[1],
    }),
    reservationExpiresAt: entity.reservationExpiresAt,
    confirmedAt: entity.confirmedAt,
    cancelledAt: entity.cancelledAt,
    cancellationReason: entity.cancellationReason,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
}

export type OrderPersistenceFields = OrderOrmEntity;

export function orderToPersistence(order: Order): OrderPersistenceFields {
  const location = order.getShippingLocation();

  return {
    id: order.getId(),
    orderNumber: order.getOrderNumber(),
    customerId: order.getCustomerId(),
    warehouseId: order.getWarehouseId(),
    status: order.getStatus(),
    currency: order.getTotal().getCurrency(),
    totalCents: order.getTotal().getAmountCents(),
    shippingAddress: shippingAddressToPlainObject(order.getShippingAddress()),
    shippingLocation: {
      type: 'Point',
      coordinates: [location.getLongitude(), location.getLatitude()],
    },
    reservationExpiresAt: order.getReservationExpiresAt(),
    confirmedAt: order.getConfirmedAt(),
    cancelledAt: order.getCancelledAt(),
    cancellationReason: order.getCancellationReason(),
    // createdAt/updatedAt: not read back from Order (no getter for the
    // former was needed by any caller so far); the DB's own defaults and
    // trigger-free `updated_at` handling own these on insert.
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function shippingAddressToPlainObject(
  address: ShippingAddress,
): Record<string, unknown> {
  return {
    recipient: address.getRecipient(),
    line1: address.getLine1(),
    line2: address.getLine2(),
    city: address.getCity(),
    state: address.getState(),
    postalCode: address.getPostalCode(),
    country: address.getCountry(),
  };
}

export function orderItemToDomain(entity: OrderItemOrmEntity): OrderItem {
  return new OrderItem({
    id: entity.id,
    orderId: entity.orderId,
    productId: entity.productId,
    quantity: entity.quantity,
    productSkuSnapshot: entity.productSkuSnapshot,
    productNameSnapshot: entity.productNameSnapshot,
    // order_items has no currency column of its own (data-model.dbml) —
    // this system deals exclusively in USD (data-model.dbml, project
    // note), which is Money.of's own default.
    unitPrice: Money.of(entity.unitPriceCents),
    createdAt: entity.createdAt,
  });
}

/** order_items has no updated_at (insert-only); createdAt is the DB's DEFAULT now(), not read back from OrderItem. */
export type OrderItemPersistenceFields = Omit<OrderItemOrmEntity, 'createdAt'>;

export function orderItemToPersistence(
  item: OrderItem,
): OrderItemPersistenceFields {
  return {
    id: item.getId(),
    orderId: item.getOrderId(),
    productId: item.getProductId(),
    quantity: item.getQuantity(),
    productSkuSnapshot: item.getProductSkuSnapshot(),
    productNameSnapshot: item.getProductNameSnapshot(),
    unitPriceCents: item.getUnitPrice().getAmountCents(),
  };
}
