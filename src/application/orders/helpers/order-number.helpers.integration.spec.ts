import { generateOrderNumber } from './order-number.helpers';
import { AppDataSource } from '../../../infrastructure/database/data-source';

/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * `order_number_seq` (SPEC 05 step 1) is a fresh global sequence with no
 * other consumer in this test suite, so the first two calls are
 * deterministically 000001 then 000002.
 */
describe('generateOrderNumber (integration)', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('produces CNL-<current year>-000001, then ...-000002 on the next call', async () => {
    const currentYear = new Date().getFullYear();

    const first = await generateOrderNumber(AppDataSource);
    const second = await generateOrderNumber(AppDataSource);

    expect(first).toBe(`CNL-${currentYear}-000001`);
    expect(second).toBe(`CNL-${currentYear}-000002`);
  });
});
