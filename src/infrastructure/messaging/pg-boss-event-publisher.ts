import { randomUUID } from 'crypto';

import { context, defaultTextMapSetter, propagation } from '@opentelemetry/api';
import type { Db, PgBoss, SendOptions } from 'pg-boss';

import {
  DomainEvent,
  EventPublisher,
  TransactionContext,
} from '../../domain/ports/event-publisher';
import { getCorrelationId } from '../observability/correlation';
import { EVENT_ROUTING, UnroutedEventError } from './event-routing';
import { JobBody, JobMeta } from './job-envelope';

/**
 * Injects the active OTel span (if any) into a plain carrier via the
 * globally-registered W3C propagator (`tracing.ts`'s `NodeSDK` registers
 * it), then reads back the `traceparent` field it wrote — `null` when no
 * span is active, matching `JobMeta.traceparent`'s own contract.
 */
function captureTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier, defaultTextMapSetter);
  return carrier.traceparent ?? null;
}

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

    // getCorrelationId() reads the AsyncLocalStorage the api's
    // CorrelationMiddleware (or the JobRunner, when a handler itself
    // publishes) already populated; a publish from outside any tracked
    // context (a script) still gets a fresh id rather than "undefined".
    const meta: JobMeta = {
      correlationId: getCorrelationId() ?? randomUUID(),
      traceparent: captureTraceparent(),
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
