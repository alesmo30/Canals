import { randomUUID } from 'crypto';

import { OrdersReadRepository } from './orders-read.repository';
import { AppDataSource } from '../data-source';
import { CustomerOrmEntity } from '../entities/customer.orm-entity';
import { OrderOrmEntity } from '../entities/order.orm-entity';

/**
 * The base-case listing must use `idx_orders_keyset`. EXPLAINs the exact SQL
 * `findPage` sent (captured via a spy), so it can't drift.
 */
describe('OrdersReadRepository.findPage query plan (integration)', () => {
  let repo: OrdersReadRepository;

  beforeAll(async () => {
    await AppDataSource.initialize();
    repo = new OrdersReadRepository(AppDataSource);
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

  it('drives ORDER BY created_at DESC, id DESC off idx_orders_keyset (base case, no filters)', async () => {
    const customer = await AppDataSource.getRepository(CustomerOrmEntity).save({
      email: `${randomUUID()}@example.com`,
      fullName: 'Explain Test Customer',
    });

    // Enough rows for the planner's statistics to matter — not the
    // hundreds warehouse-selection.explain uses (that query joins on
    // selectivity; this one only needs the index to look worthwhile
    // against a plain ORDER BY + LIMIT).
    const baseTime = new Date('2026-03-01T00:00:00.000Z');
    for (let index = 0; index < 200; index += 1) {
      await AppDataSource.getRepository(OrderOrmEntity).save({
        orderNumber: `CNL-T-${randomUUID().slice(0, 20)}`,
        customerId: customer.id,
        warehouseId: null,
        status: 'PENDING_PAYMENT',
        currency: 'USD',
        totalCents: 1000,
        shippingAddress: {
          recipient: 'Test Recipient',
          line1: '1 Test Way',
          city: 'Test City',
          country: 'US',
        },
        shippingLocation: { type: 'Point', coordinates: [-74.006, 40.7128] },
        createdAt: new Date(baseTime.getTime() + index * 1000),
        updatedAt: new Date(baseTime.getTime() + index * 1000),
      });
    }
    await AppDataSource.query('ANALYZE orders');

    const originalQuery = AppDataSource.query.bind(AppDataSource);
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const querySpy = jest
      .spyOn(AppDataSource, 'query')
      .mockImplementation((sql, params) => {
        capturedSql = sql;
        capturedParams = (params as unknown[]) ?? [];
        return originalQuery(sql, params);
      });

    await repo.findPage({ pageSize: 20 });
    querySpy.mockRestore();

    const explainRows: { 'QUERY PLAN': { Plan: Record<string, unknown> }[] }[] =
      await AppDataSource.query(
        `EXPLAIN (FORMAT JSON) ${capturedSql}`,
        capturedParams,
      );
    const plan = explainRows[0]['QUERY PLAN'][0].Plan;

    const keysetScans = findNodes(plan, 'Index Scan').filter(
      (node) => node['Index Name'] === 'idx_orders_keyset',
    );
    expect(keysetScans.length).toBeGreaterThan(0);
  });
});
