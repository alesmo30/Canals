import {
  ChargeCommand,
  ChargeResult,
} from '../src/domain/ports/payment-gateway';
import { HttpPaymentGateway } from '../src/infrastructure/payments/http-payment-gateway';

/**
 * Runs the four test cards through `HttpPaymentGateway` against the live
 * payments-mock with production timeouts (~7 s total, card 0004 dominates).
 * See knowledge/scripts.md#payments-check
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

interface FormatLineParams {
  card: TestCard;
  result: ChargeResult;
  elapsedMs: number;
  matches: boolean;
}

function formatLine(params: FormatLineParams): string {
  const { card, result, elapsedMs, matches } = params;
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
    // Fresh gateway (and breaker) per card: 0003 and 0004 together exceed
    // the breaker threshold and would turn 0004's last attempt into
    // CIRCUIT_OPEN instead of TIMEOUT.
    const gateway = new HttpPaymentGateway({ baseUrl });
    const startedAt = Date.now();
    const result = await gateway.charge(buildCommand(card));
    const elapsedMs = Date.now() - startedAt;

    const matches =
      result.status === card.expectedStatus &&
      result.failureCode === card.expectedFailureCode;
    allMatched = allMatched && matches;

    console.log(formatLine({ card, result, elapsedMs, matches }));
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
