-- specs/02-fulfilment-core.md — reconstructs every inventory balance by
-- replaying its movements, and returns only the rows that disagree with
-- `inventory`.
--
-- "Replaying" here does not mean summing quantity_delta: that column only
-- tracks quantity_available's own change per movement, has no equivalent
-- for quantity_reserved (COMMIT's delta is 0 even though reserved drops),
-- and has no anchor to a starting value — a row's initial stock is a
-- direct INSERT (seed.ts, or a test fixture), never a movement, so a bare
-- SUM(quantity_delta) would always be off by that untracked starting
-- amount. Every movement row already stores the FULL post-movement
-- balance in available_after/reserved_after — not a delta to accumulate,
-- a snapshot. The latest movement's snapshot, per (warehouse_id,
-- product_id), IS the replayed balance: comparing it against `inventory`
-- catches anything that changed `inventory` without going through
-- reserve/release/commit (a bug, or a manual UPDATE).
WITH latest_movement AS (
  SELECT DISTINCT ON (warehouse_id, product_id)
    warehouse_id,
    product_id,
    available_after,
    reserved_after
  FROM inventory_movements
  ORDER BY warehouse_id, product_id, id DESC
)
SELECT
  i.warehouse_id,
  i.product_id,
  lm.available_after AS expected_available,
  i.quantity_available AS actual_available,
  lm.reserved_after AS expected_reserved,
  i.quantity_reserved AS actual_reserved
FROM inventory i
JOIN latest_movement lm
  ON lm.warehouse_id = i.warehouse_id AND lm.product_id = i.product_id
WHERE i.quantity_available <> lm.available_after
   OR i.quantity_reserved <> lm.reserved_after;
