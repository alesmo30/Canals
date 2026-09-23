import { generateOrderNumber } from './order-number.helpers';
import { AppDataSource } from '../../../infrastructure/database/data-source';

/**
 * `order_number_seq` is shared and never reset, so assert the format and +1
 * increments, never an absolute value.
 */
describe('generateOrderNumber (integration)', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('produces CNL-<current year>-<6 digits>, incrementing by one on the next call', async () => {
    const currentYear = new Date().getFullYear();
    const pattern = new RegExp(`^CNL-${currentYear}-(\\d{6})$`);

    const first = await generateOrderNumber(AppDataSource);
    const second = await generateOrderNumber(AppDataSource);

    const firstMatch = first.match(pattern);
    const secondMatch = second.match(pattern);
    expect(firstMatch).not.toBeNull();
    expect(secondMatch).not.toBeNull();

    const firstSequence = Number(firstMatch![1]);
    const secondSequence = Number(secondMatch![1]);
    expect(secondSequence).toBe(firstSequence + 1);
  });
});
