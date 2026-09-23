import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, QueryFailedError } from 'typeorm';

import {
  PaymentDeclinedError,
  PaymentProviderUnavailableError,
} from './create-order.errors';
import { CreateOrderUseCase } from './create-order.use-case';
import type { CreateOrderCommand } from './create-order.types';
import {
  computeRequestFingerprint,
  findActiveByKey,
  insertInProgress,
  markCompleted,
} from './idempotency.repository';
import type { CreateOrderDto } from '../../infrastructure/http/dto/create-order.dto';
import {
  OrderResponse,
  toOrderResponse,
} from '../../infrastructure/http/dto/order-response.dto';
import {
  buildProblem,
  ProblemDetails,
} from '../../infrastructure/http/filters/problem-details.filter';
import { getCorrelationId } from '../../infrastructure/observability/correlation';

/** Postgres error code for a unique-constraint violation (unique_violation). */
const UNIQUE_VIOLATION_ERROR_CODE = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code ===
      UNIQUE_VIOLATION_ERROR_CODE
  );
}

export interface CreateOrderIdempotentParams {
  idempotencyKey: string | undefined;
  dto: CreateOrderDto;
  /** The request path — becomes `ProblemDetails.instance` on error. */
  instance: string;
}

export interface CreateOrderIdempotentResult {
  status: number;
  body: OrderResponse | ProblemDetails;
}

interface NewRequest {
  outcome: 'NEW';
  idempotencyKeyId: string;
}

interface ReplayedRequest {
  outcome: 'REPLAY';
  status: number;
  body: OrderResponse | ProblemDetails;
}

/**
 * Wraps the saga with Idempotency-Key handling, so the use case knows
 * nothing about request idempotency and the controller stays thin.
 */
@Injectable()
export class CreateOrderIdempotentService {
  constructor(
    private readonly createOrderUseCase: CreateOrderUseCase,
    private readonly dataSource: DataSource,
  ) {}

  async execute(
    params: CreateOrderIdempotentParams,
  ): Promise<CreateOrderIdempotentResult> {
    const { dto, instance } = params;
    const idempotencyKey = this.assertValidIdempotencyKey(
      params.idempotencyKey,
    );
    const requestFingerprint = computeRequestFingerprint(dto);

    const begun = await this.beginIdempotentRequest(
      idempotencyKey,
      requestFingerprint,
    );
    if (begun.outcome === 'REPLAY') {
      return { status: begun.status, body: begun.body };
    }

    return this.runAndRecord(begun.idempotencyKeyId, {
      idempotencyKey,
      dto,
      instance,
    });
  }

  /** Missing or malformed header -> 400. */
  private assertValidIdempotencyKey(
    idempotencyKey: string | undefined,
  ): string {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!isUUID(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header must be a UUID');
    }
    return idempotencyKey;
  }

  /**
   * Inserts the row first, under its unique constraint. On conflict,
   * resolves replay / 409 in progress / 422 changed body from the row that
   * blocks the insert.
   */
  private async beginIdempotentRequest(
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<NewRequest | ReplayedRequest> {
    try {
      const idempotencyKeyId = await insertInProgress(this.dataSource, {
        idempotencyKey,
        requestFingerprint,
      });
      return { outcome: 'NEW', idempotencyKeyId };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // Use the row that actually blocks the insert, even if findActiveByKey
      // would treat it as expired.
      const existing = await findActiveByKey(this.dataSource, idempotencyKey);
      if (!existing) {
        throw error;
      }
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new UnprocessableEntityException(
          'Idempotency-Key was already used with a different request body',
        );
      }
      if (existing.state === 'IN_PROGRESS') {
        throw new ConflictException(
          'A request with this Idempotency-Key is still being processed',
        );
      }

      // COMPLETED: replay the stored response verbatim — never a second
      // order, never a second charge.
      return {
        outcome: 'REPLAY',
        status: existing.responseStatus ?? HttpStatus.OK,
        body: existing.responseBody as OrderResponse | ProblemDetails,
      };
    }
  }

  /**
   * Marks the key COMPLETED for any final outcome (success or typed error),
   * reusing buildProblem() so the stored body matches what the filter sends.
   */
  private async runAndRecord(
    idempotencyKeyId: string,
    params: { idempotencyKey: string; dto: CreateOrderDto; instance: string },
  ): Promise<CreateOrderIdempotentResult> {
    const { dto, instance, idempotencyKey } = params;
    const command: CreateOrderCommand = {
      customerId: dto.customerId,
      shippingAddress: dto.shippingAddress,
      lines: dto.items,
      cardNumber: dto.payment.cardNumber,
      idempotencyKey,
    };

    try {
      const result = await this.createOrderUseCase.execute(command);
      const response = toOrderResponse({
        order: result.order,
        items: result.items,
        warehouse: {
          id: result.allocation.warehouseId,
          name: result.allocation.name,
          distanceMeters: result.allocation.distanceMeters,
        },
        paymentStatus: result.payment.status,
      });

      await markCompleted(this.dataSource, {
        id: idempotencyKeyId,
        orderId: result.order.getId(),
        responseStatus: HttpStatus.CREATED,
        responseBody: response,
      });

      return { status: HttpStatus.CREATED, body: response };
    } catch (error: unknown) {
      const problem = buildProblem(error);
      const problemDetails: ProblemDetails = {
        type: problem.type,
        title: problem.title,
        status: problem.status,
        detail: problem.detail,
        instance,
        correlationId: getCorrelationId() ?? '',
        ...(problem.errors ? { errors: problem.errors } : {}),
        ...(problem.orderId ? { orderId: problem.orderId } : {}),
      };

      // 402 and 502 are thrown only after the order row exists, so order_id
      // is recorded for both; both bodies also carry orderId (SPEC 08).
      const orderId =
        error instanceof PaymentDeclinedError ||
        error instanceof PaymentProviderUnavailableError
          ? error.orderId
          : null;

      await markCompleted(this.dataSource, {
        id: idempotencyKeyId,
        orderId,
        responseStatus: problem.status,
        responseBody: problemDetails,
      });

      throw error;
    }
  }
}
