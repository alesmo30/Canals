import type { LoggerOptions } from 'pino';

import { redact } from '../http/redaction';

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
 */
export const pinoOptions: LoggerOptions = {
  formatters: {
    log: (object: Record<string, unknown>) => redact(object),
  },
};
