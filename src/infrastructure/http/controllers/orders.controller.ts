import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
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
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly createOrderIdempotentService: CreateOrderIdempotentService,
  ) {}

  @Post()
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
