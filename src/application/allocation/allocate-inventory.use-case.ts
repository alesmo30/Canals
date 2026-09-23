import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { InsufficientStockError, NoFulfilmentPossibleError } from './errors';
import { InventoryService } from './inventory.service';
import { OnBeforeReserve, OrderLine } from './allocation.types';
import { WarehouseSelectionRepository } from '../../infrastructure/database/repositories/warehouse-selection.repository';
import { Coordinates } from '../../domain/value-objects/coordinates';

export interface AllocateInventoryCommand {
  shippingLocation: Coordinates;
  lines: OrderLine[];
  onBeforeReserve: OnBeforeReserve;
}

export interface AllocationResult {
  orderId: string;
  warehouseId: string;
  name: string;
  distanceMeters: number;
}

/**
 * Selects candidates once, then tries each in its own transaction (a
 * rolled-back transaction can't be retried). The SQL's LIMIT 3 bounds the
 * attempts.
 */
@Injectable()
export class AllocateInventoryUseCase {
  constructor(
    private readonly warehouseSelectionRepository: WarehouseSelectionRepository,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  async execute(command: AllocateInventoryCommand): Promise<AllocationResult> {
    const requestedProductIds = command.lines.map((line) => line.productId);

    const candidates = await this.warehouseSelectionRepository.findCandidates(
      command.shippingLocation,
      command.lines,
    );

    if (candidates.length === 0) {
      throw new NoFulfilmentPossibleError(requestedProductIds, 'NO_CANDIDATES');
    }

    // Generated once and reused across attempts: a failed attempt rolls back
    // fully, and the id stays stable for whoever tracks it.
    const orderId = randomUUID();
    const unmetProductIds = new Set<string>();

    for (const candidate of candidates) {
      try {
        await this.dataSource.transaction(async (manager) => {
          await command.onBeforeReserve(manager, {
            orderId,
            warehouseId: candidate.warehouseId,
          });
          await this.inventoryService.reserve(manager, {
            orderId,
            warehouseId: candidate.warehouseId,
            lines: command.lines,
          });
        });

        return {
          orderId,
          warehouseId: candidate.warehouseId,
          name: candidate.name,
          distanceMeters: candidate.distanceMeters,
        };
      } catch (error: unknown) {
        if (error instanceof InsufficientStockError) {
          error.productIds.forEach((productId) =>
            unmetProductIds.add(productId),
          );
          continue;
        }
        throw error;
      }
    }

    throw new NoFulfilmentPossibleError(
      Array.from(unmetProductIds),
      'RESERVATION_RACE_LOST',
    );
  }
}
