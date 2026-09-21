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
 * specs/02-fulfilment-core.md — R1.3's failover loop. Selects candidates
 * once, then tries each in its own transaction (never a domain-level
 * retry inside `InventoryService` — a rolled-back transaction cannot be
 * retried, so each attempt needs its own, and this is the only component
 * above `reserve` that can open one). `select-warehouse.sql`'s own
 * `LIMIT 3` is what bounds this to "up to 3 attempts" — there is nothing
 * else to cap here.
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
      throw new NoFulfilmentPossibleError(requestedProductIds);
    }

    // Generated once, before the first attempt, and reused across every
    // retry — a failed attempt rolls its whole transaction back, so
    // nothing conflicts, and the id stays stable for whoever is tracking
    // it outside this loop (specs/02-fulfilment-core.md, Decisions).
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

    throw new NoFulfilmentPossibleError(Array.from(unmetProductIds));
  }
}
