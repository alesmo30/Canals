import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { AppDataSource } from '../data-source';

/**
 * R1.2's EXPLAIN assertion. Runs inside its own transaction — several
 * hundred synthetic warehouses and the ANALYZE that follows both roll
 * back with it, so this test leaves nothing behind for the rest of the
 * suite. Integration test — same prerequisites as the sibling
 * warehouse-selection.repository.integration.spec.ts.
 *
 * specs/02-fulfilment-core.md, step 4: capture what the planner actually
 * does with the inventory/product join present, assert on that captured
 * shape, and record the plan + reason in the spec's Decisions if it
 * deviates from an Index Scan using idx_warehouses_location_gist. It
 * does deviate here — see below and the spec's Decisions section for the
 * full captured plan.
 */
describe('select-warehouse.sql query plan (integration)', () => {
  const sql = readFileSync(
    join(__dirname, '../sql/select-warehouse.sql'),
    'utf-8',
  );

  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  /** Depth-first search for every node of the given Node Type in a Postgres EXPLAIN (FORMAT JSON) plan tree. */
  function findNodes(
    node: Record<string, unknown>,
    nodeType: string,
  ): Record<string, unknown>[] {
    const matches: Record<string, unknown>[] = [];
    if (node['Node Type'] === nodeType) {
      matches.push(node);
    }
    const children = node['Plans'] as Record<string, unknown>[] | undefined;
    if (children) {
      for (const child of children) {
        matches.push(...findNodes(child, nodeType));
      }
    }
    return matches;
  }

  it('either drives the ORDER BY off idx_warehouses_location_gist, or — the documented fallback — never full-scans warehouses', async () => {
    const runner = AppDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      const product = (await runner.query(
        `INSERT INTO products (sku, name, condition, unit_price_cents, is_active)
         VALUES ($1, 'EXPLAIN test product', 'NEW', 1000, true)
         RETURNING id`,
        [`SKU-${randomUUID()}`],
      )) as { id: string }[];
      const productId: string = product[0].id;

      // Several hundred synthetic warehouses, scattered across the
      // continental US so distances vary meaningfully.
      const warehouseCount = 500;
      const whValues: string[] = [];
      const whParams: unknown[] = [];
      for (let i = 0; i < warehouseCount; i++) {
        const latitude = 25 + Math.random() * 24;
        const longitude = -124 + Math.random() * 58;
        const base = whParams.length;
        whValues.push(
          `($${base + 1}, '{}'::jsonb, ST_SetSRID(ST_MakePoint($${base + 2}, $${base + 3}), 4326)::geography, true)`,
        );
        whParams.push(`EXPLAIN synthetic WH ${i}`, longitude, latitude);
      }
      const inserted = (await runner.query(
        `INSERT INTO warehouses (name, address, location, is_active)
         VALUES ${whValues.join(', ')}
         RETURNING id`,
        whParams,
      )) as { id: string }[];

      // A realistic, partial selectivity: roughly a third of the
      // synthetic warehouses can actually supply the product, not all
      // and not none — the shape a real catalogue would have.
      const invValues: string[] = [];
      const invParams: unknown[] = [];
      for (const warehouse of inserted) {
        if (Math.random() > 1 / 3) continue;
        const base = invParams.length;
        invValues.push(`($${base + 1}, $${base + 2}, 50, 0)`);
        invParams.push(warehouse.id, productId);
      }
      await runner.query(
        `INSERT INTO inventory (warehouse_id, product_id, quantity_available, quantity_reserved)
         VALUES ${invValues.join(', ')}`,
        invParams,
      );

      await runner.query('ANALYZE warehouses');
      await runner.query('ANALYZE inventory');
      await runner.query('ANALYZE products');

      const [explainResult] = (await runner.query(
        `EXPLAIN (FORMAT JSON) ${sql}`,
        ['POINT(-98 39)', [productId], [1]],
      )) as { 'QUERY PLAN': { Plan: Record<string, unknown> }[] }[];
      const plan = explainResult['QUERY PLAN'][0].Plan;

      const gistScans = findNodes(plan, 'Index Scan').filter(
        (node) => node['Index Name'] === 'idx_warehouses_location_gist',
      );

      if (gistScans.length > 0) {
        // The ideal path: the GiST index drives the ordering directly.
        expect(gistScans[0]['Order By']).toBeDefined();
      } else {
        // The documented fallback (spec Decisions / Risks): the eligible
        // CTE is computed first, `warehouses` is reached only through
        // its primary key for the (small) eligible set, and that small
        // set is sorted directly — never a sequential scan of all 500.
        const warehouseSeqScans = findNodes(plan, 'Seq Scan').filter(
          (node) => node['Relation Name'] === 'warehouses',
        );
        expect(warehouseSeqScans).toEqual([]);

        const warehousePkeyScans = findNodes(plan, 'Index Scan').filter(
          (node) => node['Relation Name'] === 'warehouses',
        );
        expect(warehousePkeyScans.length).toBeGreaterThan(0);
        expect(warehousePkeyScans[0]['Index Name']).toBe('warehouses_pkey');

        // Captured for the spec's Decisions section (pasted there, not
        // re-pasted on every run).
        console.log(
          'select-warehouse.sql plan (fallback path):',
          JSON.stringify(plan, null, 2),
        );
      }
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
