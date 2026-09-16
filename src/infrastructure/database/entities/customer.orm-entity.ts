import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Mirrors `customers` (migration, step 7). Pre-existing reference data —
 * read but never mutated by this service (data-model.dbml note). No domain
 * mirror: R0.5 keeps only Order/OrderItem as rich domain classes; this
 * table is used directly, no mapper.
 */
@Entity('customers')
export class CustomerOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 320, unique: true })
  email!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 200 })
  fullName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
