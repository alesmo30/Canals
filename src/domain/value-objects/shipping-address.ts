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
 * Snapshot stored on the order, so editing a customer never rewrites past
 * orders. Field format rules belong to the request DTO; this only guards
 * required fields.
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
