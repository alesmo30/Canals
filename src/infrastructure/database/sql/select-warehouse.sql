-- specs/02-fulfilment-core.md — FR-2, the nearest-warehouse selection.
-- $1 shipping point (geography), $2 product ids (uuid[]), $3 quantities
-- (int[]), positionally matched. One hand-written statement, identical
-- regardless of the number of order lines (R1.1): order lines travel as
-- two parallel arrays unpacked with unnest, never as runtime-built
-- placeholders.
--
-- HAVING count(*) = (SELECT count(*) FROM requested) is C-6: a warehouse
-- covering only some of the requested lines produces fewer rows than
-- requested and is discarded. Combined stock across warehouses is never
-- considered — an order is never split.
--
-- ORDER BY uses the <-> operator, which the GiST index on
-- warehouses.location answers; ST_Distance in the SELECT list is only for
-- the payload — ordering by it instead would force a sort node. w.id as
-- the second ORDER BY key makes the result reproducible when two
-- warehouses sit at the same distance.
WITH requested AS (
  SELECT product_id, quantity
  FROM unnest($2::uuid[], $3::int[]) AS t(product_id, quantity)
)
SELECT w.id, w.name, ST_Distance(w.location, $1::geography) AS distance_meters
FROM warehouses w
JOIN inventory i ON i.warehouse_id = w.id
JOIN requested r ON r.product_id = i.product_id
JOIN products p ON p.id = i.product_id
WHERE w.is_active AND p.is_active AND i.quantity_available >= r.quantity
GROUP BY w.id, w.name, w.location
HAVING count(*) = (SELECT count(*) FROM requested)
ORDER BY w.location <-> $1::geography, w.id
LIMIT 3;
