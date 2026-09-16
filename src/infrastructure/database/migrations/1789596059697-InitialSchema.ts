import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * R0.4 (frozen contract): the full schema from data-model.dbml, hand-written
 * as raw SQL rather than generated — PostGIS geography columns, generated
 * columns, the GiST index and the partial unique index (step 8) are not
 * reliably produced by `migration:generate` (see specs/01-foundation.md,
 * Decisions).
 *
 * Built across two steps of the same spec, in the same file (step 7 here:
 * extension, enums, the three reference tables; step 8 appends the
 * remaining seven tables, every constraint and index, and `down`).
 */
export class InitialSchema1789596059697 implements MigrationInterface {
  name = 'InitialSchema1789596059697';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // R0.4: PostGIS first — every geography column below depends on it.
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

    // Coordinates are fixed reference data, seeded once. Warehouses are
    // never geocoded at request time — only the shipping address is (FR-3).
    // latitude/longitude are generated columns derived from location, so
    // they are readable in a plain SELECT without ever being able to drift
    // out of sync (data-model.dbml note).
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: tables before the enum types they reference, enums
    // before the extension. Step 8 will prepend the drops for the seven
    // tables it adds, which depend on these three via foreign keys.
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
