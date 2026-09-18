import { AppDataSource } from './data-source';

/**
 * R0.8 (frozen contract). Hardcoded UUIDs + `ON CONFLICT DO NOTHING`:
 * idempotent, so running this twice never duplicates a row, and later
 * phases' tests can reference these ids directly without querying for
 * them first (specs/01-foundation.md, Decisions).
 *
 * Raw SQL, not repository.save()/upsert() — TypeORM's upsert() does
 * "ON CONFLICT DO UPDATE", not "DO NOTHING"; getting the exact conflict
 * behaviour this file needs means writing the SQL directly, same as the
 * migration does for the same reason.
 */

// P1's fixed customer (specs/02-fulfilment-core.md, Scope + Decisions):
// exists so an `orders` row can be inserted without inventing a customer
// per test. Hardcoded UUID, ON CONFLICT DO NOTHING like every other
// seeded row. P4 reuses it for its demo.
const CUSTOMER = {
  id: 'c0000000-0000-0000-0000-000000000001',
  email: 'fixed.customer@example.com',
  fullName: 'Fixed Test Customer',
};

const WAREHOUSES = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Newark DC',
    city: 'Newark',
    state: 'NJ',
    latitude: 40.735657,
    longitude: -74.172363,
  },
  {
    id: 'a0000000-0000-0000-0000-000000000002',
    name: 'Los Angeles DC',
    city: 'Los Angeles',
    state: 'CA',
    latitude: 34.052235,
    longitude: -118.243683,
  },
  {
    id: 'a0000000-0000-0000-0000-000000000003',
    name: 'Dallas DC',
    city: 'Dallas',
    state: 'TX',
    latitude: 32.776664,
    longitude: -96.796988,
  },
  {
    id: 'a0000000-0000-0000-0000-000000000004',
    name: 'Chicago DC',
    city: 'Chicago',
    state: 'IL',
    latitude: 41.878113,
    longitude: -87.629799,
  },
  {
    id: 'a0000000-0000-0000-0000-000000000005',
    name: 'Miami DC',
    city: 'Miami',
    state: 'FL',
    latitude: 25.761681,
    longitude: -80.191788,
  },
] as const;

// Prices and storage tiers checked against current listings (September
// 2026) — see the commit message for sources. Deliberately stays on the
// iPhone 16/17 generation, not 18, per an explicit request; the newest
// generation at seed-writing time was left out on purpose, not missed.
const PRODUCTS = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    sku: 'APL-IP16-128-BLK',
    name: 'iPhone 16, 128GB, Black',
    condition: 'NEW',
    unitPriceCents: 69900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    sku: 'APL-IP16-128-BLU-RFB',
    name: 'iPhone 16, 128GB, Blue (Refurbished)',
    condition: 'REFURBISHED',
    unitPriceCents: 54900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    sku: 'APL-IP16P-256-NTI',
    name: 'iPhone 16 Pro, 256GB, Natural Titanium',
    condition: 'NEW',
    unitPriceCents: 99900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000004',
    sku: 'APL-IP17-256-BLK',
    name: 'iPhone 17, 256GB, Black',
    condition: 'NEW',
    unitPriceCents: 89900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000005',
    sku: 'APL-IP17E-256-WHT',
    name: 'iPhone 17e, 256GB, White',
    condition: 'NEW',
    unitPriceCents: 69900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000006',
    sku: 'APL-IPAIR-512-SBK',
    name: 'iPhone Air, 512GB, Space Black',
    condition: 'NEW',
    unitPriceCents: 109900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000007',
    sku: 'APL-MBA13-M4-256',
    name: 'MacBook Air 13", M4, 256GB',
    condition: 'NEW',
    unitPriceCents: 99900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000008',
    sku: 'APL-MBA13-M3-256-RFB',
    name: 'MacBook Air 13", M3, 256GB (Refurbished)',
    condition: 'REFURBISHED',
    unitPriceCents: 74900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000009',
    sku: 'APL-MBP14-M4-512',
    name: 'MacBook Pro 14", M4, 512GB',
    condition: 'NEW',
    unitPriceCents: 159900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000010',
    sku: 'APL-MBP16-M4P-1TB',
    name: 'MacBook Pro 16", M4 Pro, 1TB',
    condition: 'NEW',
    unitPriceCents: 249900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000011',
    sku: 'APL-IPADAIR11-M3-128',
    name: 'iPad Air 11", M3, 128GB',
    condition: 'NEW',
    unitPriceCents: 59900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000012',
    sku: 'APL-IPADAIR13-M3-256',
    name: 'iPad Air 13", M3, 256GB',
    condition: 'NEW',
    unitPriceCents: 79900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000013',
    sku: 'APL-IPADPRO11-M4-256',
    name: 'iPad Pro 11", M4, 256GB',
    condition: 'NEW',
    unitPriceCents: 99900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000014',
    sku: 'APL-AIRPODSPRO3',
    name: 'AirPods Pro 3',
    condition: 'NEW',
    unitPriceCents: 24900,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000015',
    sku: 'APL-AIRPODS4',
    name: 'AirPods 4',
    condition: 'NEW',
    unitPriceCents: 12900,
  },
] as const;

// warehouse index -> { product index -> quantity_available }. Indexes are
// 0-based into WAREHOUSES / PRODUCTS above.
//
// R0.8's four required scenarios, by product:
//   [13] AirPods Pro 3        -> scenario 1: exactly one warehouse (Newark) has it
//   [3]  iPhone 17            -> scenario 2: three warehouses spread across the
//                                 country (Newark/LA/Miami), so "nearest" is
//                                 unambiguous for any reasonable shipping address
//   [9]  MacBook Pro 16" Pro  -> scenario 3: 2 units everywhere, no single
//                                 warehouse can fill a request for more than 2 —
//                                 and orders never split across warehouses (C-6)
//   [12] iPad Pro 11"         -> scenario 4: exactly 5 units, Newark only — the
//                                 boundary case P6's concurrency proof needs
const INVENTORY: Record<number, Record<number, number>> = {
  0: { 0: 25, 2: 15, 3: 30, 5: 10, 6: 12, 9: 2, 10: 20, 12: 5, 13: 50, 14: 40 }, // Newark
  1: { 1: 10, 3: 25, 4: 20, 5: 8, 7: 5, 8: 6, 9: 2, 14: 35 }, // Los Angeles
  2: { 0: 20, 4: 18, 7: 10, 9: 2, 10: 15, 14: 30 }, // Dallas
  3: { 0: 15, 2: 10, 6: 8, 9: 2, 11: 10, 14: 25 }, // Chicago
  4: { 1: 8, 3: 20, 6: 6, 8: 4, 9: 2, 11: 8, 14: 20 }, // Miami
};

async function seed(): Promise<void> {
  await AppDataSource.initialize();

  await AppDataSource.query(
    `INSERT INTO customers (id, email, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [CUSTOMER.id, CUSTOMER.email, CUSTOMER.fullName],
  );

  for (const w of WAREHOUSES) {
    await AppDataSource.query(
      `INSERT INTO warehouses (id, name, address, location, is_active)
       VALUES ($1, $2, $3::jsonb, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        w.id,
        w.name,
        JSON.stringify({
          line1: `1 ${w.name} Way`,
          city: w.city,
          state: w.state,
          country: 'US',
        }),
        w.longitude, // ST_MakePoint takes (longitude, latitude) — see coordinates.ts's own guard against this exact ordering mistake
        w.latitude,
      ],
    );
  }

  for (const p of PRODUCTS) {
    await AppDataSource.query(
      `INSERT INTO products (id, sku, name, condition, unit_price_cents, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.sku, p.name, p.condition, p.unitPriceCents],
    );
  }

  for (const [warehouseIndex, byProduct] of Object.entries(INVENTORY)) {
    const warehouse = WAREHOUSES[Number(warehouseIndex)];
    for (const [productIndex, quantity] of Object.entries(byProduct)) {
      const product = PRODUCTS[Number(productIndex)];
      await AppDataSource.query(
        `INSERT INTO inventory (warehouse_id, product_id, quantity_available, quantity_reserved)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
        [warehouse.id, product.id, quantity],
      );
    }
  }

  console.log(
    `Seeded 1 customer, ${WAREHOUSES.length} warehouses, ${PRODUCTS.length} products, ` +
      `${Object.values(INVENTORY).reduce((n, byProduct) => n + Object.keys(byProduct).length, 0)} inventory rows.`,
  );

  await AppDataSource.destroy();
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
