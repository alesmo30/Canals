import { getBaseUrl } from '../store/settings';
import {
  addExecution,
  type Execution,
  type ExecutionRequest,
  type RequestKind,
} from '../store/executions';
import { isProblem } from './types';

export interface ExecuteParams {
  kind: RequestKind;
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

function compact(
  record: Record<string, string | undefined> = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[1].trim() !== '',
    ),
  );
}

function extractOrderId(
  request: ExecutionRequest,
  body: unknown,
): string | null {
  if (isProblem(body)) {
    return body.orderId ?? null;
  }
  if (
    request.kind !== 'LIST_ORDERS' &&
    typeof body === 'object' &&
    body !== null &&
    'id' in body &&
    typeof body.id === 'string'
  ) {
    return body.id;
  }
  return null;
}

/**
 * Sends one console request, measures it and records it in the executions
 * log. Never throws: a network/CORS failure is recorded with
 * `status: null` and the browser's error message.
 */
export async function execute(params: ExecuteParams): Promise<Execution> {
  const query = compact(params.query);
  const headers = compact(params.headers);
  if (params.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const search = new URLSearchParams(query).toString();
  const url = `${getBaseUrl()}${params.path}${search ? `?${search}` : ''}`;

  const request: ExecutionRequest = {
    kind: params.kind,
    method: params.method,
    url,
    path: params.path,
    query,
    headers,
    body: params.body ?? null,
  };

  const startedAt = new Date();
  const started = performance.now();
  let execution: Execution;

  try {
    const response = await fetch(url, {
      method: params.method,
      headers,
      body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (unlikely from this API) is kept as text.
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });

    execution = {
      id: crypto.randomUUID(),
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - started),
      request,
      response: {
        status: response.status,
        headers: responseHeaders,
        body,
        error: null,
      },
      orderId:
        extractOrderId(request, body) ??
        (params.kind === 'GET_ORDER' ? params.path.split('/').pop() ?? null : null),
      correlationId:
        response.headers.get('x-correlation-id') ??
        (isProblem(body) ? body.correlationId ?? null : null),
    };
  } catch (error) {
    execution = {
      id: crypto.randomUUID(),
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - started),
      request,
      response: {
        status: null,
        headers: {},
        body: null,
        error:
          error instanceof Error
            ? `${error.message} — is the API running at ${getBaseUrl()} and does CORS allow this origin?`
            : String(error),
      },
      orderId: null,
      correlationId: headers['X-Correlation-Id'] ?? null,
    };
  }

  addExecution(execution);
  return execution;
}

/** Plain GET used by the lifecycle view — not recorded as an execution. */
export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`);
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      isProblem(body) ? `${body.status} ${body.title}` : `HTTP ${response.status}`,
    );
  }
  return body as T;
}
