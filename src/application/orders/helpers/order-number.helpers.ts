import { DataSource } from 'typeorm';

interface OrderNumberRow {
  order_number: string;
}

/**
 * specs/05-order-creation-saga.md — `CNL-<year>-<6 digits>`, backed by the
 * `order_number_seq` global sequence. Called once, before
 * `AllocateInventoryUseCase`'s failover loop, so the number stays stable
 * across retries (Decisions).
 */
export async function generateOrderNumber(
  dataSource: DataSource,
): Promise<string> {
  const [row]: OrderNumberRow[] = await dataSource.query(
    `SELECT 'CNL-' || extract(year from now()) || '-' ||
       lpad(nextval('order_number_seq')::text, 6, '0') AS order_number`,
  );

  return row.order_number;
}
