import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { DataSource, QueryFailedError } from 'typeorm';

import { CreateOrderDto } from '../dto/create-order.dto';
import { OrderResponse, toOrderResponse } from '../dto/order-response.dto';
import {
  buildProblem,
  ProblemDetails,
} from '../filters/problem-details.filter';
import { CreateOrderUseCase } from '../../../application/orders/create-order.use-case';
import type { CreateOrderCommand } from '../../../application/orders/create-order.types';
import {
  computeRequestFingerprint,
  findActiveByKey,
  insertInProgress,
  markCompleted,
} from '../../../application/orders/idempotency.repository';
import { getCorrelationId } from '../../observability/correlation';

/** Postgres error code for a unique-constraint violation (unique_violation). */
const UNIQUE_VIOLATION_ERROR_CODE = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code ===
      UNIQUE_VIOLATION_ERROR_CODE
  );
}

/**
 * specs/05-order-creation-saga.md — `POST /orders`. Owns the
 * `Idempotency-Key` dance (FR-6) around `CreateOrderUseCase`'s saga: the
 * use case itself knows nothing about request-level idempotency, only
 * about orders, payments and inventory.
 */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly createOrderUseCase: CreateOrderUseCase,
    private readonly dataSource: DataSource,
  ) {}

  @Post()
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponse | ProblemDetails> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!isUUID(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header must be a UUID');
    }

    const requestFingerprint = computeRequestFingerprint(dto);

    let idempotencyKeyId: string;
    try {
      idempotencyKeyId = await insertInProgress(this.dataSource, {
        idempotencyKey,
        requestFingerprint,
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // The row is what's actually blocking the insert, regardless of
      // whether findActiveByKey still considers it active (specs/05,
      // Risks — an expired-but-unreaped row's fate is P6's to decide).
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

      // COMPLETED: replay the stored response verbatim (FR-6) — never a
      // second order, never a second charge.
      res.status(existing.responseStatus ?? HttpStatus.OK);
      return existing.responseBody as OrderResponse | ProblemDetails;
    }

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

      return response;
    } catch (error: unknown) {
      // Marked COMPLETED for any final outcome, success or error alike
      // (specs/05, Decisions) — including a 502 for an UNKNOWN payment
      // outcome. The body stored here is exactly what the client is
      // about to receive from the global filter, built the same way.
      const problem = buildProblem(error);
      const problemDetails: ProblemDetails = {
        type: problem.type,
        title: problem.title,
        status: problem.status,
        detail: problem.detail,
        instance: req.originalUrl,
        correlationId: getCorrelationId() ?? '',
        ...(problem.errors ? { errors: problem.errors } : {}),
      };

      await markCompleted(this.dataSource, {
        id: idempotencyKeyId,
        orderId: null,
        responseStatus: problem.status,
        responseBody: problemDetails,
      });

      throw error;
    }
  }
}
