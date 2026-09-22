import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { ORDER_STATUS_VALUES } from '../../database/entities/order.orm-entity';
import type { OrderStatus } from '../../../domain/enum-types/order-status';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsUUID('loose')
  customerId?: string;

  @IsOptional()
  @IsIn(ORDER_STATUS_VALUES)
  status?: OrderStatus;

  @IsOptional()
  @IsUUID('loose')
  warehouseId?: string;

  @IsOptional()
  @IsISO8601()
  createdAtFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdAtTo?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
