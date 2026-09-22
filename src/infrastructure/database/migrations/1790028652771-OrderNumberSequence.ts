import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SPEC 05: one global counter (not per-year — avoids fragile reset logic).
 * The `CNL-<year>-<6 digits>` format is assembled at generation time in
 * `generateOrderNumber()`, not stored in the sequence itself.
 */
export class OrderNumberSequence1790028652771 implements MigrationInterface {
  name = 'OrderNumberSequence1790028652771';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE SEQUENCE order_number_seq AS bigint START WITH 1;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE IF EXISTS order_number_seq;`);
  }
}
