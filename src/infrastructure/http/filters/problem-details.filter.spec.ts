import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { ProblemDetailsFilter, ProblemDetails } from './problem-details.filter';
import { NoFulfilmentPossibleError } from '../../../application/allocation/errors';
import {
  CustomerNotFoundError,
  PaymentDeclinedError,
  PaymentProviderUnavailableError,
  ProductNotFoundError,
} from '../../../application/orders/create-order.errors';
import { GeocodingFailedError } from '../../../domain/ports/geocoding-errors';
import { OrderNotFoundError } from '../../../application/orders/order-read.errors';
import { correlationStorage } from '../../observability/correlation';

/**
 * One case per error-mapping row, calling `.catch()` directly without
 * booting Nest.
 */
describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  function runCatch(exception: unknown): ProblemDetails {
    let statusCode: number | undefined;
    let headerArgs: [string, string] | undefined;
    let jsonBody: ProblemDetails | undefined;

    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      header(name: string, value: string) {
        headerArgs = [name, value];
        return this;
      },
      json(body: ProblemDetails) {
        jsonBody = body;
        return this;
      },
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ originalUrl: '/orders' }),
      }),
    } as unknown as ArgumentsHost;

    correlationStorage.run({ correlationId: 'test-correlation-id' }, () => {
      filter.catch(exception, host);
    });

    expect(headerArgs).toEqual(['Content-Type', 'application/problem+json']);
    expect(jsonBody).toBeDefined();
    expect(jsonBody?.status).toBe(statusCode);
    return jsonBody as ProblemDetails;
  }

  it('maps an invalid payload (ValidationPipe BadRequestException) to 400 with flattened errors[]', () => {
    const exception = new BadRequestException({
      message: [
        'shippingAddress.country must be one of the following values: US',
        'items.0.quantity must not be less than 1',
      ],
      error: 'Bad Request',
      statusCode: 400,
    });

    const body = runCatch(exception);

    expect(body.status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.instance).toBe('/orders');
    expect(body.correlationId).toBe('test-correlation-id');
    expect(body.errors).toEqual([
      {
        field: 'shippingAddress.country',
        message:
          'shippingAddress.country must be one of the following values: US',
      },
      {
        field: 'items.0.quantity',
        message: 'items.0.quantity must not be less than 1',
      },
    ]);
  });

  it('extracts the field name from a whitelist-violation message (a real ValidationPipe shape, "property X should not exist")', () => {
    const exception = new BadRequestException({
      message: ['property extraField should not exist'],
      error: 'Bad Request',
      statusCode: 400,
    });

    const body = runCatch(exception);

    expect(body.errors).toEqual([
      {
        field: 'extraField',
        message: 'property extraField should not exist',
      },
    ]);
  });

  it('maps CustomerNotFoundError to 404', () => {
    const body = runCatch(new CustomerNotFoundError('cust-1'));

    expect(body.status).toBe(HttpStatus.NOT_FOUND);
    expect(body.detail).toContain('cust-1');
  });

  it('maps ProductNotFoundError to 404', () => {
    const body = runCatch(new ProductNotFoundError(['prod-1']));

    expect(body.status).toBe(HttpStatus.NOT_FOUND);
    expect(body.detail).toContain('prod-1');
  });

  it('maps OrderNotFoundError to 404, same shape as CustomerNotFoundError', () => {
    const body = runCatch(new OrderNotFoundError('order-1'));

    expect(body.status).toBe(HttpStatus.NOT_FOUND);
    expect(body.type).toBe('urn:problem-type:not-found');
    expect(body.title).toBe('Resource not found');
    expect(body.detail).toContain('order-1');
  });

  it('maps NoFulfilmentPossibleError(NO_CANDIDATES) to 422', () => {
    const body = runCatch(
      new NoFulfilmentPossibleError(['prod-1'], 'NO_CANDIDATES'),
    );

    expect(body.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(body.type).toBe('urn:problem-type:no-fulfilment-possible');
  });

  it('maps GeocodingFailedError to 422', () => {
    const body = runCatch(
      new GeocodingFailedError('UNKNOWN_ADDRESS', 'could not geocode'),
    );

    expect(body.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(body.type).toBe('urn:problem-type:geocoding-failed');
  });

  it('maps NoFulfilmentPossibleError(RESERVATION_RACE_LOST) to 409', () => {
    const body = runCatch(
      new NoFulfilmentPossibleError(['prod-1'], 'RESERVATION_RACE_LOST'),
    );

    expect(body.status).toBe(HttpStatus.CONFLICT);
    expect(body.type).toBe('urn:problem-type:inventory-reservation-conflict');
  });

  it('maps PaymentDeclinedError to 402, carrying the declined order id (SPEC 08)', () => {
    const body = runCatch(
      new PaymentDeclinedError({
        orderId: 'order-1',
        failureCode: 'CARD_DECLINED',
      }),
    );

    expect(body.status).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(body.orderId).toBe('order-1');
  });

  it('maps PaymentProviderUnavailableError to 502, carrying orderId and a pending-confirmation detail', () => {
    const body = runCatch(
      new PaymentProviderUnavailableError({
        orderId: 'order-2',
        failureCode: 'TIMEOUT',
      }),
    );

    expect(body.status).toBe(HttpStatus.BAD_GATEWAY);
    expect(body.orderId).toBe('order-2');
    expect(body.detail).toContain('order-2');
    expect(body.detail).toContain('poll GET /orders/order-2');
    expect(body.detail).toContain('do not retry with a new Idempotency-Key');
  });

  it('maps an unrelated NestJS HttpException (e.g. an unmatched route) generically', () => {
    const body = runCatch(new NotFoundException('Cannot POST /nope'));

    expect(body.status).toBe(HttpStatus.NOT_FOUND);
    expect(body.type).toBe('about:blank');
  });

  it("maps an http-errors-shaped exception (e.g. body-parser's 413) to its own status, not a generic 500", () => {
    const error = Object.assign(new Error('request entity too large'), {
      name: 'PayloadTooLargeError',
      status: 413,
      expose: true,
    });

    const body = runCatch(error);

    expect(body.status).toBe(413);
    expect(body.type).toBe('about:blank');
    expect(body.detail).toBe('request entity too large');
  });

  it('maps an unknown thrown value to a generic 500, without leaking its message', () => {
    const body = runCatch(new Error('boom, contains sensitive stack info'));

    expect(body.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.type).toBe('about:blank');
    expect(body.detail).toBe('An unexpected error occurred.');
  });
});
