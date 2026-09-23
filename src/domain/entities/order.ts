import { assertValidOrderTransition } from './order-status.transitions';
import { OrderStatus } from '../enum-types/order-status';
import { Coordinates } from '../value-objects/coordinates';
import { Money } from '../value-objects/money';
import { ShippingAddress } from '../value-objects/shipping-address';

export interface OrderProps {
  id: string;
  /** Customer-facing reference, e.g. CNL-2026-000123. Never expose the UUID to a customer. */
  orderNumber: string;
  customerId: string;
  /** The single fulfilling warehouse. Null only while allocation is in flight. */
  warehouseId: string | null;
  status: OrderStatus;
  /**
   * Authoritative amount charged. The DB stores `currency` and
   * `total_cents` as separate columns; here they are one Money value —
   * carrying currency on the amount avoids the two ever disagreeing.
   */
  total: Money;
  shippingAddress: ShippingAddress;
  /** Geocoded once at order creation and frozen — never recomputed. */
  shippingLocation: Coordinates;
  /** Reaper releases stock past this while still PENDING_PAYMENT. */
  reservationExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mirrors an `orders` row. `status` is getter-only (assigning it doesn't
 * compile); change it only through the named methods, which check
 * ORDER_TRANSITIONS.
 */
export class Order {
  constructor(private readonly props: OrderProps) {}

  getId(): string {
    return this.props.id;
  }

  getOrderNumber(): string {
    return this.props.orderNumber;
  }

  getCustomerId(): string {
    return this.props.customerId;
  }

  getWarehouseId(): string | null {
    return this.props.warehouseId;
  }

  getStatus(): OrderStatus {
    return this.props.status;
  }

  getTotal(): Money {
    return this.props.total;
  }

  getShippingAddress(): ShippingAddress {
    return this.props.shippingAddress;
  }

  getShippingLocation(): Coordinates {
    return this.props.shippingLocation;
  }

  getReservationExpiresAt(): Date | null {
    return this.props.reservationExpiresAt;
  }

  getCancellationReason(): string | null {
    return this.props.cancellationReason;
  }

  getConfirmedAt(): Date | null {
    return this.props.confirmedAt;
  }

  getCancelledAt(): Date | null {
    return this.props.cancelledAt;
  }

  /** PENDING_PAYMENT -> PAID: the provider captured the charge. */
  markPaid(): void {
    assertValidOrderTransition(this.props.status, 'PAID');
    this.props.status = 'PAID';
  }

  /** PENDING_PAYMENT -> PAYMENT_FAILED. The caller has already released the reservation. */
  markPaymentFailed(): void {
    assertValidOrderTransition(this.props.status, 'PAYMENT_FAILED');
    this.props.status = 'PAYMENT_FAILED';
  }

  /** PAID -> CONFIRMED: the reservation is committed and the order.confirmed event fires. */
  confirm(): void {
    assertValidOrderTransition(this.props.status, 'CONFIRMED');
    this.props.status = 'CONFIRMED';
    this.props.confirmedAt = new Date();
  }

  /** PENDING_PAYMENT -> CANCELLED. Only the reaper, once the reservation expired; never from PAYMENT_FAILED. */
  cancel(reason: string): void {
    assertValidOrderTransition(this.props.status, 'CANCELLED');
    this.props.status = 'CANCELLED';
    this.props.cancelledAt = new Date();
    this.props.cancellationReason = reason;
  }
}
