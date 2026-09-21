import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * `warehouse_id` comes from a subquery against the *same* `$1` rather than
 * `INSERT ... SELECT ... FROM orders`, so a non-existent `orderId` still
 * reaches the `INSERT` (and its `order_id` foreign key) instead of the
 * `SELECT` silently matching zero rows. Two failure modes, both database
 * constraints, no application-level branching (`references/layering.md`'s
 * domain-service test — shipments.orm-entity.ts's own comment: "its only
 * rule is the UNIQUE(order_id) constraint... not in-memory logic"):
 * - `orderId` does not exist in `orders` → the subquery returns `NULL`,
 *   and the insert violates `order_id`'s `REFERENCES orders (id)`.
 * - `orderId` exists but its `warehouse_id` is `NULL` → the subquery
 *   returns `NULL`, and the insert violates `warehouse_id NOT NULL`.
 * Either way nothing is written — no partial row (R3.4).
 */
const INSERT_SHIPMENT_SQL = `
  INSERT INTO shipments (order_id, warehouse_id, status)
  VALUES ($1, (SELECT warehouse_id FROM orders WHERE id = $1), 'PENDING_DISPATCH')
  ON CONFLICT (order_id) DO NOTHING
`;

/**
 * SPEC 04 Scope: "INSERT INTO shipments … ON CONFLICT (order_id) DO
 * NOTHING, status PENDING_DISPATCH, warehouse_id read from the order".
 * `ON CONFLICT (order_id) DO NOTHING` is the idempotency: running this
 * twice for the same order inserts once and errors never (R3.4).
 */
@Injectable()
export class ShipmentService {
  constructor(private readonly dataSource: DataSource) {}

  async createForOrder(orderId: string): Promise<void> {
    await this.dataSource.query(INSERT_SHIPMENT_SQL, [orderId]);
  }
}
