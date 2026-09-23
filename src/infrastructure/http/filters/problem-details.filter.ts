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

/** RFC 9457 body. `orderId` is an extension member, set only on the `502`. */
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

/** Exported so the idempotency service stores exactly the status/body the client receives. */
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
 * `exceptionFactory` in main.ts.
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

/** Shape of an `http-errors` error thrown by Express middleware: a `status` and `expose: true` (safe to show). */
interface ExposedHttpError extends Error {
  status: number;
  expose: true;
}

function isExposedHttpError(error: unknown): error is ExposedHttpError {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === 'number' &&
    (error as { expose?: unknown }).expose === true
  );
}

/**
 * Maps every saga outcome to its status. `type` values are
 * `urn:problem-type:*` identifiers — RFC 9457 allows a non-resolvable URI.
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
    // One error class, two statuses via `reason` (422 vs 409).
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
      // SPEC 08: the declined order exists (PAYMENT_FAILED, stock
      // released); exposing its id lets a client open its lifecycle
      // (GET /orders/:id/timeline). Unlike the 502 it is informational —
      // nothing to poll.
      orderId: exception.orderId,
    };
  }

  if (exception instanceof PaymentProviderUnavailableError) {
    const { orderId, failureCode } = exception;
    return {
      status: HttpStatus.BAD_GATEWAY,
      type: 'urn:problem-type:payment-provider-unavailable',
      title: 'Payment provider unavailable',
      // Tell the client to poll the order, not re-post with a new
      // Idempotency-Key (that could charge twice).
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

  // Body-parser limit errors (e.g. 413) come from Express middleware before
  // Nest; they're shaped like http-errors, not HttpException.
  if (isExposedHttpError(exception)) {
    return {
      status: exception.status,
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
 * Single RFC 9457 envelope. `correlationId` always comes from
 * AsyncLocalStorage, never generated here. 500s log the full stack; the
 * logger redacts every object, so card numbers can't reach logs this way.
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
