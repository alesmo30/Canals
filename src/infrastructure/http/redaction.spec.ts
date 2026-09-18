import { redact } from './redaction';

describe('redact', () => {
  it('masks a card number nested at any depth, by key', () => {
    const input = { order: { card: { cardNumber: '4242424242424242' } } };

    const result = redact(input);

    expect(result.order.card.cardNumber).toBe('************4242');
  });

  it('masks card_number and pan the same way as cardNumber', () => {
    const input = { card_number: '4242424242424242', pan: '4242424242424242' };

    const result = redact(input);

    expect(result.card_number).toBe('************4242');
    expect(result.pan).toBe('************4242');
  });

  it('masks a Luhn-valid PAN found inside free text', () => {
    const input = 'card 4242 4242 4242 4242 failed';

    const result = redact(input);

    expect(result).toBe('card ************4242 failed');
  });

  it('masks a Luhn-valid PAN separated by dashes', () => {
    const input = 'charge for 4000-0000-0000-0002 declined';

    const result = redact(input);

    expect(result).toBe('charge for ************0002 declined');
  });

  it('redacts an apiKey query parameter inside a URL', () => {
    const input =
      'https://api.geoapify.com/v1/geocode/search?text=x&apiKey=super-secret-value';

    const result = redact(input);

    expect(result).toBe(
      'https://api.geoapify.com/v1/geocode/search?text=x&apiKey=[REDACTED]',
    );
    expect(result).not.toContain('super-secret-value');
  });

  it('replaces an apiKey field outright, by key', () => {
    const input = {
      config: { apiKey: 'super-secret-value', api_key: 'other-secret' },
    };

    const result = redact(input);

    expect(result.config.apiKey).toBe('[REDACTED]');
    expect(result.config.api_key).toBe('[REDACTED]');
  });

  it('leaves a 16-digit number that fails Luhn unchanged', () => {
    const input = 'reference 4242424242424241 on file';

    const result = redact(input);

    expect(result).toBe(input);
  });

  it('leaves a UUID unchanged', () => {
    const input = 'trace id f47ac10b-58cc-4372-a567-0e02b2c3d479';

    const result = redact(input);

    expect(result).toBe(input);
  });

  it('does not mutate its input', () => {
    const input = {
      cardNumber: '4242424242424242',
      note: 'pan 4242424242424242',
      nested: { apiKey: 'secret' },
    };
    const snapshot: unknown = JSON.parse(JSON.stringify(input));

    redact(input);

    expect(input).toEqual(snapshot);
  });

  it('survives circular references', () => {
    const input: Record<string, unknown> = { cardNumber: '4242424242424242' };
    input.self = input;

    const result = redact(input);

    expect(result.cardNumber).toBe('************4242');
    expect(result.self).toBe(result);
  });

  it('redacts a PAN inside an Error message, keeping the message readable', () => {
    const input = new Error('charge for 4242424242424242 failed');

    const result = redact(input) as unknown as Record<string, unknown>;

    expect(result.name).toBe('Error');
    expect(result.message).toBe('charge for ************4242 failed');
    expect(typeof result.stack).toBe('string');
  });
});
