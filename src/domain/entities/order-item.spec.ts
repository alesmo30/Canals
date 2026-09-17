import { OrderItem } from './order-item';
import { Money } from '../value-objects/money';

function makeOrderItem(quantity: number, unitPriceCents: number) {
  return new OrderItem({
    id: 'item-1',
    orderId: 'order-1',
    productId: 'prod-1',
    quantity,
    productSkuSnapshot: 'APL-IP15-128-BLK',
    productNameSnapshot: 'iPhone 15, 128GB, Black',
    unitPrice: Money.of(unitPriceCents),
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
}

describe('OrderItem', () => {
  it('computes the line total as quantity * unit price, exactly', () => {
    const item = makeOrderItem(3, 1099);

    expect(item.getLineTotal().getAmountCents()).toBe(3297);
  });

  it('rejects a zero or negative quantity (order_items CHECK > 0)', () => {
    expect(() => makeOrderItem(0, 1099)).toThrow(/positive integer/);
    expect(() => makeOrderItem(-1, 1099)).toThrow(/positive integer/);
  });

  it('rejects a non-integer quantity', () => {
    expect(() => makeOrderItem(1.5, 1099)).toThrow(/positive integer/);
  });

  it('carries the product snapshot fields, independent of the live product', () => {
    const item = makeOrderItem(1, 1099);

    expect(item.getProductSkuSnapshot()).toBe('APL-IP15-128-BLK');
    expect(item.getProductNameSnapshot()).toBe('iPhone 15, 128GB, Black');
  });
});
