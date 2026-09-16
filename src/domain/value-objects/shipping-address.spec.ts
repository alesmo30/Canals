import { ShippingAddress } from './shipping-address';

const validProps = {
  recipient: 'Jane Doe',
  line1: '1 Apple Park Way',
  city: 'Cupertino',
  state: 'CA',
  postalCode: '95014',
  country: 'US',
};

describe('ShippingAddress', () => {
  it('holds a full address', () => {
    const address = ShippingAddress.of(validProps);

    expect(address.getRecipient()).toBe('Jane Doe');
    expect(address.getLine1()).toBe('1 Apple Park Way');
    expect(address.getCity()).toBe('Cupertino');
    expect(address.getState()).toBe('CA');
    expect(address.getPostalCode()).toBe('95014');
    expect(address.getCountry()).toBe('US');
  });

  it('allows line2, state and postalCode to be omitted, per the API contract', () => {
    const address = ShippingAddress.of({
      recipient: 'Jane Doe',
      line1: '1 Apple Park Way',
      city: 'Cupertino',
      country: 'US',
    });

    expect(address.getLine2()).toBeUndefined();
    expect(address.getState()).toBeUndefined();
    expect(address.getPostalCode()).toBeUndefined();
  });

  it.each(['recipient', 'line1', 'city', 'country'] as const)(
    'requires %s to be present',
    (field) => {
      const props = { ...validProps, [field]: '' };

      expect(() => ShippingAddress.of(props)).toThrow(new RegExp(field));
    },
  );

  it('is equal by value, not by reference', () => {
    expect(
      ShippingAddress.of(validProps).equals(
        ShippingAddress.of({ ...validProps }),
      ),
    ).toBe(true);
    expect(
      ShippingAddress.of(validProps).equals(
        ShippingAddress.of({ ...validProps, city: 'San Jose' }),
      ),
    ).toBe(false);
  });
});
