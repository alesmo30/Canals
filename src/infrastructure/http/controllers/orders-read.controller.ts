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
 * `GET /orders` and `GET /orders/:id`; separate from the `POST /orders`
 * controller, same prefix, no route collision.
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersReadController {
  constructor(
    private readonly listOrdersService: ListOrdersService,
    private readonly getOrderService: GetOrderService,
  ) {}

  /**
   * Local `ValidationPipe` with `transform: true` (so `pageSize` is a
   * number); adding it globally would change `CreateOrderDto` coercion.
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
