import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { DataSource } from 'typeorm';

import { EVENT_PUBLISHER } from '../../domain/ports/event-publisher';
import type {
  EventPublisher,
  TransactionContext,
} from '../../domain/ports/event-publisher';
import type { OrderConfirmedPayload } from '../messaging/event-routing';

class OrderConfirmedDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}

/**
 * SPEC 04 step 10 — a stand-in for P4's `POST /orders`, registered only
 * when `ENABLE_DEV_ENDPOINTS=true` (`api.module.ts`). Publishes
 * `order.confirmed` inside a transaction exactly as P4 will (Decisions,
 * "A development-only publisher"), so P3's tracing/fan-out criteria have a
 * real HTTP request to start from before the saga exists. P4 deletes this
 * file outright.
 */
@Controller('internal/events')
export class DevEventsController {
  constructor(
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    private readonly dataSource: DataSource,
  ) {}

  @Post('order-confirmed')
  @HttpCode(202)
  async publishOrderConfirmed(@Body() dto: OrderConfirmedDto): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Mirrors the wrapping PgBossEventPublisher itself documents
      // (domain/ports/event-publisher.ts): TypeORM's EntityManager.query()
      // resolves to the bare rows array, not pg-boss's `{ rows }` shape.
      const tx: TransactionContext = {
        executeSql: (sql, values) => manager.query(sql, values),
      };
      await this.eventPublisher.publish(
        {
          type: 'order.confirmed',
          payload: {
            orderId: dto.orderId,
            occurredAt: new Date().toISOString(),
          } satisfies OrderConfirmedPayload,
        },
        tx,
      );
    });
  }
}
