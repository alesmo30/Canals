-- specs/02-fulfilment-core.md — FR-2, the nearest-warehouse selection.
-- $1 shipping point (geography), $2 product ids (uuid[]), $3 quantities
-- (int[]), positionally matched. One hand-written statement, identical
-- regardless of the number of order lines (R1.1): order lines travel as
-- two parallel arrays unpacked with unnest, never as runtime-built
-- placeholders.
--
-- Step 4 (R1.2) found the planner refuses an Index Scan using
-- idx_warehouses_location_gist once the inventory/product join sits in
-- the same query as the ORDER BY: with several hundred warehouses and
-- fresh ANALYZE statistics, it always materialises the eligible set first
-- and sorts it — a Sort over that small set (0-3 warehouses can usually
-- supply every line) beats probing the GiST index in distance order
-- against a table where most rows will fail the join. True even when
-- every warehouse is eligible. Captured plan and reasoning recorded in
-- the spec's Decisions.
--
-- Documented fallback applied: filter eligible warehouse ids first (the
-- `eligible` CTE — C-6's HAVING lives here), then order only that small
-- set by distance. `warehouses` is touched exactly once, via its primary
-- key, for exactly the eligible ids — cost scales with the eligible set,
-- not with the total number of warehouses.
--
-- ORDER BY still uses the <-> operator (GiST-answerable) and w.id as the
-- tie-break; ST_Distance in the SELECT list is only for the payload.
WITH requested AS (
  SELECT product_id, quantity
  FROM unnest($2::uuid[], $3::int[]) AS t(product_id, quantity)
),
eligible AS (
  SELECT i.warehouse_id
  FROM inventory i
  JOIN requested r ON r.product_id = i.product_id
  JOIN products p ON p.id = i.product_id
  WHERE p.is_active AND i.quantity_available >= r.quantity
  GROUP BY i.warehouse_id
  HAVING count(*) = (SELECT count(*) FROM requested)
)
SELECT w.id, w.name, ST_Distance(w.location, $1::geography) AS distance_meters
FROM warehouses w
JOIN eligible e ON e.warehouse_id = w.id
WHERE w.is_active
ORDER BY w.location <-> $1::geography, w.id
LIMIT 3;
