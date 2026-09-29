-- ============================================================================
-- 0033 · Gewicht pro Packung in v_inventory_totals
-- ============================================================================
-- products.net_quantity already stores "wieviel pro Packung/Stück drin ist"
-- (typically grams). Exposing it on v_inventory_totals lets the app derive
-- total stored weight straight from the existing quantity updates.
-- ============================================================================

create or replace view public.v_inventory_totals with (security_invoker = true) as
select
  pr.household_id,
  pr.id                                             as product_id,
  pr.name,
  pr.brand,
  pr.barcode,
  pr.category,
  pr.image_url,
  pr.unit,
  coalesce(sum(i.quantity), 0)::numeric(12,3)       as total_quantity,
  count(i.id) filter (where i.quantity > 0)::int    as location_count,
  min(i.expires_on)                                 as next_expiry,
  (
    pr.kind = 'consumable'
    and pr.restock_min_quantity is not null
    and coalesce(sum(i.quantity), 0) <= pr.restock_min_quantity
  )                                                 as is_low,
  pr.restock_min_quantity,
  pr.kind,
  pr.default_location_id,
  (
    pr.kind = 'equipment'
    and pr.default_location_id is not null
    and coalesce(
      bool_or(i.quantity > 0 and i.location_id is distinct from pr.default_location_id),
      false
    )
  )                                                 as is_misplaced,
  pr.net_quantity
from public.products pr
left join public.inventory_items i on i.product_id = pr.id
group by
  pr.household_id, pr.id, pr.name, pr.brand, pr.barcode, pr.category,
  pr.image_url, pr.unit, pr.restock_min_quantity, pr.kind, pr.default_location_id,
  pr.net_quantity;
