export interface ShippingAddressProps {
  recipient: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

/**
 * R0.5 (frozen contract): matches the request shape of `POST /orders`
 * (`shippingAddress`, FR-1) and the `orders.shipping_address` jsonb
 * snapshot column — same field names, camelCase throughout.
 *
 * Frozen the moment an order is created: the order stores this snapshot
 * rather than a reference to the customer's address, so editing a customer
 * profile later never rewrites a past order (data-model.dbml, orders note).
 *
 * Field-level format rules (e.g. "is this a valid US state code") are a
 * request-DTO concern for P4, not this value object's job here in P0 — it
 * only guards that the fields the domain actually depends on are present.
 */
export class ShippingAddress {
  private constructor(private readonly props: Readonly<ShippingAddressProps>) {}

  static of(props: ShippingAddressProps): ShippingAddress {
    for (const field of ['recipient', 'line1', 'city', 'country'] as const) {
      if (!props[field] || props[field].trim().length === 0) {
        throw new Error(`ShippingAddress.${field} is required`);
      }
    }
    return new ShippingAddress({ ...props });
  }

  getRecipient(): string {
    return this.props.recipient;
  }

  getLine1(): string {
    return this.props.line1;
  }

  getLine2(): string | undefined {
    return this.props.line2;
  }

  getCity(): string {
    return this.props.city;
  }

  getState(): string | undefined {
    return this.props.state;
  }

  getPostalCode(): string | undefined {
    return this.props.postalCode;
  }

  getCountry(): string {
    return this.props.country;
  }

  equals(other: ShippingAddress): boolean {
    return (
      this.props.recipient === other.props.recipient &&
      this.props.line1 === other.props.line1 &&
      this.props.line2 === other.props.line2 &&
      this.props.city === other.props.city &&
      this.props.state === other.props.state &&
      this.props.postalCode === other.props.postalCode &&
      this.props.country === other.props.country
    );
  }
}
