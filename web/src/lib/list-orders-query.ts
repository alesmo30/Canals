import { FIXED_CUSTOMER } from '../api/catalog';

export interface ListOrdersValues {
  onlyFixedCustomer: boolean;
  status: string;
  warehouseId: string;
  createdAtFrom: string;
  createdAtTo: string;
  pageSize: number;
}

export const LIST_ORDERS_DEFAULTS: ListOrdersValues = {
  onlyFixedCustomer: true,
  status: '',
  warehouseId: '',
  createdAtFrom: '',
  createdAtTo: '',
  pageSize: 10,
};

/** Query params exactly as GET /orders expects them (ListOrdersQueryDto). */
export function toListQuery(
  values: ListOrdersValues,
  cursor?: string,
): Record<string, string | undefined> {
  const iso = (value: string) => (value ? new Date(value).toISOString() : undefined);
  return {
    customerId: values.onlyFixedCustomer ? FIXED_CUSTOMER.id : undefined,
    status: values.status || undefined,
    warehouseId: values.warehouseId || undefined,
    createdAtFrom: iso(values.createdAtFrom),
    createdAtTo: iso(values.createdAtTo),
    pageSize: String(values.pageSize),
    cursor,
  };
}
