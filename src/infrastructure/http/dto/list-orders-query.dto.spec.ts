import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';

import { ListOrdersQueryDto } from './list-orders-query.dto';

/**
 * specs/06-read-side.md, step 10 — the same pipe config the controller
 * passes to `@Query(...)` (`transform: true` is what makes `pageSize`
 * arrive as a `number`, unlike the global pipe in main.ts).
 */
describe('ListOrdersQueryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: ListOrdersQueryDto,
    data: '',
  };

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

  it('accepts an empty payload — every field is optional', async () => {
    const result: unknown = await pipe.transform({}, metadata);
    expect(result).toEqual({});
  });

  it('accepts a fully-populated valid payload', async () => {
    const payload = {
      customerId: '11111111-1111-4111-8111-111111111111',
      status: 'PAID',
      warehouseId: '22222222-2222-4222-8222-222222222222',
      createdAtFrom: '2026-01-01T00:00:00.000Z',
      createdAtTo: '2026-02-01T00:00:00.000Z',
      cursor: 'b3BhcXVl',
      pageSize: '50',
    };

    const result = (await pipe.transform(
      payload,
      metadata,
    )) as ListOrdersQueryDto;

    expect(result.pageSize).toBe(50);
    expect(result.status).toBe('PAID');
  });

  it('rejects pageSize=0', async () => {
    const messages = await messagesFor({ pageSize: '0' });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pageSize must not be less than 1'),
      ]),
    );
  });

  it('rejects pageSize=101', async () => {
    const messages = await messagesFor({ pageSize: '101' });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pageSize must not be greater than 100'),
      ]),
    );
  });

  it('rejects a status outside the enum', async () => {
    const messages = await messagesFor({ status: 'BOGUS' });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('status must be one of the following values'),
      ]),
    );
  });

  it('rejects a non-ISO8601 createdAtFrom', async () => {
    const messages = await messagesFor({ createdAtFrom: 'not-a-date' });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('createdAtFrom must be a valid ISO 8601'),
      ]),
    );
  });

  it('rejects an unknown property', async () => {
    const messages = await messagesFor({ bogus: '1' });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bogus should not exist'),
      ]),
    );
  });
});
