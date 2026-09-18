import { describeCard } from './card';

describe('describeCard', () => {
  it('recognises a Visa card (prefix 4)', () => {
    expect(describeCard('4111111111111111')).toEqual({
      last4: '1111',
      brand: 'visa',
    });
  });

  it('recognises a Mastercard card in the 51-55 range', () => {
    expect(describeCard('5105105105105100')).toEqual({
      last4: '5100',
      brand: 'mastercard',
    });
  });

  it('recognises a Mastercard card in the 2221-2720 range', () => {
    expect(describeCard('2223000048400011')).toEqual({
      last4: '0011',
      brand: 'mastercard',
    });
  });

  it('recognises an Amex card (prefix 34)', () => {
    expect(describeCard('341111111111111')).toEqual({
      last4: '1111',
      brand: 'amex',
    });
  });

  it('recognises an Amex card (prefix 37)', () => {
    expect(describeCard('371449635398431')).toEqual({
      last4: '8431',
      brand: 'amex',
    });
  });

  it('recognises a Discover card (prefix 6011)', () => {
    expect(describeCard('6011111111111117')).toEqual({
      last4: '1117',
      brand: 'discover',
    });
  });

  it('recognises a Discover card in the 644-649 range', () => {
    expect(describeCard('6445000000000004')).toEqual({
      last4: '0004',
      brand: 'discover',
    });
  });

  it('recognises a Discover card (prefix 65)', () => {
    expect(describeCard('6500000000000002')).toEqual({
      last4: '0002',
      brand: 'discover',
    });
  });

  it('falls back to unknown for anything else', () => {
    expect(describeCard('1234567890123456')).toEqual({
      last4: '3456',
      brand: 'unknown',
    });
  });

  it('extracts last4 from a PAN with spaces and dashes', () => {
    expect(describeCard('4242 4242-4242 4242')).toEqual({
      last4: '4242',
      brand: 'visa',
    });
  });
});
