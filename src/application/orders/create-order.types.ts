import { OrderLine } from '../allocation/allocation.types';
import { ShippingAddressProps } from '../../domain/value-objects/shipping-address';

/**
 * Threaded through all three saga phases; built once by the controller
 * from the validated DTO.
 */
export interface CreateOrderCommand {
  customerId: string;
  shippingAddress: ShippingAddressProps;
  lines: OrderLine[];
  cardNumber: string;
  idempotencyKey: string;
}
