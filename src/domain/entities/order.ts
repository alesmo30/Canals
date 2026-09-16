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
 * Mirrors an `orders` row. R0.5 (frozen contract): fields and read access
 * only here — the guarded status transition (`transitionTo`) is added by
 * order-status.transitions.ts (step 5), which this class will use once it
 * lands, so the transition table has exactly one place to live.
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
}
