/** An event name plus payload (mirrors boss.send); publishers name concrete events. */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly type: string;
  readonly payload: TPayload;
}

/**
 * Raw SQL executor bound to the caller's transaction, so the job insert
 * commits (or not) with the order update. A plain function keeps the port
 * framework-free. See knowledge/messaging-jobs.md#transactional-outbox
 */
export interface TransactionContext {
  executeSql(sql: string, values?: unknown[]): Promise<unknown>;
}

/** Publishes inside the caller's transaction when `tx` is given; omit it to publish outside one. */
export interface EventPublisher {
  publish(event: DomainEvent, tx?: TransactionContext): Promise<void>;
}

/** DI token — EventPublisher is an interface and has no runtime value to key on. */
export const EVENT_PUBLISHER = Symbol('EventPublisher');
