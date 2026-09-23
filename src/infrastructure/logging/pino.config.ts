import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LoggerOptions } from 'pino';

/** pino-http-only option, not part of pino's own LoggerOptions. */
type PinoHttpOptions = LoggerOptions & { wrapSerializers?: boolean };

import { redact } from '../http/redaction';
import { getCorrelationId } from '../observability/correlation';

/**
 * Every log line (Nest logger, pino-http, bootstrap catch) goes through
 * redact() before serialisation — PANs/secrets never reach stdout.
 * formatters.log is the choke point; mixin runs first, so redact() still
 * has the final say over correlationId.
 */
export const pinoOptions: PinoHttpOptions = {
  mixin: () => {
    const correlationId = getCorrelationId();
    return correlationId ? { correlationId } : {};
  },
  formatters: {
    log: (object: Record<string, unknown>) => redact(object),
  },
  // Minimal req/res serializers. wrapSerializers: false hands them the raw
  // req/res; the default wrapping reports statusCode: null.
  // See knowledge/investigations.md#pino-wrapserializers
  wrapSerializers: false,
  serializers: {
    req: (req: IncomingMessage) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res: ServerResponse) => ({
      statusCode: res.statusCode,
    }),
  },
  // Off by default so containers emit JSON; pino-pretty only for local dev.
  transport:
    process.env.LOG_PRETTY === 'true'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  hooks: {
    // formatters.log only sees the merge object; message strings,
    // interpolation args and positional Errors bypass it, and logMethod
    // covers those. A merge object at position 0 is skipped: formatters.log
    // already redacts it, and redact() isn't idempotent, so redacting twice
    // corrupts it.
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
