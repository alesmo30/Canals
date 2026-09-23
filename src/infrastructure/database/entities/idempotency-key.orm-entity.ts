import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Mirrors the idempotency_state enum. Infrastructure-only, not a domain enum. */
export type IdempotencyState = 'IN_PROGRESS' | 'COMPLETED';

const IDEMPOTENCY_STATE_VALUES: readonly IdempotencyState[] = [
  'IN_PROGRESS',
  'COMPLETED',
];

/** No domain class: insert-first / replay-on-duplicate lives in idempotency.repository. */
@Entity('idempotency_keys')
export class IdempotencyKeyOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  scope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({
    type: 'enum',
    enum: IDEMPOTENCY_STATE_VALUES,
    enumName: 'idempotency_state',
  })
  state!: IdempotencyState;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'response_status', type: 'smallint', nullable: true })
  responseStatus!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: Record<string, unknown> | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
