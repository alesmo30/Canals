import type { PgBoss, SendOptions } from 'pg-boss';

import { PgBossEventPublisher } from './pg-boss-event-publisher';
import { UnroutedEventError } from './event-routing';
import { JobBody } from './job-envelope';
import { TransactionContext } from '../../domain/ports/event-publisher';
import { correlationStorage } from '../observability/correlation';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SendCall = [string, JobBody, SendOptions | undefined];

function createFakeBoss(): { boss: PgBoss; send: jest.Mock } {
  const send = jest.fn().mockResolvedValue('job-id');
  return { boss: { send } as unknown as PgBoss, send };
}

function sendCalls(send: jest.Mock): SendCall[] {
  return send.mock.calls as SendCall[];
}

describe('PgBossEventPublisher', () => {
  it('throws UnroutedEventError and sends nothing for an event type absent from EVENT_ROUTING', async () => {
    const { boss, send } = createFakeBoss();
    const publisher = new PgBossEventPublisher(boss);

    await expect(
      publisher.publish({ type: 'unknown.event', payload: {} }),
    ).rejects.toThrow(UnroutedEventError);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one job per target queue, each wrapping payload in a { payload, meta } envelope', async () => {
    const { boss, send } = createFakeBoss();
    const publisher = new PgBossEventPublisher(boss);
    const payload = {
      orderId: 'order-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
    };

    await publisher.publish({ type: 'order.confirmed', payload });

    expect(send).toHaveBeenCalledTimes(3);
    const calls = sendCalls(send);
    expect(calls.map(([queue]) => queue)).toEqual([
      'shipment.create',
      'customer.notify',
      'analytics.record',
    ]);

    for (const [, body] of calls) {
      expect(body.payload).toEqual(payload);
      expect(body.meta.correlationId).toMatch(UUID_PATTERN);
      expect(body.meta.traceparent).toBeNull();
      expect(() => new Date(body.meta.publishedAt).toISOString()).not.toThrow();
    }
  });

  it('shares one correlationId across every job from the same publish() call', async () => {
    const { boss, send } = createFakeBoss();
    const publisher = new PgBossEventPublisher(boss);

    await publisher.publish({
      type: 'order.confirmed',
      payload: { orderId: 'order-1', occurredAt: '2026-01-01T00:00:00.000Z' },
    });

    const correlationIds = sendCalls(send).map(
      ([, body]) => body.meta.correlationId,
    );
    expect(new Set(correlationIds).size).toBe(1);
  });

  it('sends with no db option when publishing outside a transaction', async () => {
    const { boss, send } = createFakeBoss();
    const publisher = new PgBossEventPublisher(boss);

    await publisher.publish({
      type: 'order.confirmed',
      payload: { orderId: 'order-1', occurredAt: '2026-01-01T00:00:00.000Z' },
    });

    for (const [, , options] of sendCalls(send)) {
      expect(options).toBeUndefined();
    }
  });

  it("wraps a supplied TransactionContext into db: { executeSql } for every send(), matching pg-boss's { rows } shape from TypeORM's bare-array query() result", async () => {
    const { boss, send } = createFakeBoss();
    const publisher = new PgBossEventPublisher(boss);
    // TransactionContext.executeSql resolves whatever EntityManager.query()
    // returns — a bare rows array, per event-publisher.ts's own doc comment
    // example (`trx.query(sql, values)`), not `{ rows }`.
    const executeSql = jest.fn().mockResolvedValue([{ id: 1 }]);
    const tx: TransactionContext = { executeSql };

    await publisher.publish(
      {
        type: 'order.confirmed',
        payload: {
          orderId: 'order-1',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      },
      tx,
    );

    expect(send).toHaveBeenCalledTimes(3);
    for (const [, , options] of sendCalls(send)) {
      await expect(options?.db?.executeSql('select 1', [])).resolves.toEqual({
        rows: [{ id: 1 }],
      });
    }
    expect(executeSql).toHaveBeenCalledTimes(3);
    expect(executeSql).toHaveBeenCalledWith('select 1', []);
  });

  it('reuses the correlationId from correlationStorage instead of generating a new one', async () => {
    const { boss, send } = createFakeBoss();
    const publisher = new PgBossEventPublisher(boss);

    await correlationStorage.run(
      { correlationId: 'from-async-local-storage' },
      () =>
        publisher.publish({
          type: 'order.confirmed',
          payload: {
            orderId: 'order-1',
            occurredAt: '2026-01-01T00:00:00.000Z',
          },
        }),
    );

    for (const [, body] of sendCalls(send)) {
      expect(body.meta.correlationId).toBe('from-async-local-storage');
    }
  });
});
