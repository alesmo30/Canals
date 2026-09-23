import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hand-written SQL: PostGIS geography, generated columns, the GiST index and
 * the partial unique index aren't reliably produced by `migration:generate`.
 */
export class InitialSchema1789596059697 implements MigrationInterface {
  name = 'InitialSchema1789596059697';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostGIS first — every geography column depends on it.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // --- Enums (data-model.dbml) ---------------------------------------

    await queryRunner.query(`
      CREATE TYPE order_status AS ENUM (
        'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE payment_status AS ENUM (
        'PENDING', 'AUTHORIZED', 'CAPTURED', 'DECLINED', 'FAILED', 'UNKNOWN', 'REFUNDED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE shipment_status AS ENUM (
        'PENDING_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE product_condition AS ENUM (
        'NEW', 'REFURBISHED', 'OPEN_BOX', 'USED'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE inventory_movement_type AS ENUM (
        'RESERVE', 'RELEASE', 'COMMIT', 'RESTOCK', 'ADJUST'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE idempotency_state AS ENUM (
        'IN_PROGRESS', 'COMPLETED'
      );
    `);

    // --- Reference data (data-model.dbml) -------------------------------

    // Pre-existing data. Referenced by orders but never mutated by this service.
    await queryRunner.query(`
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(320) NOT NULL UNIQUE,
        full_name varchar(200) NOT NULL,
        phone varchar(32),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    // Condition lives on the product, not on inventory: a refurbished
    // iPhone is a distinct SKU at a distinct price (data-model.dbml note).
    await queryRunner.query(`
      CREATE TABLE products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku varchar(64) NOT NULL UNIQUE,
        name varchar(200) NOT NULL,
        description text,
        condition product_condition NOT NULL DEFAULT 'NEW',
        unit_price_cents bigint NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_products_is_active ON products (is_active);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_products_condition ON products (condition);`,
    );

    // Warehouses are seeded, never geocoded at request time. latitude/longitude
    // are generated from location so they can't drift.
    await queryRunner.query(`
      CREATE TABLE warehouses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(200) NOT NULL,
        address jsonb NOT NULL,
        location geography(Point, 4326) NOT NULL,
        latitude numeric(9, 6) GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
        longitude numeric(9, 6) GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_warehouses_location_gist ON warehouses USING gist (location);
    `);
    await queryRunner.query(
      `CREATE INDEX idx_warehouses_is_active ON warehouses (is_active);`,
    );

    // --- The concurrency hot path (data-model.dbml) ---------------------

    // Rows are locked with SELECT ... FOR UPDATE ORDER BY product_id during
    // reservation. CHECK constraints are the backstop: application logic is
    // never trusted alone to prevent overselling (data-model.dbml note).
    await queryRunner.query(`
      CREATE TABLE inventory (
        warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
        quantity_available integer NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
        quantity_reserved integer NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
        version integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (warehouse_id, product_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_by_product ON inventory (product_id, warehouse_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_availability ON inventory (product_id, quantity_available);
    `);

    // --- Orders -----------------------------------------------------------

    await queryRunner.query(`
      CREATE TABLE orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number varchar(32) NOT NULL UNIQUE,
        customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
        warehouse_id uuid REFERENCES warehouses (id) ON DELETE RESTRICT,
        status order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
        currency char(3) NOT NULL DEFAULT 'USD',
        total_cents bigint NOT NULL,
        shipping_address jsonb NOT NULL,
        shipping_location geography(Point, 4326) NOT NULL,
        reservation_expires_at timestamptz,
        confirmed_at timestamptz,
        cancelled_at timestamptz,
        cancellation_reason varchar(300),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_orders_keyset ON orders (created_at, id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_orders_reaper ON orders (status, reservation_expires_at);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_orders_warehouse ON orders (warehouse_id);
    `);

    await queryRunner.query(`
      CREATE TABLE order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
        quantity integer NOT NULL CHECK (quantity > 0),
        product_sku_snapshot varchar(64) NOT NULL,
        product_name_snapshot varchar(200) NOT NULL,
        unit_price_cents bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_order_items_order_product ON order_items (order_id, product_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_order_items_product ON order_items (product_id);
    `);

    // --- Payments -----------------------------------------------------------

    await queryRunner.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
        attempt smallint NOT NULL DEFAULT 1,
        provider varchar(32) NOT NULL DEFAULT 'mock-gateway',
        provider_payment_id varchar(128),
        idempotency_key varchar(128) NOT NULL UNIQUE,
        status payment_status NOT NULL DEFAULT 'PENDING',
        amount_cents bigint NOT NULL,
        currency char(3) NOT NULL DEFAULT 'USD',
        card_last4 char(4),
        card_brand varchar(20),
        failure_code varchar(64),
        raw_response jsonb,
        settled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_payments_order_attempt ON payments (order_id, attempt);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_payments_reconciliation ON payments (status, created_at);
    `);
    // At most one CAPTURED payment per order (data-model.dbml note).
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_payments_one_captured_per_order ON payments (order_id) WHERE status = 'CAPTURED';
    `);

    // --- Fulfilment -----------------------------------------------------------

    // Written by the worker on order.confirmed; UNIQUE(order_id) makes that
    // handler idempotent.
    await queryRunner.query(`
      CREATE TABLE shipments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL UNIQUE REFERENCES orders (id) ON DELETE RESTRICT,
        warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
        status shipment_status NOT NULL DEFAULT 'PENDING_DISPATCH',
        carrier varchar(64),
        tracking_number varchar(128),
        dispatched_at timestamptz,
        delivered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_shipments_status_created ON shipments (status, created_at);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_shipments_warehouse ON shipments (warehouse_id);
    `);

    // --- Audit and infrastructure -----------------------------------------

    // Append-only ledger. Never updated, never deleted — this is what makes
    // stock movement auditable (data-model.dbml note).
    await queryRunner.query(`
      CREATE TABLE inventory_movements (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
        order_id uuid REFERENCES orders (id) ON DELETE RESTRICT,
        type inventory_movement_type NOT NULL,
        quantity_delta integer NOT NULL,
        available_after integer NOT NULL,
        reserved_after integer NOT NULL,
        reason varchar(200),
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_movements_warehouse_product_created
        ON inventory_movements (warehouse_id, product_id, created_at);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_inventory_movements_order ON inventory_movements (order_id);
    `);

    // Inserted BEFORE any work begins, so the unique constraint serialises
    // duplicate requests.
    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope varchar(64) NOT NULL DEFAULT 'POST /orders',
        idempotency_key varchar(255) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        state idempotency_state NOT NULL DEFAULT 'IN_PROGRESS',
        order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
        response_status smallint,
        response_body jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_idempotency ON idempotency_keys (scope, idempotency_key);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys (expires_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: tables holding foreign keys drop before the tables they
    // reference.
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys;`);
    await queryRunner.query(`DROP TABLE IF EXISTS inventory_movements;`);
    await queryRunner.query(`DROP TABLE IF EXISTS shipments;`);
    await queryRunner.query(`DROP TABLE IF EXISTS payments;`);
    await queryRunner.query(`DROP TABLE IF EXISTS order_items;`);
    await queryRunner.query(`DROP TABLE IF EXISTS orders;`);
    await queryRunner.query(`DROP TABLE IF EXISTS inventory;`);

    await queryRunner.query(`DROP TABLE IF EXISTS warehouses;`);
    await queryRunner.query(`DROP TABLE IF EXISTS products;`);
    await queryRunner.query(`DROP TABLE IF EXISTS customers;`);

    await queryRunner.query(`DROP TYPE IF EXISTS idempotency_state;`);
    await queryRunner.query(`DROP TYPE IF EXISTS inventory_movement_type;`);
    await queryRunner.query(`DROP TYPE IF EXISTS product_condition;`);
    await queryRunner.query(`DROP TYPE IF EXISTS shipment_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS payment_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS order_status;`);

    // Not dropping the postgis extension: it is shared, cluster-wide
    // infrastructure, and other objects may depend on it by the time this
    // ever runs for real.
  }
}
