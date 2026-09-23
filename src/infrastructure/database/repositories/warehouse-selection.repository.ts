import { readFileSync } from 'fs';
import { join } from 'path';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Coordinates } from '../../../domain/value-objects/coordinates';
import { OrderLine } from '../../../application/allocation/allocation.types';

/** One row per candidate, as select-warehouse.sql returns it; nothing re-checks what the query guarantees. */
export interface WarehouseCandidate {
  warehouseId: string;
  name: string;
  distanceMeters: number;
}

interface WarehouseCandidateRow {
  id: string;
  name: string;
  distance_meters: string | number;
}

// Loaded once at module init; the statement never changes per order.
const SELECT_WAREHOUSE_SQL = readFileSync(
  join(__dirname, '../sql/select-warehouse.sql'),
  'utf-8',
);

/**
 * The whole warehouse-selection rule lives in select-warehouse.sql; this
 * class only loads it, binds parameters and maps rows.
 */
@Injectable()
export class WarehouseSelectionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findCandidates(
    shippingPoint: Coordinates,
    lines: OrderLine[],
  ): Promise<WarehouseCandidate[]> {
    // ST_MakePoint/geography text input both take (longitude, latitude) —
    // see coordinates.ts's own guard against the reversed-pair mistake.
    // geography's default SRID is 4326, so plain WKT needs no explicit SRID.
    const point = `POINT(${shippingPoint.getLongitude()} ${shippingPoint.getLatitude()})`;
    const productIds = lines.map((line) => line.productId);
    const quantities = lines.map((line) => line.quantity);

    const rows: WarehouseCandidateRow[] = await this.dataSource.query(
      SELECT_WAREHOUSE_SQL,
      [point, productIds, quantities],
    );

    return rows.map((row) => ({
      warehouseId: row.id,
      name: row.name,
      distanceMeters: Number(row.distance_meters),
    }));
  }
}
