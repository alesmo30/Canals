import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { NoFulfilmentPossibleError } from '../../../application/allocation/errors';
import {
  CustomerNotFoundError,
  PaymentDeclinedError,
  PaymentProviderUnavailableError,
  ProductNotFoundError,
} from '../../../application/orders/create-order.errors';
import { GeocodingFailedError } from '../../../domain/ports/geocoding-errors';
import { OrderNotFoundError } from '../../../application/orders/order-read.errors';
import { getCorrelationId } from '../../observability/correlation';

export interface ProblemDetailsErrorItem {
  field: string;
  message: string;
}

/** specs/05-order-creation-saga.md, Data model. `orderId` is an RFC 9457 extension member, set only on the `502` (SPEC 07 Fix C, Decisions). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  correlationId: string;
  errors?: ProblemDetailsErrorItem[];
  orderId?: string;
}

/** Exported so the controller (step 12) can mark `idempotency_keys` COMPLETED with the exact status/body the client is about to receive, without duplicating this mapping. */
export interface ProblemShape {
  status: number;
  type: string;
  title: string;
  detail: string;
  errors?: ProblemDetailsErrorItem[];
  orderId?: string;
}

/**
 * `class-validator`'s own whitelist check (`ValidationExecutor.whitelist`)
 * formats a rejected-property message as the fixed sentence
 * `property ${property} should not exist` — the field name sits in the
 * *second* position, unlike every other constraint message.
 */
const WHITELIST_VIOLATION_PATTERN = /^property (.+) should not exist$/;

/**
 * Nest's `ValidationPipe` (main.ts) formats every other message as
 * `<dot.path> <constraint text>` — even for a nested property, since it
 * prepends the parent path to the message string itself, not to a
 * separate field (`@nestjs/common/pipes/validation.pipe.js`,
 * `prependConstraintsWithParentProp`). Splitting on the first space
 * reliably recovers the path for those, without needing a custom
 * `exceptionFactory` in the already-frozen main.ts.
 */
function extractValidationErrors(
  response: unknown,
): ProblemDetailsErrorItem[] | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const message = (response as { message?: unknown }).message;
  if (!Array.isArray(message)) {
    return undefined;
  }
  return message.map((entry) => {
    const text = String(entry);
    const whitelistMatch = WHITELIST_VIOLATION_PATTERN.exec(text);
    if (whitelistMatch) {
      return { field: whitelistMatch[1], message: text };
    }
    const separatorIndex = text.indexOf(' ');
    const field = separatorIndex === -1 ? text : text.slice(0, separatorIndex);
    return { field, message: text };
  });
}

/**
 * specs/05-order-creation-saga.md, R4.5 — every branch this saga can end
 * in, mapped to its status. `type` values are `urn:problem-type:*`
 * identifiers, not resolvable URLs — RFC 9457 only requires a URI
 * reference that discriminates the problem type, and this codebase has no
 * documentation site to point them at.
 */
export function buildProblem(exception: unknown): ProblemShape {
  if (exception instanceof BadRequestException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      type: 'urn:problem-type:invalid-payload',
      title: 'Invalid payload',
      detail: 'The request body or headers failed validation.',
      errors: extractValidationErrors(exception.getResponse()),
    };
  }

  if (
    exception instanceof CustomerNotFoundError ||
    exception instanceof ProductNotFoundError ||
    exception instanceof OrderNotFoundError
  ) {
    return {
      status: HttpStatus.NOT_FOUND,
      type: 'urn:problem-type:not-found',
      title: 'Resource not found',
      detail: exception.message,
    };
  }

  if (exception instanceof NoFulfilmentPossibleError) {
    // specs/05, Decisions: P1's error carries `reason` so this one class
    // can still map to two different statuses (422 vs 409).
    return exception.reason === 'RESERVATION_RACE_LOST'
      ? {
          status: HttpStatus.CONFLICT,
          type: 'urn:problem-type:inventory-reservation-conflict',
          title: 'Inventory reservation conflict',
          detail: exception.message,
        }
      : {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          type: 'urn:problem-type:no-fulfilment-possible',
          title: 'No fulfilment possible',
          detail: exception.message,
        };
  }

  if (exception instanceof GeocodingFailedError) {
    return {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      type: 'urn:problem-type:geocoding-failed',
      title: 'Geocoding failed',
      detail: exception.message,
    };
  }

  if (exception instanceof PaymentDeclinedError) {
    return {
      status: HttpStatus.PAYMENT_REQUIRED,
      type: 'urn:problem-type:payment-declined',
      title: 'Payment declined',
      detail: exception.message,
    };
  }

  if (exception instanceof PaymentProviderUnavailableError) {
    const { orderId, failureCode } = exception;
    return {
      status: HttpStatus.BAD_GATEWAY,
      type: 'urn:problem-type:payment-provider-unavailable',
      title: 'Payment provider unavailable',
      // SPEC 07 Fix C: tells the client to poll the order instead of
      // re-posting with a new Idempotency-Key, which could charge twice.
      detail:
        `Payment outcome unknown${failureCode ? ` (${failureCode})` : ''}. ` +
        `Order ${orderId} is pending confirmation — poll GET /orders/${orderId}; ` +
        `do not retry with a new Idempotency-Key.`,
      orderId,
    };
  }

  if (exception instanceof HttpException) {
    return {
      status: exception.getStatus(),
      type: 'about:blank',
      title: exception.name,
      detail: exception.message,
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    type: 'about:blank',
    title: 'Internal server error',
    detail: 'An unexpected error occurred.',
  };
}

/**
 * specs/05-order-creation-saga.md — the single RFC 9457 envelope for
 * every error response. `correlationId` always comes from
 * `AsyncLocalStorage` (`CorrelationMiddleware` sets it before any
 * handler runs) — never generated here, so it always matches the
 * request's own trace. Unhandled exceptions (`500`) are logged with
 * their full stack; `nestjs-pino`'s serializer runs every logged object
 * through `redact()` (`shared.module.ts`), so a card number can never
 * reach a log line this way either.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<Request>();
    const problem = buildProblem(exception);

    if (Number(problem.status) >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(exception);
    }

    const body: ProblemDetails = {
      type: problem.type,
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      instance: request.originalUrl,
      correlationId: getCorrelationId() ?? '',
      ...(problem.errors ? { errors: problem.errors } : {}),
      ...(problem.orderId ? { orderId: problem.orderId } : {}),
    };

    response
      .status(problem.status)
      .header('Content-Type', 'application/problem+json')
      .json(body);
  }
}
