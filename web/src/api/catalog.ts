/**
 * Hardcoded seed catalogue (specs/08-observability-console.md, Decisions —
 * the API exposes no product/warehouse endpoints). Sources of truth, keep
 * in sync by hand:
 *   - customer, warehouses, products, stock: src/infrastructure/database/seed.ts
 *   - cities the static geocoder knows:     src/infrastructure/geocoding/us-cities.ts
 *   - test cards and their outcomes:        payments-mock/src/constants.ts, README.md
 */

export const FIXED_CUSTOMER = {
  id: 'c0000000-0000-0000-0000-000000000001',
  name: 'Fixed Test Customer',
  email: 'fixed.customer@example.com',
} as const;

export interface Warehouse {
  id: string;
  name: string;
  city: string;
}

export const WAREHOUSES: readonly Warehouse[] = [
  { id: 'a0000000-0000-0000-0000-000000000001', name: 'Newark DC', city: 'Newark, NJ' },
  { id: 'a0000000-0000-0000-0000-000000000002', name: 'Los Angeles DC', city: 'Los Angeles, CA' },
  { id: 'a0000000-0000-0000-0000-000000000003', name: 'Dallas DC', city: 'Dallas, TX' },
  { id: 'a0000000-0000-0000-0000-000000000004', name: 'Chicago DC', city: 'Chicago, IL' },
  { id: 'a0000000-0000-0000-0000-000000000005', name: 'Miami DC', city: 'Miami, FL' },
];

export interface Product {
  id: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  /** Scenario hint shown next to the product in the order form. */
  hint?: string;
}

const productId = (n: number) =>
  `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

export const PRODUCTS: readonly Product[] = [
  { id: productId(1), sku: 'APL-IP16-128-BLK', name: 'iPhone 16, 128GB, Black', unitPriceCents: 69900 },
  { id: productId(2), sku: 'APL-IP16-128-BLU-RFB', name: 'iPhone 16, 128GB, Blue (Refurbished)', unitPriceCents: 54900 },
  { id: productId(3), sku: 'APL-IP16P-256-NTI', name: 'iPhone 16 Pro, 256GB, Natural Titanium', unitPriceCents: 99900 },
  { id: productId(4), sku: 'APL-IP17-256-BLK', name: 'iPhone 17, 256GB, Black', unitPriceCents: 89900, hint: 'Stocked in Newark, Los Angeles and Miami' },
  { id: productId(5), sku: 'APL-IP17E-256-WHT', name: 'iPhone 17e, 256GB, White', unitPriceCents: 69900 },
  { id: productId(6), sku: 'APL-IPAIR-512-SBK', name: 'iPhone Air, 512GB, Space Black', unitPriceCents: 109900 },
  { id: productId(7), sku: 'APL-MBA13-M4-256', name: 'MacBook Air 13", M4, 256GB', unitPriceCents: 99900 },
  { id: productId(8), sku: 'APL-MBA13-M3-256-RFB', name: 'MacBook Air 13", M3, 256GB (Refurbished)', unitPriceCents: 74900 },
  { id: productId(9), sku: 'APL-MBP14-M4-512', name: 'MacBook Pro 14", M4, 512GB', unitPriceCents: 159900 },
  { id: productId(10), sku: 'APL-MBP16-M4P-1TB', name: 'MacBook Pro 16", M4 Pro, 1TB', unitPriceCents: 249900, hint: '2 per warehouse — quantity ≥ 3 returns 422 (no fulfilment)' },
  { id: productId(11), sku: 'APL-IPADAIR11-M3-128', name: 'iPad Air 11", M3, 128GB', unitPriceCents: 59900 },
  { id: productId(12), sku: 'APL-IPADAIR13-M3-256', name: 'iPad Air 13", M3, 256GB', unitPriceCents: 79900 },
  { id: productId(13), sku: 'APL-IPADPRO11-M4-256', name: 'iPad Pro 11", M4, 256GB', unitPriceCents: 99900, hint: 'Only 5 units, Newark only' },
  { id: productId(14), sku: 'APL-AIRPODSPRO3', name: 'AirPods Pro 3', unitPriceCents: 24900, hint: 'Only stocked in Newark' },
  { id: productId(15), sku: 'APL-AIRPODS4', name: 'AirPods 4', unitPriceCents: 12900 },
];

export interface City {
  city: string;
  state: string;
}

const CITY_KEYS = [
  'newark|NJ', 'los angeles|CA', 'dallas|TX', 'chicago|IL', 'miami|FL',
  'new york|NY', 'philadelphia|PA', 'san diego|CA', 'houston|TX', 'milwaukee|WI',
  'orlando|FL', 'seattle|WA', 'denver|CO', 'portland|OR', 'portland|ME',
  'boston|MA', 'atlanta|GA', 'phoenix|AZ', 'san francisco|CA', 'austin|TX',
  'san antonio|TX', 'charlotte|NC', 'columbus|OH', 'indianapolis|IN', 'san jose|CA',
  'detroit|MI', 'nashville|TN', 'memphis|TN', 'baltimore|MD', 'las vegas|NV',
  'minneapolis|MN', 'new orleans|LA',
];

const titleCase = (value: string) =>
  value.replace(/\b\w/g, (letter) => letter.toUpperCase());

export const CITIES: readonly City[] = CITY_KEYS.map((key) => {
  const [city, state] = key.split('|');
  return { city: titleCase(city), state };
}).sort((a, b) => a.city.localeCompare(b.city) || a.state.localeCompare(b.state));

export type CardOutcome = 'success' | 'error' | 'warning';

export interface TestCard {
  number: string;
  label: string;
  expectedStatus: string;
  expected: string;
  outcome: CardOutcome;
}

export const TEST_CARDS: readonly TestCard[] = [
  {
    number: '4242424242424242',
    label: 'Approved',
    expectedStatus: '201',
    expected: 'Order CONFIRMED, payment CAPTURED, 3 fan-out jobs queued.',
    outcome: 'success',
  },
  {
    number: '4000000000000002',
    label: 'Declined',
    expectedStatus: '402',
    expected: 'Order PAYMENT_FAILED, reserved stock released.',
    outcome: 'error',
  },
  {
    number: '4000000000090003',
    label: 'Provider error',
    expectedStatus: '502',
    expected: 'Provider returns 500 on every retry. 502 with orderId; payment UNKNOWN.',
    outcome: 'warning',
  },
  {
    number: '4000000000080004',
    label: 'Provider timeout',
    expectedStatus: '502',
    expected: 'Provider hangs ~30 s; API gives up after ~6 s with orderId. The worker reconciles it later.',
    outcome: 'warning',
  },
];

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PAYMENT_FAILED',
  'CANCELLED',
] as const;

export const DEFAULT_BASE_URL = 'http://localhost:3000';
export const GRAFANA_URL = 'http://localhost:3001';
