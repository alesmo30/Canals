import type { LoggerOptions } from 'pino';

import { redact } from '../http/redaction';
import { getCorrelationId } from '../observability/correlation';

/**
 * SPEC 03 step 2: every log line — Nest's own logger, `pino-http`'s
 * request/response logging on the api, and the bootstrap `catch` in
 * `main.ts`/`main.worker.ts` — runs through `redact()` before it is
 * serialised, so a PAN or a secret can never reach stdout.
 *
 * `formatters.log` is pino's own hook for the object passed to a call like
 * `logger.info(object)`, run before pino adds `level`/`time`/`pid` and
 * serialises to JSON — the single choke point this relies on. Shared by
 * `LoggerModule.forRoot()` in `SharedModule` and by this file's own test,
 * which builds a raw `pino()` instance over an in-memory stream with these
 * same options.
 *
 * SPEC 04 step 7: `mixin` runs first and pino merges its return value into
 * the log object *before* `formatters.log` sees it, so `redact()` still
 * has the final say over the whole line — `correlationId` is the only
 * field this ever adds, and it is always either the sanitised inbound
 * header or a generated UUID (`correlation.middleware.ts`), never
 * arbitrary data (SPEC 04 Risks, "The pino mixin adds fields that bypass
 * redact()"). `trace_id`/`span_id` come from `PinoInstrumentation`
 * (`tracing.ts`), not from here.
 */
export const pinoOptions: LoggerOptions = {
  mixin: () => {
    const correlationId = getCorrelationId();
    return correlationId ? { correlationId } : {};
  },
  formatters: {
    log: (object: Record<string, unknown>) => redact(object),
  },
  hooks: {
    // SPEC 07 Fix A: `formatters.log` only sees the merge object — the
    // message string (`logger.info('… 4242… failed')`), printf-style
    // interpolation values, and an `Error` passed positionally all bypass
    // it. `logMethod` is pino's hook over the raw positional arguments,
    // before it builds the line, so together with `formatters.log` above
    // it covers the whole line.
    //
    // A plain merging object at position 0 (`logger.info({ cardNumber },
    // 'msg')`) is left alone here: `formatters.log` already redacts it once
    // it is merged into the log object, and `redact()`'s key-based masking
    // is not idempotent (`maskCardValue` strips the mask's own `*`
    // characters as "not a digit" and remasks just the last four), so
    // redacting it twice corrupts it.
    logMethod(args, method) {
      const redactedArgs = args.map((arg, index) =>
        index === 0 &&
        typeof arg === 'object' &&
        arg !== null &&
        !(arg instanceof Error)
          ? arg
          : redact(arg),
      );
      return method.apply(this, redactedArgs as typeof args);
    },
  },
};
