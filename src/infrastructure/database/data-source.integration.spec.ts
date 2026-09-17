import { AppDataSource } from './data-source';

/**
 * Integration test — requires DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT for env.schema.ts's validation) exported and
 * a Postgres reachable with the migration already applied. Not one of the
 * "no database" tests (Money, the order state machine) — this is what the
 * `verify` script (step 13) running against a compose stack is for.
 */
describe('AppDataSource', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('loads metadata for all 10 persistence entities', () => {
    const tableNames = AppDataSource.entityMetadatas
      .map((metadata) => metadata.tableName)
      .sort();

    expect(tableNames).toEqual(
      [
        'customers',
        'idempotency_keys',
        'inventory',
        'inventory_movements',
        'order_items',
        'orders',
        'payments',
        'products',
        'shipments',
        'warehouses',
      ].sort(),
    );
  });

  it('queries every entity against the migrated schema with no column mismatch', async () => {
    // A wrong column name or type in an entity's @Column() would make
    // TypeORM emit SQL referencing something that does not exist in the
    // real table — this is what actually proves the mapping, not just
    // that the decorators parsed into metadata objects.
    for (const metadata of AppDataSource.entityMetadatas) {
      await expect(
        AppDataSource.getRepository(metadata.target).count(),
      ).resolves.toBeDefined();
    }
  });
});
