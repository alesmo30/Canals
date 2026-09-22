import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CreateOrderDto } from '../dto/create-order.dto';
import { OrderResponse } from '../dto/order-response.dto';
import { ProblemDetails } from '../filters/problem-details.filter';
import { CreateOrderIdempotentService } from '../../../application/orders/create-order-idempotent.service';

/**
 * specs/05-order-creation-saga.md — `POST /orders`. A thin HTTP adapter:
 * all of the `Idempotency-Key` orchestration lives in
 * `CreateOrderIdempotentService` (application layer), including which
 * status/body this endpoint answers with.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly createOrderIdempotentService: CreateOrderIdempotentService,
  ) {}

  /**
   * SPEC 07 R6.6: `OrderResponse`/`ProblemDetails` are plain interfaces
   * (no runtime metadata for the CLI plugin to introspect), so each
   * outcome is documented with an `@ApiResponse` description instead of a
   * generated schema.
   */
  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A UUID scoping this request. Replaying the same key with the same body returns the original response byte-identically — never a second order or charge.',
  })
  @ApiResponse({ status: 201, description: 'Order created; payment captured.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid payload, or a missing/malformed Idempotency-Key.',
  })
  @ApiResponse({ status: 402, description: 'Payment declined.' })
  @ApiResponse({ status: 404, description: 'Customer or product not found.' })
  @ApiResponse({
    status: 409,
    description:
      'Inventory reservation conflict, or a request with this Idempotency-Key is still in progress.',
  })
  @ApiResponse({
    status: 422,
    description:
      'No fulfilment possible, geocoding failed, or the Idempotency-Key was already used with a different body.',
  })
  @ApiResponse({
    status: 502,
    description:
      'Payment provider unavailable. The order is PENDING_PAYMENT — poll GET /orders/:id; do not retry with a new Idempotency-Key.',
  })
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponse | ProblemDetails> {
    const result = await this.createOrderIdempotentService.execute({
      idempotencyKey,
      dto,
      instance: req.originalUrl,
    });

    res.status(result.status);
    return result.body;
  }
}
