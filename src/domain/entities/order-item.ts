import { Money } from '../value-objects/money';

export interface OrderItemProps {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  /** Snapshot at purchase time — never re-reads the live product. */
  productSkuSnapshot: string;
  productNameSnapshot: string;
  /** Snapshot at purchase time. Historical orders never change when the catalogue does. */
  unitPrice: Money;
  createdAt: Date;
}

/**
 * Mirrors an `order_items` row. Resolves the N:M between orders and
 * products, and freezes the price and product identity at purchase time
 * (data-model.dbml note).
 */
export class OrderItem {
  constructor(private readonly props: OrderItemProps) {
    if (!Number.isInteger(props.quantity) || props.quantity <= 0) {
      throw new Error(
        `OrderItem quantity must be a positive integer, got ${props.quantity}`,
      );
    }
  }

  getId(): string {
    return this.props.id;
  }

  getOrderId(): string {
    return this.props.orderId;
  }

  getProductId(): string {
    return this.props.productId;
  }

  getQuantity(): number {
    return this.props.quantity;
  }

  getProductSkuSnapshot(): string {
    return this.props.productSkuSnapshot;
  }

  getProductNameSnapshot(): string {
    return this.props.productNameSnapshot;
  }

  getUnitPrice(): Money {
    return this.props.unitPrice;
  }

  /**
   * quantity * unitPrice, exact in integer cent arithmetic. Deliberately
   * not a stored column (data-model.dbml) — always derived.
   */
  getLineTotal(): Money {
    return this.props.unitPrice.multiply(this.props.quantity);
  }
}
