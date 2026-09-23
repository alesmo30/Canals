import { randomUUID } from 'node:crypto';

import { cardLast4 } from './card';
import {
  APPROVED_DELAY_MAX_MS,
  APPROVED_DELAY_MIN_MS,
  CARD_0004_DELAY_MS,
  CARD_DECLINED_LAST4,
  CARD_PROVIDER_ERROR_LAST4,
  CARD_TIMEOUT_LAST4,
} from './constants';
import { computeRequestHash } from './hash';
import { logger } from './logger';
import { ChargeRecord, ChargeRequestBody } from './types';

export type DelayFn = (ms: number) => Promise<void>;

const defaultDelay: DelayFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ChargeServiceOptions {
  /** Overridable so tests do not wait for real delays. */
  delay?: DelayFn;
  card0004DelayMs?: number;
  approvedDelayMinMs?: number;
  approvedDelayMaxMs?: number;
}

export type ChargeOutcome =
  { kind: 'charged'; record: ChargeRecord } | { kind: 'provider_error' };

/** `422 idempotency_key_reused`: the key was already used with a different body. */
export const IDEMPOTENCY_KEY_REUSED = 'reused';
export type ChargeResult = ChargeOutcome | typeof IDEMPOTENCY_KEY_REUSED;

interface PendingCharge {
  requestHash: string;
  promise: Promise<ChargeResult>;
}

interface ChargeAttempt {
  idempotencyKey: string;
  hash: string;
  last4: string;
  body: ChargeRequestBody;
}

/**
 * In-memory store of charges plus a map of in-flight promises (a second
 * request with the same key awaits the first). One instance per process;
 * state is lost on restart — accepted for a mock.
 */
export class ChargeService {
  private readonly records = new Map<string, ChargeRecord>();
  private readonly pending = new Map<string, PendingCharge>();
  private readonly delay: DelayFn;
  private readonly card0004DelayMs: number;
  private readonly approvedDelayMinMs: number;
  private readonly approvedDelayMaxMs: number;

  constructor(options: ChargeServiceOptions = {}) {
    this.delay = options.delay ?? defaultDelay;
    this.card0004DelayMs = options.card0004DelayMs ?? CARD_0004_DELAY_MS;
    this.approvedDelayMinMs =
      options.approvedDelayMinMs ?? APPROVED_DELAY_MIN_MS;
    this.approvedDelayMaxMs =
      options.approvedDelayMaxMs ?? APPROVED_DELAY_MAX_MS;
  }

  /** `GET /charge/:idempotencyKey` — answers immediately, straight from the map. */
  getByIdempotencyKey(idempotencyKey: string): ChargeRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  async charge(
    idempotencyKey: string,
    body: ChargeRequestBody,
  ): Promise<ChargeResult> {
    const last4 = cardLast4(body.cardNumber);
    const hash = computeRequestHash({ last4, ...body });
    logger.info(
      {
        idempotencyKey,
        last4,
        amountCents: body.amountCents,
        currency: body.currency,
      },
      'charge.received',
    );

    // A second request for this key, arriving while the first is still
    // being processed, awaits that same result instead of starting its own.
    const alreadyPending = this.pending.get(idempotencyKey);
    if (alreadyPending) {
      const outcome = await alreadyPending.promise;
      if (alreadyPending.requestHash !== hash) {
        logger.warn({ idempotencyKey }, 'charge.idempotency_key_reused');
        return IDEMPOTENCY_KEY_REUSED;
      }
      return outcome;
    }

    const promise = this.process({ idempotencyKey, hash, last4, body });
    this.pending.set(idempotencyKey, { requestHash: hash, promise });
    try {
      return await promise;
    } finally {
      this.pending.delete(idempotencyKey);
    }
  }

  private async process(attempt: ChargeAttempt): Promise<ChargeResult> {
    const { idempotencyKey, hash, last4 } = attempt;

    if (last4 === CARD_TIMEOUT_LAST4) {
      return this.processCard0004(attempt);
    }

    // Other cards replay the stored response instantly for a repeated key.
    // A different body under the same key is a reuse (422), not a replay.
    const existing = this.records.get(idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash) {
        logger.warn({ idempotencyKey }, 'charge.idempotency_key_reused');
        return IDEMPOTENCY_KEY_REUSED;
      }
      logger.info(
        { idempotencyKey, last4, status: existing.status },
        'charge.replayed',
      );
      return { kind: 'charged', record: existing };
    }

    if (last4 === CARD_PROVIDER_ERROR_LAST4) {
      logger.warn(
        { idempotencyKey, last4, status: 'provider_error' },
        'charge.completed',
      );
      return { kind: 'provider_error' };
    }

    if (last4 === CARD_DECLINED_LAST4) {
      const record = this.store(attempt, 'declined');
      logger.info(
        { idempotencyKey, last4, status: record.status },
        'charge.completed',
      );
      return { kind: 'charged', record };
    }

    await this.delay(
      randomBetween(this.approvedDelayMinMs, this.approvedDelayMaxMs),
    );
    const record = this.store(attempt, 'approved');
    logger.info(
      { idempotencyKey, last4, status: record.status },
      'charge.completed',
    );
    return { kind: 'charged', record };
  }

  /**
   * Card 0004: recorded as approved on arrival, then delays on every
   * request (replays included); the body-mismatch check runs only after
   * the delay. See knowledge/http-payments.md#card-0004
   */
  private async processCard0004(attempt: ChargeAttempt): Promise<ChargeResult> {
    const { idempotencyKey, hash, last4 } = attempt;
    const existing = this.records.get(idempotencyKey);
    const record = existing ?? this.store(attempt, 'approved');
    await this.delay(this.card0004DelayMs);
    if (record.requestHash !== hash) {
      logger.warn({ idempotencyKey }, 'charge.idempotency_key_reused');
      return IDEMPOTENCY_KEY_REUSED;
    }
    logger.info(
      { idempotencyKey, last4, status: record.status },
      existing ? 'charge.replayed' : 'charge.completed',
    );
    return { kind: 'charged', record };
  }

  private store(
    attempt: ChargeAttempt,
    status: 'approved' | 'declined',
  ): ChargeRecord {
    const { idempotencyKey, hash, last4, body } = attempt;
    const record: ChargeRecord = {
      id: `ch_${randomUUID()}`,
      idempotencyKey,
      requestHash: hash,
      status,
      declineCode: status === 'declined' ? 'card_declined' : undefined,
      amountCents: body.amountCents,
      currency: body.currency,
      cardLast4: last4,
      createdAt: new Date().toISOString(),
    };
    this.records.set(idempotencyKey, record);
    return record;
  }
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}
