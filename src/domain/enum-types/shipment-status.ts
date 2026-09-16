/** Mirrors the `shipment_status` Postgres enum (data-model.dbml). */
export type ShipmentStatus =
  'PENDING_DISPATCH' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
