import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { bigintNumberTransformer } from '../transformers/bigint-number.transformer';
import type { PaymentStatus } from '../../../domain/enum-types/payment-status';

/** Runtime mirror of the `payment_status` enum (migration, step 7) — TypeORM's `enum` column option needs an actual array, not just a type. */
const PAYMENT_STATUS_VALUES: readonly PaymentStatus[] = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'DECLINED',
  'FAILED',
  'UNKNOWN',
  'REFUNDED',
];

/**
 * Mirrors `payments` (migration, step 8). No domain mirror (R0.5):
 * inserted, never mutated by this service's own logic beyond a status
 * update — "folded into orders" per R0.5's table.
 */
@Entity('payments')
export class PaymentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ type: 'smallint' })
  attempt!: number;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({
    name: 'provider_payment_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerPaymentId!: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    unique: true,
  })
  idempotencyKey!: string;

  @Column({
    type: 'enum',
    enum: PAYMENT_STATUS_VALUES,
    enumName: 'payment_status',
  })
  status!: PaymentStatus;

  @Column({
    name: 'amount_cents',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  amountCents!: number;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'card_last4', type: 'char', length: 4, nullable: true })
  cardLast4!: string | null;

  @Column({ name: 'card_brand', type: 'varchar', length: 20, nullable: true })
  cardBrand!: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode!: string | null;

  @Column({ name: 'raw_response', type: 'jsonb', nullable: true })
  rawResponse!: Record<string, unknown> | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
