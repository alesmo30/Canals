/**
 * specs/08-observability-console.md, API contract. The declaration order
 * of TIMELINE_PHASES is also the tie-break when two events share a
 * timestamp (several saga writes happen in one transaction, so they get
 * the same `now()`).
 */
export const TIMELINE_PHASES = [
  'IDEMPOTENCY',
  'RESERVE',
  'CHARGE',
  'SETTLE',
  'JOBS',
  'FULFILMENT',
] as const;

export type TimelinePhase = (typeof TIMELINE_PHASES)[number];

export type TimelineOutcome = 'OK' | 'PENDING' | 'FAILED';

export type TimelineDetail = Record<string, string | number | null>;

export interface TimelineEvent {
  at: Date;
  phase: TimelinePhase;
  kind: string;
  title: string;
  outcome: TimelineOutcome;
  detail: TimelineDetail;
}
