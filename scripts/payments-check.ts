import {
  ChargeCommand,
  ChargeResult,
} from '../src/domain/ports/payment-gateway';
import { HttpPaymentGateway } from '../src/infrastructure/payments/http-payment-gateway';

/**
 * SPEC 03 step 10 — the phase's "small driver script" until P4 exposes
 * `curl` on the api itself. Runs the four deterministic test cards
 * (README, step 15) through `HttpPaymentGateway` against the running
 * `payments-mock`, using the adapter's own default timeout/retry
 * constants — not sped up, so this genuinely takes the ~6.6 s worst case
 * for card `0004` alone (about 7 s total for all four).
 */
const DEFAULT_PAYMENTS_URL = 'http://localhost:4000';

interface TestCard {
  cardNumber: string;
  expectedStatus: ChargeResult['status'];
  expectedFailureCode: string | null;
}

const TEST_CARDS: readonly TestCard[] = [
  {
    cardNumber: '4242424242424242',
    expectedStatus: 'CAPTURED',
    expectedFailureCode: null,
  },
  {
    cardNumber: '4000000000000002',
    expectedStatus: 'DECLINED',
    expectedFailureCode: 'CARD_DECLINED',
  },
  {
    cardNumber: '4000000000090003',
    expectedStatus: 'UNKNOWN',
    expectedFailureCode: 'PROVIDER_ERROR',
  },
  {
    cardNumber: '4000000000080004',
    expectedStatus: 'UNKNOWN',
    expectedFailureCode: 'TIMEOUT',
  },
];

function buildCommand(card: TestCard): ChargeCommand {
  return {
    cardNumber: card.cardNumber,
    amountMinor: 9_900,
    currency: 'USD',
    description: 'payments-check',
    idempotencyKey: `payments-check:${card.cardNumber}:${Date.now()}`,
  };
}

function formatLine(
  card: TestCard,
  result: ChargeResult,
  elapsedMs: number,
  matches: boolean,
): string {
  const outcome = `${result.status}${result.failureCode ? `/${result.failureCode}` : ''}`;
  return (
    `${matches ? 'OK  ' : 'FAIL'} card=...${card.cardNumber.slice(-4)} outcome=${outcome} ` +
    `last4=${result.cardLast4 ?? 'null'} brand=${result.cardBrand ?? 'null'} elapsedMs=${elapsedMs}`
  );
}

async function main(): Promise<void> {
  const baseUrl = process.env.PAYMENTS_URL ?? DEFAULT_PAYMENTS_URL;

  let allMatched = true;

  for (const card of TEST_CARDS) {
    // A fresh gateway (and so a fresh, CLOSED breaker) per card: 0003 and
    // 0004 each fail all 3 attempts on their own, 6 failures together —
    // over BREAKER_FAILURE_THRESHOLD (5) if they shared one breaker, which
    // would flip 0004's last attempt to CIRCUIT_OPEN instead of TIMEOUT.
    // Each card here demonstrates its own classification in isolation, the
    // way the real app's breaker tripping across orders (Decisions) does
    // not need to.
    const gateway = new HttpPaymentGateway({ baseUrl });
    const startedAt = Date.now();
    const result = await gateway.charge(buildCommand(card));
    const elapsedMs = Date.now() - startedAt;

    const matches =
      result.status === card.expectedStatus &&
      result.failureCode === card.expectedFailureCode;
    allMatched = allMatched && matches;

    console.log(formatLine(card, result, elapsedMs, matches));
  }

  if (!allMatched) {
    console.error(
      'payments-check FAILED: at least one card did not match its expected outcome.',
    );
    process.exit(1);
  }

  console.log('payments-check PASSED');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
