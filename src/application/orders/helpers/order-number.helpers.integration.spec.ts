import { generateOrderNumber } from './order-number.helpers';
import { AppDataSource } from '../../../infrastructure/database/data-source';

/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * `order_number_seq` (SPEC 05 step 1) is a real Postgres sequence, shared
 * and never reset across the whole test run (and across prior runs) —
 * other integration tests/e2e specs call `generateOrderNumber` too, so
 * this asserts the format and the "next call increments by exactly one"
 * behaviour, never an absolute starting value.
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
