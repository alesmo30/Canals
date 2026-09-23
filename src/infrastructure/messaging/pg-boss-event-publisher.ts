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
 * The active span's W3C traceparent, via the global propagator; null when
 * no span is active.
 */
function captureTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier, defaultTextMapSetter);
  return carrier.traceparent ?? null;
}

/**
 * publish() looks up EVENT_ROUTING and sends one job per target queue,
 * through the caller's executeSql when tx is given, so the jobs commit or
 * roll back with it.
 */
export class PgBossEventPublisher implements EventPublisher {
  constructor(private readonly boss: PgBoss) {}

  async publish(event: DomainEvent, tx?: TransactionContext): Promise<void> {
    const targets = EVENT_ROUTING[event.type];
    if (!targets) {
      throw new UnroutedEventError(event.type);
    }

    // Outside any tracked context (e.g. a script) a fresh id is used.
    const meta: JobMeta = {
      correlationId: getCorrelationId() ?? randomUUID(),
      traceparent: captureTraceparent(),
      publishedAt: new Date().toISOString(),
    };
    const body: JobBody = { payload: event.payload, meta };

    // Bridges the framework-free TransactionContext (TypeORM query()
    // resolves to bare rows) to pg-boss's Db.executeSql shape ({ rows }).
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
