import { DataSource } from 'typeorm';

interface OrderNumberRow {
  order_number: string;
}

/**
 * CNL-<year>-<6 digits> from the global order_number_seq. Called once
 * before the failover loop so it's stable across retries.
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
