import { useSyncExternalStore } from 'react';

import { createPersistedStore } from './persisted';

export type RequestKind = 'CREATE_ORDER' | 'LIST_ORDERS' | 'GET_ORDER';

export interface ExecutionRequest {
  kind: RequestKind;
  method: 'GET' | 'POST';
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface ExecutionResponse {
  /** null when the request never got an HTTP response (network/CORS). */
  status: number | null;
  headers: Record<string, string>;
  body: unknown;
  error: string | null;
}

export interface Execution {
  id: string;
  startedAt: string;
  durationMs: number;
  request: ExecutionRequest;
  response: ExecutionResponse;
  orderId: string | null;
  correlationId: string | null;
}

/** specs/08 — per-browser history, capped so localStorage never fills up. */
export const MAX_EXECUTIONS = 200;

const executionsStore = createPersistedStore<Execution[]>(
  'canals-console:executions',
  [],
);

export function addExecution(execution: Execution): void {
  executionsStore.set((previous) =>
    [execution, ...previous].slice(0, MAX_EXECUTIONS),
  );
}

export function clearExecutions(): void {
  executionsStore.set([]);
}

export function useExecutions(): Execution[] {
  return useSyncExternalStore(executionsStore.subscribe, executionsStore.get);
}

export function useExecution(id: string | undefined): Execution | undefined {
  const executions = useExecutions();
  return executions.find((execution) => execution.id === id);
}
