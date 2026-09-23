import { GRAFANA_URL } from '../api/catalog';
import {
  isProblem,
  type TimelineEvent,
  type TimelineOutcome,
  type TimelinePhase,
} from '../api/types';
import type { Execution } from '../store/executions';

export const PHASES: readonly { phase: TimelinePhase; label: string; description: string }[] = [
  { phase: 'IDEMPOTENCY', label: 'Idempotency', description: 'Key claimed before any work' },
  { phase: 'RESERVE', label: 'Reserve', description: 'Order row + stock reservation' },
  { phase: 'CHARGE', label: 'Charge', description: 'Payment attempts at the provider' },
  { phase: 'SETTLE', label: 'Settle', description: 'Commit or release stock, final status' },
  { phase: 'JOBS', label: 'Fan-out jobs', description: 'order.confirmed → pg-boss queues' },
  { phase: 'FULFILMENT', label: 'Fulfilment', description: 'Shipment created by the worker' },
];

export type PhaseState = TimelineOutcome | 'SKIPPED';

/** Worst outcome wins: FAILED > PENDING > OK. No events → SKIPPED. */
export function phaseState(events: TimelineEvent[], phase: TimelinePhase): PhaseState {
  const outcomes = events.filter((event) => event.phase === phase).map((event) => event.outcome);
  if (outcomes.length === 0) {
    return 'SKIPPED';
  }
  if (outcomes.includes('FAILED')) {
    return 'FAILED';
  }
  return outcomes.includes('PENDING') ? 'PENDING' : 'OK';
}

export interface RequestStep {
  label: string;
  state: 'OK' | 'FAILED' | 'SKIPPED';
  note?: string;
}

/**
 * Request-level lifecycle when no order exists to fetch a timeline for:
 * where did the request stop? Derived from the status and problem `type`.
 */
export function requestSteps(execution: Execution): RequestStep[] {
  const { response, request } = execution;
  if (response.status === null) {
    return [
      { label: 'Sent', state: 'OK' },
      { label: 'Reached the API', state: 'FAILED', note: response.error ?? 'Network error' },
    ];
  }

  const body = response.body;
  const type = isProblem(body) ? body.type : null;
  const title = isProblem(body) ? body.title : undefined;
  const isCreate = request.kind === 'CREATE_ORDER';

  const stages = isCreate
    ? ['Received', 'Validated', 'Idempotency', 'Resolve customer & products', 'Reserve stock', 'Charge', 'Settle']
    : ['Received', 'Validated', 'Query', 'Returned'];

  let failedAt = -1;
  if (response.status >= 400) {
    if (response.status === 413) failedAt = 0;
    else if (type === 'urn:problem-type:invalid-payload') failedAt = 1;
    else if (isCreate && (response.status === 409 || response.status === 422) && type === 'about:blank') failedAt = 2;
    else if (type === 'urn:problem-type:not-found') failedAt = isCreate ? 3 : 2;
    else if (type === 'urn:problem-type:geocoding-failed' || type === 'urn:problem-type:no-fulfilment-possible' || type === 'urn:problem-type:inventory-reservation-conflict') failedAt = 4;
    else if (type === 'urn:problem-type:payment-declined' || type === 'urn:problem-type:payment-provider-unavailable') failedAt = 5;
    else failedAt = stages.length - 1;
  }

  return stages.map((label, index) => ({
    label,
    state: failedAt === -1 || index < failedAt ? 'OK' : index === failedAt ? 'FAILED' : 'SKIPPED',
    note: index === failedAt ? title : undefined,
  }));
}

/** Grafana Explore on Tempo, TraceQL filtered by the request's correlation id. */
export function grafanaTraceUrl(correlationId: string): string {
  const panes = {
    a: {
      datasource: 'tempo',
      queries: [
        {
          refId: 'A',
          datasource: { type: 'tempo', uid: 'tempo' },
          queryType: 'traceql',
          query: `{ span.app.correlation_id = "${correlationId}" }`,
        },
      ],
      range: { from: 'now-6h', to: 'now' },
    },
  };
  return `${GRAFANA_URL}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
