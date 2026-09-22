import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';

import { ListOrdersQueryDto } from '../dto/list-orders-query.dto';
import {
  OrderDetailResponse,
  toOrderDetailResponse,
} from '../dto/order-detail.response.dto';
import {
  OrderListResponse,
  toOrderListResponse,
} from '../dto/order-list.response.dto';
import { GetOrderService } from '../../../application/orders/get-order.service';
import { ListOrdersService } from '../../../application/orders/list-orders.service';

/**
 * specs/06-read-side.md — `GET /orders`/`GET /orders/:id`. Separate file
 * from `orders.controller.ts` (P4, `POST /orders`) — same `orders`
 * prefix, no route collision: `@Get()` is `orders` exact, `@Get(':id')`
 * is `orders/:id`.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersReadController {
  constructor(
    private readonly listOrdersService: ListOrdersService,
    private readonly getOrderService: GetOrderService,
  ) {}

  /**
   * specs/06-read-side.md, Decisions — a local `ValidationPipe`, not the
   * global one in main.ts: `transform: true` is what makes `pageSize`
   * arrive as a `number`, and adding it to the global pipe would risk
   * changing how `CreateOrderDto` (SPEC 05, already verified) coerces its
   * own fields.
   */
  @Get()
  @ApiResponse({ status: 200, description: 'A page of orders.' })
  async list(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: ListOrdersQueryDto,
  ): Promise<OrderListResponse> {
    const result = await this.listOrdersService.execute(query);
    return toOrderListResponse(result);
  }

  @Get(':id')
  @ApiResponse({
    status: 200,
    description: 'The order, its items and its payments.',
  })
  @ApiResponse({ status: 404, description: 'No order with this id.' })
  async detail(@Param('id') id: string): Promise<OrderDetailResponse> {
    const result = await this.getOrderService.execute(id);
    return toOrderDetailResponse(result);
  }
}
