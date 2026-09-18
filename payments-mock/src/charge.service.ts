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
 * SPEC 03: the mock's whole state machine — an in-memory `Map` of stored
 * charges, a second `Map` of in-flight promises for "a second request with
 * the same key awaits the first one's result", and the card-keyed outcome
 * table. One instance per process; state is lost on restart, accepted as a
 * mock limitation (spec's Risks).
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

    // A second request for this key, arriving while the first is still
    // being processed, awaits that same result instead of starting its own.
    const alreadyPending = this.pending.get(idempotencyKey);
    if (alreadyPending) {
      const outcome = await alreadyPending.promise;
      return alreadyPending.requestHash === hash
        ? outcome
        : IDEMPOTENCY_KEY_REUSED;
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
    const { idempotencyKey, hash, last4, body } = attempt;

    if (last4 === CARD_TIMEOUT_LAST4) {
      return this.processCard0004(attempt);
    }

    // Every other card replays its stored response for a repeated key —
    // instantly, no re-delay, no reprocessing. A different body under the
    // same key is a reuse, not a replay.
    const existing = this.records.get(idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash) {
        return IDEMPOTENCY_KEY_REUSED;
      }
      return { kind: 'charged', record: existing };
    }

    if (last4 === CARD_PROVIDER_ERROR_LAST4) {
      return { kind: 'provider_error' };
    }

    if (last4 === CARD_DECLINED_LAST4) {
      return {
        kind: 'charged',
        record: this.store(attempt, 'declined'),
      };
    }

    await this.delay(
      randomBetween(this.approvedDelayMinMs, this.approvedDelayMaxMs),
    );
    return {
      kind: 'charged',
      record: this.store(attempt, 'approved'),
    };
  }

  /**
   * `0004`: the delay is checked before the idempotency lookup. The charge
   * is recorded as approved the moment it arrives — before the delay —
   * so a concurrent `GET` already sees it while this `POST` is still
   * pending. The delay then runs unconditionally, on every request for
   * this key, replays included: the normal "already stored, replay
   * instantly" shortcut above never applies to this card. Only once the
   * delay is over does it check whether this request's body still matches
   * what was recorded — a same-key-different-body request against `0004`
   * still ends in `422`, just after paying the delay first.
   */
  private async processCard0004(attempt: ChargeAttempt): Promise<ChargeResult> {
    const { idempotencyKey, hash } = attempt;
    const record =
      this.records.get(idempotencyKey) ?? this.store(attempt, 'approved');
    await this.delay(this.card0004DelayMs);
    if (record.requestHash !== hash) {
      return IDEMPOTENCY_KEY_REUSED;
    }
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
