import { randomUUID } from 'crypto';

import { QueryFailedError } from 'typeorm';

import { findActiveByKey, insertInProgress } from './idempotency.repository';
import { AppDataSource } from '../../infrastructure/database/data-source';

/**
 * Integration test — DATABASE_URL (+ PAYMENTS_URL,
 * OTEL_EXPORTER_OTLP_ENDPOINT) exported, a migrated Postgres reachable.
 * Each test uses its own randomUUID()-scoped idempotency key.
 */
describe('idempotency.repository (integration)', () => {
  beforeAll(async () => {
    await AppDataSource.initialize();
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('rejects a second insert for the same key while the first is still IN_PROGRESS', async () => {
    const idempotencyKey = randomUUID();

    await insertInProgress(AppDataSource, {
      idempotencyKey,
      requestFingerprint: 'a'.repeat(64),
    });

    let caughtError: unknown;
    try {
      await insertInProgress(AppDataSource, {
        idempotencyKey,
        requestFingerprint: 'b'.repeat(64),
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(QueryFailedError);
    const driverError = (caughtError as QueryFailedError).driverError as {
      code?: string;
    };
    expect(driverError.code).toBe('23505');
  });

  it('treats a key past its expires_at as if it did not exist', async () => {
    const idempotencyKey = randomUUID();

    await insertInProgress(AppDataSource, {
      idempotencyKey,
      requestFingerprint: 'c'.repeat(64),
    });
    await AppDataSource.query(
      `UPDATE idempotency_keys SET expires_at = now() - interval '1 hour'
       WHERE scope = 'POST /orders' AND idempotency_key = $1`,
      [idempotencyKey],
    );

    const result = await findActiveByKey(AppDataSource, idempotencyKey);

    expect(result).toBeNull();
  });
});
