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
};
