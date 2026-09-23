import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  generateTrackingNumber,
  pickRandomCarrier,
} from './helpers/shipment-mock.helpers';

/**
 * A subquery (not INSERT … SELECT) so a missing order or null warehouse_id
 * fails on warehouse_id NOT NULL instead of silently inserting nothing.
 * See knowledge/investigations.md#not-null-before-fk
 */
const INSERT_SHIPMENT_SQL = `
  INSERT INTO shipments (order_id, warehouse_id, status, carrier, tracking_number, dispatched_at)
  VALUES ($1, (SELECT warehouse_id FROM orders WHERE id = $1), 'DISPATCHED', $2, $3, $4)
  ON CONFLICT (order_id) DO NOTHING
`;

/**
 * ON CONFLICT (order_id) DO NOTHING makes a retry idempotent. Dispatch is
 * mocked: rows start DISPATCHED with a fake carrier/tracking number.
 * See knowledge/messaging-jobs.md#shipment-create
 */
@Injectable()
export class ShipmentService {
  constructor(private readonly dataSource: DataSource) {}

  async createForOrder(orderId: string): Promise<void> {
    const carrier = pickRandomCarrier();
    const trackingNumber = generateTrackingNumber(carrier);

    await this.dataSource.query(INSERT_SHIPMENT_SQL, [
      orderId,
      carrier,
      trackingNumber,
      new Date(),
    ]);
  }
}
