import type { RequestKind } from '../store/executions';

export interface RequestOption {
  kind: RequestKind;
  method: 'GET' | 'POST';
  path: string;
  title: string;
  description: string;
}

export const REQUEST_OPTIONS: readonly RequestOption[] = [
  {
    kind: 'CREATE_ORDER',
    method: 'POST',
    path: '/orders',
    title: 'Create order',
    description: 'Runs the saga: reserve stock, charge the card, confirm.',
  },
  {
    kind: 'LIST_ORDERS',
    method: 'GET',
    path: '/orders',
    title: 'List orders',
    description: 'Keyset-paginated listing with filters.',
  },
  {
    kind: 'GET_ORDER',
    method: 'GET',
    path: '/orders/:id',
    title: 'Get order',
    description: 'Full detail: items, payments, shipment.',
  },
];
