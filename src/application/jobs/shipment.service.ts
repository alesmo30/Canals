import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  generateTrackingNumber,
  pickRandomCarrier,
} from './helpers/shipment-mock.helpers';

/**
 * `warehouse_id` comes from a subquery against the *same* `$1` rather than
 * `INSERT ... SELECT ... FROM orders`, so a non-existent `orderId` still
 * reaches the `INSERT` instead of the `SELECT` silently matching zero rows
 * and writing nothing at all. Nothing is ever written — no partial row
 * (R3.4) — no application-level branching either
 * (`references/layering.md`'s domain-service test — shipments.orm-entity.ts's
 * own comment: "its only rule is the UNIQUE(order_id) constraint... not
 * in-memory logic"):
 * - `orderId` exists but its `warehouse_id` is `NULL` → the subquery
 *   returns `NULL`, and the insert violates `warehouse_id NOT NULL`.
 * - `orderId` does not exist in `orders` → the subquery *also* returns
 *   `NULL` (no matching row), so this hits the exact same `warehouse_id
 *   NOT NULL` violation, not `order_id`'s `REFERENCES orders (id)` —
 *   verified directly in psql: Postgres checks `NOT NULL` constraints
 *   (`ExecConstraints`, before the row is even built) ahead of `FOREIGN
 *   KEY` triggers (which only run on a row that has already been
 *   inserted), so a `NOT NULL` violation always wins when both would
 *   otherwise fire. There is no query shape that reaches the `order_id`
 *   foreign key here without first resolving a non-null `warehouse_id` —
 *   which a genuinely missing order can never supply (SPEC 04 step 6,
 *   deviation from the phase's literal "foreign-key violation" wording;
 *   the mechanism it exists to prove — fails without a partial row, the
 *   other two queues unaffected — holds regardless of which `NOT NULL`
 *   database constraint reports it).
 */
const INSERT_SHIPMENT_SQL = `
  INSERT INTO shipments (order_id, warehouse_id, status, carrier, tracking_number, dispatched_at)
  VALUES ($1, (SELECT warehouse_id FROM orders WHERE id = $1), 'DISPATCHED', $2, $3, $4)
  ON CONFLICT (order_id) DO NOTHING
`;

/**
 * SPEC 04 Scope: "INSERT INTO shipments … ON CONFLICT (order_id) DO
 * NOTHING … warehouse_id read from the order".
 * `ON CONFLICT (order_id) DO NOTHING` is the idempotency: running this
 * twice for the same order inserts once and errors never (R3.4) — a
 * pg-boss retry after a successful first insert simply discards its own
 * freshly-generated carrier/tracking values instead of overwriting them.
 *
 * Deliberate deviation from specs/04-queue-worker-observability.md
 * ("shipment lifecycle transitions beyond PENDING_DISPATCH... goes in its
 * own spec"): requested for local QA/demo so a shipment is inspectable as
 * dispatched immediately, without adding a delayed pg-boss job or any new
 * queue. `status` starts at `DISPATCHED` with a random-but-carrier-shaped
 * `carrier`/`tracking_number`/`dispatched_at` instead of `PENDING_DISPATCH`
 * with nulls. `delivered_at` stays null — only dispatch is mocked.
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
