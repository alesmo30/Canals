import { randomUUID } from 'node:crypto';

import { trace } from '@opentelemetry/api';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { correlationStorage } from './correlation';

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
 * Honours a valid inbound X-Correlation-Id, else generates one; stores it
 * for the request and echoes it back.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header('X-Correlation-Id');
    const correlationId =
      inbound && isValidCorrelationId(inbound) ? inbound : randomUUID();

    res.setHeader('X-Correlation-Id', correlationId);
    // Tags the request's own span (from HttpInstrumentation) so Tempo can
    // be searched by this id, same key job-runner.ts sets on each job span.
    trace.getActiveSpan()?.setAttribute('app.correlation_id', correlationId);
    correlationStorage.run({ correlationId }, next);
  }
}
