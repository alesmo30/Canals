import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { join } from 'path';

import {
  API_URL,
  APPROVED_CARD,
  DemoFixture,
  TEST_CARD_NUMBERS,
  buildDataSource,
  buildOrderBody,
  createFixture,
  getComposeLogsSince,
  postOrder,
  verifyLedgerDiscrepancies,
} from './harness';
import {
  DemoContext,
  ScenarioResult,
  scenario1HappyPath,
  scenario2Declined,
  scenario3ProviderTimeout,
  scenario4ReaperResolvesTimeout,
  scenario5ProviderDown,
  scenario6ReaperCancelsAfterRestart,
  scenario7Unsatisfiable,
  scenario8DuplicateKey,
} from './scenarios';

/**
 * specs/07-hardening-demo.md, R6.4 — `npm run demo`. Walks every failure
 * path from README.md's own table through a live `api`/`worker`/
 * `payments-mock`/`postgres` stack (`docker compose up`), printing each
 * scenario's expected outcome beside what actually happened, and ends
 * with the log grep (AC 7) — no test card number or secret anywhere in
 * `docker compose logs`.
 *
 * One own fixture (`createFixture`, `INITIAL_STOCK` units), shared by
 * scenarios 1-8; scenario 9 (`concurrency-e2e`) and its own fixture are
 * entirely separate. Every scenario is independently try/caught
 * (`scenarios.ts`'s `run()`) so one failure still lets the rest — and the
 * final summary — run to completion.
 */
const INITIAL_STOCK = 10;
/** Sequential warm-up orders fired before scenario 9's real burst — see warmUpBeforeConcurrency(). */
const WARMUP_ORDER_COUNT = 3;

/**
 * Scenario 6 just restarted payments-mock (startPaymentsMockAndWait — its
 * own /health answering does not mean the api<->payments-mock path is
 * warm: OTEL instrumentation JIT, the outbound fetch connection pool,
 * payments-mock's own first-request compilation). Firing
 * concurrency-e2e's 5-way-simultaneous burst at that cold path risks one
 * attempt genuinely exceeding ATTEMPT_TIMEOUT_MS (2 s), which alone is
 * enough to trip the shared payments breaker and cascade-fail the others
 * — observed empirically (a `TIMEOUT`, not a `CONNECTION_REFUSED`, and
 * unaffected by an idle sleep in its place; only real traffic warms this
 * up). A few *sequential* real orders exercise the exact same code path
 * concurrency-e2e is about to hit concurrently.
 */
async function warmUpBeforeConcurrency(fixture: DemoFixture): Promise<void> {
  for (let i = 0; i < WARMUP_ORDER_COUNT; i++) {
    await postOrder(buildOrderBody(fixture, APPROVED_CARD), randomUUID());
  }
}

function runScenario9ConcurrencyE2E(): ScenarioResult {
  const name = '9. concurrency-e2e';
  const expected = 'npm run concurrency-e2e exits 0';
  try {
    execFileSync('npm', ['run', 'concurrency-e2e'], {
      stdio: 'inherit',
      cwd: join(__dirname, '../..'),
      env: { ...process.env, API_URL },
    });
    return { name, expected, actual: expected, passed: true };
  } catch (error: unknown) {
    return {
      name,
      expected,
      actual: `FAILED: ${error instanceof Error ? error.message : String(error)}`,
      passed: false,
    };
  }
}

function runScenario10LogGrep(sinceIso: string): ScenarioResult {
  const name = '10. Log grep for secrets';
  const expected =
    'no test card number, and no GEOAPIFY_API_KEY value, anywhere in docker compose logs';
  try {
    const logs = getComposeLogsSince(sinceIso);

    const leaks: string[] = [];
    for (const pan of TEST_CARD_NUMBERS) {
      if (logs.includes(pan)) leaks.push(`card ...${pan.slice(-4)}`);
    }
    const geoapifyKey = process.env.GEOAPIFY_API_KEY;
    if (geoapifyKey && logs.includes(geoapifyKey)) {
      leaks.push('GEOAPIFY_API_KEY value');
    }

    if (leaks.length > 0) {
      throw new Error(`found in logs: ${leaks.join(', ')}`);
    }
    return { name, expected, actual: expected, passed: true };
  } catch (error: unknown) {
    return {
      name,
      expected,
      actual: `FAILED: ${error instanceof Error ? error.message : String(error)}`,
      passed: false,
    };
  }
}

function printResult(result: ScenarioResult): void {
  console.log(`${result.passed ? 'OK  ' : 'FAIL'} ${result.name}`);
  console.log(`     expected: ${result.expected}`);
  console.log(`     actual:   ${result.actual}`);
}

async function main(): Promise<void> {
  const startedAtIso = new Date().toISOString();
  console.log(`--- demo --- apiUrl=${API_URL}`);

  const dataSource = buildDataSource();
  await dataSource.initialize();
  const fixture = await createFixture(dataSource, INITIAL_STOCK);
  const ctx: DemoContext = { dataSource, fixture };

  const results: ScenarioResult[] = [];
  const record = async (
    scenario: () => ScenarioResult | Promise<ScenarioResult>,
  ): Promise<void> => {
    const result = await scenario();
    printResult(result);
    results.push(result);
  };

  await record(() => scenario1HappyPath(ctx));
  await record(() => scenario2Declined(ctx));
  await record(() => scenario3ProviderTimeout(ctx));
  await record(() => scenario4ReaperResolvesTimeout(ctx));
  await record(() => scenario5ProviderDown(ctx));
  await record(() => scenario6ReaperCancelsAfterRestart(ctx));
  await record(() => scenario7Unsatisfiable(ctx));
  await record(() => scenario8DuplicateKey(ctx));

  await warmUpBeforeConcurrency(fixture);
  await record(runScenario9ConcurrencyE2E);

  const ledgerDiscrepancies = await verifyLedgerDiscrepancies(dataSource);
  const ledgerResult: ScenarioResult = {
    name: 'Ledger reconciles',
    expected: '0 discrepancies',
    actual: `${ledgerDiscrepancies} discrepancies`,
    passed: ledgerDiscrepancies === 0,
  };
  printResult(ledgerResult);
  results.push(ledgerResult);

  await record(() => runScenario10LogGrep(startedAtIso));

  await dataSource.destroy();

  const failed = results.filter((result) => !result.passed);
  console.log('');
  if (failed.length > 0) {
    console.error(`${failed.length} scenario(s) FAILED.`);
    process.exit(1);
  }
  console.log('PASSED');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
