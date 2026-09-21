import { randomUUID } from 'crypto';

import type { Db, PgBoss, SendOptions } from 'pg-boss';

import {
  DomainEvent,
  EventPublisher,
  TransactionContext,
} from '../../domain/ports/event-publisher';
import { EVENT_ROUTING, UnroutedEventError } from './event-routing';
import { JobBody, JobMeta } from './job-envelope';

/**
 * SPEC 04 — replaces P0's no-op `EVENT_PUBLISHER` stub. Implements the
 * frozen `EventPublisher` port unchanged (R0.6): `publish()` looks the event
 * type up in `EVENT_ROUTING` and sends one job per target queue, all
 * through the same `db.executeSql` when `tx` is supplied, so the job
 * inserts commit or roll back with the caller's transaction (FR-9).
 */
export class PgBossEventPublisher implements EventPublisher {
  constructor(private readonly boss: PgBoss) {}

  async publish(event: DomainEvent, tx?: TransactionContext): Promise<void> {
    const targets = EVENT_ROUTING[event.type];
    if (!targets) {
      throw new UnroutedEventError(event.type);
    }

    // Step 7 replaces this with the correlationId/traceparent captured from
    // AsyncLocalStorage and the active OTel span; until then every publish
    // gets its own fresh id and no trace context (JobMeta.traceparent is
    // explicitly nullable for exactly this case).
    const meta: JobMeta = {
      correlationId: randomUUID(),
      traceparent: null,
      publishedAt: new Date().toISOString(),
    };
    const body: JobBody = { payload: event.payload, meta };

    // TransactionContext stays framework-free and returns `Promise<unknown>`
    // (domain/ports/event-publisher.ts); this is the one place that knows
    // pg-boss's own `Db.executeSql` shape (`{ rows }`) and bridges the two.
    // The port's own doc comment example wires `executeSql` straight to
    // TypeORM's `EntityManager.query()`, which resolves to the bare rows
    // array (`PostgresQueryRunner.query()`, `useStructuredResult: false`),
    // not `{ rows }` — that wrapping happens here.
    const db: Db | undefined = tx
      ? {
          executeSql: async (text: string, values?: unknown[]) => {
            const rows = (await tx.executeSql(text, values)) as unknown[];
            return { rows };
          },
        }
      : undefined;
    const sendOptions: SendOptions | undefined = db ? { db } : undefined;

    for (const queue of targets) {
      await this.boss.send(queue, body, sendOptions);
    }
  }
}
