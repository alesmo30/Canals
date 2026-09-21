import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { correlationStorage } from './correlation';

/** SPEC 04 Named constants — correlation middleware. */
export const CORRELATION_ID_MAX_LENGTH = 128;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]+$/;

function isValidCorrelationId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= CORRELATION_ID_MAX_LENGTH &&
    CORRELATION_ID_PATTERN.test(value)
  );
}

/**
 * SPEC 04 Scope: honours an inbound `X-Correlation-Id` when valid
 * (`isValidCorrelationId`), generates a UUID otherwise, stores it in
 * `correlationStorage` for the rest of the request, and echoes it back —
 * so a client or gateway that already has its own identifier can search
 * its logs and ours with the same string (Decisions, "Correlation and
 * tracing").
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header('X-Correlation-Id');
    const correlationId =
      inbound && isValidCorrelationId(inbound) ? inbound : randomUUID();

    res.setHeader('X-Correlation-Id', correlationId);
    correlationStorage.run({ correlationId }, next);
  }
}
