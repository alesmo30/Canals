import { Order, OrderProps } from './order';
import { OrderStatus } from '../enum-types/order-status';
import { Coordinates } from '../value-objects/coordinates';
import { Money } from '../value-objects/money';
import { ShippingAddress } from '../value-objects/shipping-address';

function makeOrder(
  status: OrderStatus,
  overrides: Partial<OrderProps> = {},
): Order {
  return new Order({
    id: 'order-1',
    orderNumber: 'CNL-2026-000123',
    customerId: 'customer-1',
    warehouseId: 'warehouse-1',
    status,
    total: Money.of(1999),
    shippingAddress: ShippingAddress.of({
      recipient: 'Jane Doe',
      line1: '1 Apple Park Way',
      city: 'Cupertino',
      country: 'US',
    }),
    shippingLocation: Coordinates.of({
      latitude: 37.334606,
      longitude: -122.009102,
    }),
    reservationExpiresAt: null,
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

describe('Order status transitions', () => {
  describe('markPaid', () => {
    it('moves PENDING_PAYMENT -> PAID', () => {
      const order = makeOrder('PENDING_PAYMENT');

      order.markPaid();

      expect(order.getStatus()).toBe('PAID');
    });

    it.each<OrderStatus>(['PAID', 'CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'])(
      'rejects markPaid from %s',
      (status) => {
        expect(() => makeOrder(status).markPaid()).toThrow(
          `Illegal order status transition: ${status} -> PAID`,
        );
      },
    );
  });

  describe('markPaymentFailed', () => {
    it('moves PENDING_PAYMENT -> PAYMENT_FAILED', () => {
      const order = makeOrder('PENDING_PAYMENT');

      order.markPaymentFailed();

      expect(order.getStatus()).toBe('PAYMENT_FAILED');
    });

    it.each<OrderStatus>(['PAID', 'CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'])(
      'rejects markPaymentFailed from %s',
      (status) => {
        expect(() => makeOrder(status).markPaymentFailed()).toThrow(
          `Illegal order status transition: ${status} -> PAYMENT_FAILED`,
        );
      },
    );
  });

  describe('confirm', () => {
    it('moves PAID -> CONFIRMED and records confirmedAt', () => {
      const order = makeOrder('PAID');

      order.confirm();

      expect(order.getStatus()).toBe('CONFIRMED');
      expect(order.getConfirmedAt()).not.toBeNull();
    });

    it.each<OrderStatus>([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PAYMENT_FAILED',
      'CANCELLED',
    ])('rejects confirm from %s', (status) => {
      expect(() => makeOrder(status).confirm()).toThrow(
        `Illegal order status transition: ${status} -> CONFIRMED`,
      );
    });
  });

  describe('cancel', () => {
    it('moves PENDING_PAYMENT -> CANCELLED and records the reason', () => {
      const order = makeOrder('PENDING_PAYMENT');

      order.cancel('reservation expired');

      expect(order.getStatus()).toBe('CANCELLED');
      expect(order.getCancelledAt()).not.toBeNull();
      expect(order.getCancellationReason()).toBe('reservation expired');
    });

    it.each<OrderStatus>(['PAID', 'CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'])(
      'rejects cancel from %s',
      (status) => {
        expect(() => makeOrder(status).cancel('any reason')).toThrow(
          `Illegal order status transition: ${status} -> CANCELLED`,
        );
      },
    );

    it('never lets a PAYMENT_FAILED order reach CANCELLED, despite the diagram arrow', () => {
      expect(() =>
        makeOrder('PAYMENT_FAILED').cancel('retried cancellation'),
      ).toThrow('Illegal order status transition: PAYMENT_FAILED -> CANCELLED');
    });
  });

  it('does not compile when assigning to status directly, only named methods may change it', () => {
    const order = makeOrder('PENDING_PAYMENT');
    // Order has no public status property, only getStatus() — a direct assignment is
    // a compile error (TS2339: no such property), not merely a bad runtime value. If
    // a future edit ever adds a public `status` field, the directive below starts
    // reporting "unused" and this test fails loudly instead of silently passing.
    // @ts-expect-error status is read-only via getStatus(); it is not a settable property.
    order.status = 'CONFIRMED';
  });
});
