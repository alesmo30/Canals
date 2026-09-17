/**
 * A named event and its payload, bundled into one object — mirrors what
 * `boss.send(name, data, options)` needs, folded into the single argument
 * this port's `publish` takes. `type` stays a generic `string`, not a
 * literal union: P0 defines the envelope, P4 is the one that actually
 * constructs and names a concrete event (`order.confirmed`, FR-9).
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly type: string;
  readonly payload: TPayload;
}

/**
 * A raw SQL executor bound to the caller's in-flight transaction — what
 * lets the pg-boss job insert join the *same* transaction as the order
 * update it accompanies (the transactional-outbox pattern,
 * architectural-requirements.md §"Transactional outbox"):
 *
 * ```ts
 * await dataSource.transaction(async (trx) => {
 *   await trx.update(Order, orderId, { status: 'CONFIRMED' });
 *   await eventPublisher.publish(event, { executeSql: (sql, values) => trx.query(sql, values) });
 * }); // one COMMIT: the order and the job are saved together, or neither is
 * ```
 *
 * Shaped as a plain function, not a TypeORM `QueryRunner`, so this port
 * stays framework-free — the P3 adapter is what knows how to wrap it into
 * pg-boss's own `{ db: { executeSql } }` option.
 */
export interface TransactionContext {
  executeSql(sql: string, values?: unknown[]): Promise<unknown>;
}

/**
 * R0.6 (frozen contract). Implemented by P3 (pg-boss adapter) and consumed
 * by P4, which publishes `order.confirmed` inside the same transaction
 * that commits the order (FR-9). `tx` is optional: a caller publishing
 * outside a transaction (there isn't one for P0/P1) simply omits it.
 */
export interface EventPublisher {
  publish(event: DomainEvent, tx?: TransactionContext): Promise<void>;
}

/** DI token — EventPublisher is an interface and has no runtime value to key on. */
export const EVENT_PUBLISHER = Symbol('EventPublisher');
