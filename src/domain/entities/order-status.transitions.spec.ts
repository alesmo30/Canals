import {
  assertValidOrderTransition,
  canTransitionOrderStatus,
  isTerminalOrderStatus,
} from './order-status.transitions';
import { OrderStatus } from '../enum-types/order-status';

describe('order status transitions', () => {
  describe('legal transitions', () => {
    it.each<[OrderStatus, OrderStatus]>([
      ['PENDING_PAYMENT', 'PAID'],
      ['PENDING_PAYMENT', 'PAYMENT_FAILED'],
      ['PENDING_PAYMENT', 'CANCELLED'],
      ['PAID', 'CONFIRMED'],
    ])('allows %s -> %s', (from, to) => {
      expect(canTransitionOrderStatus(from, to)).toBe(true);
      expect(() => assertValidOrderTransition(from, to)).not.toThrow();
    });
  });

  describe('terminal states reject every outgoing transition', () => {
    const allStatuses: OrderStatus[] = [
      'PENDING_PAYMENT',
      'PAID',
      'CONFIRMED',
      'PAYMENT_FAILED',
      'CANCELLED',
    ];
    const terminalStatuses: OrderStatus[] = [
      'CONFIRMED',
      'PAYMENT_FAILED',
      'CANCELLED',
    ];

    it.each(terminalStatuses)('%s is classified as terminal', (status) => {
      expect(isTerminalOrderStatus(status)).toBe(true);
    });

    it.each(terminalStatuses)('rejects every transition out of %s', (from) => {
      for (const to of allStatuses) {
        expect(canTransitionOrderStatus(from, to)).toBe(false);
        expect(() => assertValidOrderTransition(from, to)).toThrow(
          `Illegal order status transition: ${from} -> ${to}`,
        );
      }
    });

    // The diagram's PAYMENT_FAILED → CANCELLED arrow is ruled out (see
    // ORDER_TRANSITIONS).
    it('rejects PAYMENT_FAILED -> CANCELLED specifically', () => {
      expect(canTransitionOrderStatus('PAYMENT_FAILED', 'CANCELLED')).toBe(
        false,
      );
    });
  });

  it('PENDING_PAYMENT and PAID are not terminal', () => {
    expect(isTerminalOrderStatus('PENDING_PAYMENT')).toBe(false);
    expect(isTerminalOrderStatus('PAID')).toBe(false);
  });

  it('rejects skipping straight from PENDING_PAYMENT to CONFIRMED', () => {
    expect(canTransitionOrderStatus('PENDING_PAYMENT', 'CONFIRMED')).toBe(
      false,
    );
  });
});
