import { toOrderTimelineResponse } from './order-timeline.response.dto';

describe('toOrderTimelineResponse', () => {
  const result = {
    order: {
      id: 'c0000000-0000-0000-0000-00000000aaaa',
      order_number: 'CNL-2026-000042',
      status: 'CONFIRMED' as const,
      created_at: new Date('2026-09-22T10:00:00.000Z'),
      updated_at: new Date('2026-09-22T10:00:01.000Z'),
      reservation_expires_at: null,
      confirmed_at: new Date('2026-09-22T10:00:01.000Z'),
      cancelled_at: null,
      cancellation_reason: 'should-not-leak',
    },
    correlationId: 'corr-1',
    events: [
      {
        at: new Date('2026-09-22T10:00:00.000Z'),
        phase: 'CHARGE' as const,
        kind: 'PAYMENT_ATTEMPT',
        title: 'Payment attempt #1 CAPTURED',
        outcome: 'OK' as const,
        detail: { attempt: 1, failureCode: null },
      },
    ],
  };

  it('projects the contract fields with ISO timestamps', () => {
    expect(toOrderTimelineResponse(result)).toEqual({
      orderId: result.order.id,
      orderNumber: 'CNL-2026-000042',
      status: 'CONFIRMED',
      correlationId: 'corr-1',
      events: [
        {
          at: '2026-09-22T10:00:00.000Z',
          phase: 'CHARGE',
          kind: 'PAYMENT_ATTEMPT',
          title: 'Payment attempt #1 CAPTURED',
          outcome: 'OK',
          detail: { attempt: 1, failureCode: null },
        },
      ],
    });
  });

  it('no order column outside the contract survives serialisation', () => {
    const json = JSON.stringify(toOrderTimelineResponse(result));
    expect(json).not.toContain('should-not-leak');
    expect(json).not.toContain('updated_at');
  });
});
