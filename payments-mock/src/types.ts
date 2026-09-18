export interface ChargeRequestBody {
  cardNumber: string;
  amountCents: number;
  currency: string;
  description: string;
}

export type ChargeStatus = 'approved' | 'declined';

/** What the store keeps for a completed, stored charge (never a `500`). */
export interface ChargeRecord {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  status: ChargeStatus;
  declineCode?: 'card_declined';
  amountCents: number;
  currency: string;
  cardLast4: string;
  createdAt: string;
}

/** `POST /charge`'s 200/402 response body. */
export type ChargeResponseBody = Omit<
  ChargeRecord,
  'idempotencyKey' | 'requestHash'
>;

/** `GET /charge/:idempotencyKey`'s 200 response body. */
export type ChargeStatusResponseBody = Omit<ChargeRecord, 'requestHash'>;

export function toChargeResponse(record: ChargeRecord): ChargeResponseBody {
  const {
    id,
    status,
    declineCode,
    amountCents,
    currency,
    cardLast4,
    createdAt,
  } = record;
  return {
    id,
    status,
    declineCode,
    amountCents,
    currency,
    cardLast4,
    createdAt,
  };
}

export function toChargeStatusResponse(
  record: ChargeRecord,
): ChargeStatusResponseBody {
  const {
    id,
    idempotencyKey,
    status,
    declineCode,
    amountCents,
    currency,
    cardLast4,
    createdAt,
  } = record;
  return {
    id,
    idempotencyKey,
    status,
    declineCode,
    amountCents,
    currency,
    cardLast4,
    createdAt,
  };
}
