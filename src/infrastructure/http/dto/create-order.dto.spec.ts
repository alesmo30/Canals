import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';

import { CreateOrderDto } from './create-order.dto';

/**
 * Exercises the exact global pipe config from main.ts
 * (`{ whitelist: true, forbidNonWhitelisted: true }`) directly against
 * `CreateOrderDto`, without booting Nest — `ValidationPipe` is usable
 * standalone.
 */
describe('CreateOrderDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateOrderDto,
    data: '',
  };

  function validPayload(): Record<string, unknown> {
    return {
      customerId: '11111111-1111-4111-8111-111111111111',
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: '1 Test Way',
        city: 'Test City',
        country: 'US',
      },
      items: [
        {
          productId: '22222222-2222-4222-8222-222222222222',
          quantity: 1,
        },
      ],
      payment: {
        cardNumber: '4242424242424242',
      },
    };
  }

  async function messagesFor(payload: unknown): Promise<string[]> {
    try {
      await pipe.transform(payload, metadata);
      throw new Error('expected pipe.transform to reject');
    } catch (error: unknown) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }
      const response = error.getResponse() as { message: string[] };
      return response.message;
    }
  }

  it('accepts a valid payload', async () => {
    const payload = validPayload();
    const result: unknown = await pipe.transform(payload, metadata);
    expect(result).toEqual(payload);
  });

  it('rejects an unknown top-level property', async () => {
    const payload = { ...validPayload(), extraField: 'nope' };

    const messages = await messagesFor(payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('extraField should not exist'),
      ]),
    );
  });

  it('rejects a country other than US', async () => {
    const payload = validPayload();
    (payload.shippingAddress as Record<string, unknown>).country = 'CA';

    const messages = await messagesFor(payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'shippingAddress.country must be one of the following values: US',
        ),
      ]),
    );
  });

  it('rejects a quantity <= 0', async () => {
    const payload = validPayload();
    (payload.items as Array<Record<string, unknown>>)[0].quantity = 0;

    const messages = await messagesFor(payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('items.0.quantity must not be less than 1'),
      ]),
    );
  });

  it('rejects a duplicate productId within items', async () => {
    const payload = validPayload();
    const [line] = payload.items as Array<Record<string, unknown>>;
    payload.items = [line, { ...line }];

    const messages = await messagesFor(payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('items must not contain a duplicate productId'),
      ]),
    );
  });
});
