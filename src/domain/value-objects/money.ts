/**
 * Integer cents + currency; never floats. A plain number (not bigint) stays
 * exact far beyond any realistic order total.
 */
export class Money {
  private constructor(
    private readonly amountCents: number,
    private readonly currency: string,
  ) {}

  static of(amountCents: number, currency = 'USD'): Money {
    if (!Number.isInteger(amountCents)) {
      throw new Error(
        `Money amount must be an integer number of cents, got ${amountCents}`,
      );
    }
    if (amountCents < 0) {
      throw new Error(`Money amount cannot be negative, got ${amountCents}`);
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(
        `Money currency must be a 3-letter ISO code, got "${currency}"`,
      );
    }
    return new Money(amountCents, currency);
  }

  static zero(currency = 'USD'): Money {
    return Money.of(0, currency);
  }

  getAmountCents(): number {
    return this.amountCents;
  }

  getCurrency(): string {
    return this.currency;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountCents + other.amountCents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountCents - other.amountCents, this.currency);
  }

  /** For line totals: unitPrice.multiply(quantity). Quantity must be a positive integer. */
  multiply(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error(
        `Money can only be multiplied by a non-negative integer, got ${quantity}`,
      );
    }
    return Money.of(this.amountCents * quantity, this.currency);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountCents > other.amountCents;
  }

  equals(other: Money): boolean {
    return (
      this.amountCents === other.amountCents && this.currency === other.currency
    );
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Cannot combine ${this.currency} with ${other.currency}`);
    }
  }
}
