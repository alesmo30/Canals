import { CITIES, FIXED_CUSTOMER, PRODUCTS, TEST_CARDS } from '../api/catalog';

export const OTHER_CITY = '__other__';

export interface CreateOrderValues {
  recipient: string;
  line1: string;
  line2: string;
  /** `City|ST` from the geocoder list, or OTHER_CITY to type one freely. */
  cityKey: string;
  otherCity: string;
  otherState: string;
  postalCode: string;
  items: { productId: string; quantity: number }[];
  cardNumber: string;
  idempotencyKey: string;
  correlationId: string;
  autoRegenerateKey: boolean;
}

export const cityKey = (city: string, state: string) => `${city}|${state}`;

export function createOrderDefaults(): CreateOrderValues {
  const newYork = CITIES.find((city) => city.city === 'New York')!;
  return {
    recipient: 'Ada Lovelace',
    line1: '1 Canal St',
    line2: '',
    cityKey: cityKey(newYork.city, newYork.state),
    otherCity: '',
    otherState: '',
    postalCode: '10013',
    // iPhone 17: the most widely stocked seed product (3 warehouses), so the
    // default form keeps succeeding after many demo runs.
    items: [{ productId: PRODUCTS.find((product) => product.sku === 'APL-IP17-256-BLK')!.id, quantity: 1 }],
    cardNumber: TEST_CARDS[0].number,
    idempotencyKey: crypto.randomUUID(),
    correlationId: '',
    autoRegenerateKey: true,
  };
}

/** The exact JSON body POST /orders receives (CreateOrderDto). */
export function toCreateOrderBody(values: CreateOrderValues) {
  const [city, state] =
    values.cityKey === OTHER_CITY
      ? [values.otherCity.trim(), values.otherState.trim().toUpperCase()]
      : values.cityKey.split('|');

  const shippingAddress: Record<string, string> = {
    recipient: values.recipient.trim(),
    line1: values.line1.trim(),
    city,
    country: 'US',
  };
  if (values.line2.trim()) {
    shippingAddress.line2 = values.line2.trim();
  }
  if (state) {
    shippingAddress.state = state;
  }
  if (values.postalCode.trim()) {
    shippingAddress.postalCode = values.postalCode.trim();
  }

  return {
    customerId: FIXED_CUSTOMER.id,
    shippingAddress,
    items: values.items.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
    })),
    payment: { cardNumber: values.cardNumber },
  };
}

export function toCreateOrderHeaders(values: CreateOrderValues) {
  return {
    'Idempotency-Key': values.idempotencyKey.trim(),
    'X-Correlation-Id': values.correlationId.trim() || undefined,
  };
}
