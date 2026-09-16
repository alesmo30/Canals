import { Money } from './money';

describe('Money', () => {
  it('holds an integer cent amount and currency', () => {
    const money = Money.of(1999, 'USD');

    expect(money.getAmountCents()).toBe(1999);
    expect(money.getCurrency()).toBe('USD');
  });

  it('defaults to USD', () => {
    expect(Money.of(500).getCurrency()).toBe('USD');
  });

  it('rejects non-integer amounts', () => {
    expect(() => Money.of(19.99)).toThrow(/integer/);
  });

  it('rejects negative amounts', () => {
    expect(() => Money.of(-100)).toThrow(/negative/);
  });

  it('rejects a malformed currency code', () => {
    expect(() => Money.of(100, 'us')).toThrow(/3-letter/);
    expect(() => Money.of(100, 'DOLLAR')).toThrow(/3-letter/);
  });

  it('adds two amounts in the same currency', () => {
    const total = Money.of(1000).add(Money.of(250));

    expect(total.getAmountCents()).toBe(1250);
  });

  it('subtracts two amounts in the same currency', () => {
    const remainder = Money.of(1000).subtract(Money.of(250));

    expect(remainder.getAmountCents()).toBe(750);
  });

  it('refuses to combine different currencies', () => {
    expect(() => Money.of(1000, 'USD').add(Money.of(1000, 'EUR'))).toThrow(
      /Cannot combine USD with EUR/,
    );
  });

  it('multiplies by a quantity for a line total, exactly (no float drift)', () => {
    // The classic float trap: 0.1 + 0.2 !== 0.3. In cents, this must be exact.
    const unitPrice = Money.of(1099);

    const lineTotal = unitPrice.multiply(3);

    expect(lineTotal.getAmountCents()).toBe(3297);
  });

  it('rejects a non-integer or negative multiplier', () => {
    expect(() => Money.of(100).multiply(1.5)).toThrow(/non-negative integer/);
    expect(() => Money.of(100).multiply(-1)).toThrow(/non-negative integer/);
  });

  it('compares amounts in the same currency', () => {
    expect(Money.of(200).isGreaterThan(Money.of(100))).toBe(true);
    expect(Money.of(100).isGreaterThan(Money.of(200))).toBe(false);
  });

  it('is equal by value, not by reference', () => {
    expect(Money.of(500, 'USD').equals(Money.of(500, 'USD'))).toBe(true);
    expect(Money.of(500, 'USD').equals(Money.of(500, 'EUR'))).toBe(false);
    expect(Money.of(500, 'USD').equals(Money.of(501, 'USD'))).toBe(false);
  });

  it('produces a zero amount in the given currency', () => {
    expect(Money.zero('USD').getAmountCents()).toBe(0);
  });
});
