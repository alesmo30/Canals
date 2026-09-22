import { OrderLine } from '../allocation/allocation.types';
import { ShippingAddressProps } from '../../domain/value-objects/shipping-address';

/**
 * specs/05-order-creation-saga.md — threaded through all three phases of
 * the saga (steps 9-11). `cardNumber`/`idempotencyKey` are unused by
 * Phase 1 (reserve) but travel with the command so the controller (step
 * 12) builds it once, from the validated `CreateOrderDto`.
 */
export interface CreateOrderCommand {
  customerId: string;
  shippingAddress: ShippingAddressProps;
  lines: OrderLine[];
  cardNumber: string;
  idempotencyKey: string;
}
