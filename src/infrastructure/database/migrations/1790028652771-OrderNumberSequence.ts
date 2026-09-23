import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One global counter (no per-year reset). The `CNL-<year>-<6 digits>` format
 * is built in `generateOrderNumber()`.
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
