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
  /** The single fulfilling warehouse. Null only while allocation is in flight (data-model.dbml). */
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
 * Mirrors an `orders` row. R0.5 (frozen contract): `status` is exposed as a
 * getter only — there is no public `status` property, so
 * `order.status = 'CONFIRMED'` fails to compile (TS2339: no such property).
 * The only way to change it is through the named methods below, each of
 * which checks order-status.transitions.ts before mutating.
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

  /** PENDING_PAYMENT -> PAID. FR-5 phase 3, approved: the payment provider captured the charge. */
  markPaid(): void {
    assertValidOrderTransition(this.props.status, 'PAID');
    this.props.status = 'PAID';
  }

  /**
   * PENDING_PAYMENT -> PAYMENT_FAILED. FR-5 phase 3, declined: the
   * reservation has already been released by the caller (Inventory.release,
   * outside this entity — that is a repository/use-case concern, not this
   * one order's).
   */
  markPaymentFailed(): void {
    assertValidOrderTransition(this.props.status, 'PAYMENT_FAILED');
    this.props.status = 'PAYMENT_FAILED';
  }

  /** PAID -> CONFIRMED. FR-5 phase 3: the reservation is committed for good and the order.confirmed outbox event fires. */
  confirm(): void {
    assertValidOrderTransition(this.props.status, 'CONFIRMED');
    this.props.status = 'CONFIRMED';
    this.props.confirmedAt = new Date();
  }

  /** PENDING_PAYMENT -> CANCELLED. The only path in: reservation expired past reservation_expires_at (the reaper), never a PAYMENT_FAILED order. */
  cancel(reason: string): void {
    assertValidOrderTransition(this.props.status, 'CANCELLED');
    this.props.status = 'CANCELLED';
    this.props.cancelledAt = new Date();
    this.props.cancellationReason = reason;
  }
}
