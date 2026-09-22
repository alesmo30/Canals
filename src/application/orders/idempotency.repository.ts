import { createHash } from 'crypto';

import { DataSource } from 'typeorm';

import type { IdempotencyState } from '../../infrastructure/database/entities/idempotency-key.orm-entity';

/** FR-6: every row this saga writes shares this scope (column default too). */
const SCOPE = 'POST /orders';

/** specs/05-order-creation-saga.md, Scope: 24h — a named constant, not an env var (references/coding-conventions.md). */
const IDEMPOTENCY_KEY_TTL_HOURS = 24;

export interface IdempotencyKeyRow {
  id: string;
  state: IdempotencyState;
  requestFingerprint: string;
  orderId: string | null;
  responseStatus: number | null;
  responseBody: unknown;
}

interface IdempotencyKeyRawRow {
  id: string;
  state: IdempotencyState;
  request_fingerprint: string;
  order_id: string | null;
  response_status: number | null;
  response_body: unknown;
}

/** Sorts object keys recursively; array order is left untouched (it is meaningful for `items[]`). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}

/**
 * specs/05-order-creation-saga.md — sha256 of the body with keys sorted
 * and no whitespace, so the same logical payload always fingerprints the
 * same way regardless of field order.
 */
export function computeRequestFingerprint(body: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(body));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

export interface InsertInProgressParams {
  idempotencyKey: string;
  requestFingerprint: string;
}

/**
 * Its own autocommit statement, called before any other work begins
 * (Risks table) — never inside the same transaction as Phase 1's
 * reservation. Lets the unique `(scope, idempotency_key)` violation
 * propagate; step 12's controller maps it to `409`/`422`/replay.
 * Returns the new row's `id`, which step 12 needs later to mark it
 * `COMPLETED`.
 */
export async function insertInProgress(
  dataSource: DataSource,
  params: InsertInProgressParams,
): Promise<string> {
  const expiresAt = new Date(
    Date.now() + IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000,
  );
  const rows: { id: string }[] = await dataSource.query(
    `INSERT INTO idempotency_keys
       (scope, idempotency_key, request_fingerprint, state, expires_at)
     VALUES ($1, $2, $3, 'IN_PROGRESS', $4)
     RETURNING id`,
    [SCOPE, params.idempotencyKey, params.requestFingerprint, expiresAt],
  );
  return rows[0].id;
}

/**
 * `null` for both "no row" and "row past `expires_at`" — an expired key
 * is treated as if it never existed (specs/05-order-creation-saga.md,
 * Scope). Deleting it is P6's reaper, out of scope here.
 */
export async function findActiveByKey(
  dataSource: DataSource,
  idempotencyKey: string,
): Promise<IdempotencyKeyRow | null> {
  const rows: IdempotencyKeyRawRow[] = await dataSource.query(
    `SELECT id, state, request_fingerprint, order_id, response_status, response_body
     FROM idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 AND expires_at > now()`,
    [SCOPE, idempotencyKey],
  );
  const [row] = rows;
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    state: row.state,
    requestFingerprint: row.request_fingerprint,
    orderId: row.order_id,
    responseStatus: row.response_status,
    responseBody: row.response_body,
  };
}

export interface MarkCompletedParams {
  id: string;
  orderId: string | null;
  responseStatus: number;
  responseBody: unknown;
}

/** Terminal write for any final request outcome, success or error alike (specs/05, Decisions) — `idempotency_state` has no third, "failed but retryable" value. */
export async function markCompleted(
  dataSource: DataSource,
  params: MarkCompletedParams,
): Promise<void> {
  await dataSource.query(
    `UPDATE idempotency_keys
     SET state = 'COMPLETED', order_id = $2, response_status = $3, response_body = $4::jsonb
     WHERE id = $1`,
    [
      params.id,
      params.orderId,
      params.responseStatus,
      JSON.stringify(params.responseBody),
    ],
  );
}
