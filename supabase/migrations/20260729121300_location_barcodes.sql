-- ============================================================================
-- 0014 · Location barcodes
-- ============================================================================
-- Lets a storage_location carry a scannable code of its own — print or
-- screenshot the QR the app generates, stick it on the actual shelf/drawer,
-- and scanning it in the inventory scanner selects that location as the
-- active "put away" target for whatever gets scanned next. Solves "where did
-- I put the hammer" by making the drawer itself scannable, not just products.
--
-- The code is app-generated (see generateLocationCode() client-side), not a
-- real EAN/UPC — there is no manufacturer here, just a household labelling its
-- own storage. It is rendered as a QR because that is trivial to generate
-- on-device and expo-camera already decodes it; no separate barcode printer
-- or external generator is required.
-- ============================================================================

alter table public.storage_locations
  add column barcode text
    check (barcode is null or barcode ~ '^[A-Za-z0-9_-]{4,64}$');

-- Same pattern as products.barcode: unique per household, only when set.
create unique index storage_locations_barcode_unique
  on public.storage_locations (household_id, barcode)
  where barcode is not null;

-- CREATE OR REPLACE VIEW may only append columns, never reorder or retype the
-- existing ones. barcode is threaded through the recursive CTE (cheap — one
-- extra column, no per-row subquery) but kept last in the final SELECT so the
-- view's exposed column order stays backward compatible.
create or replace view public.v_location_paths with (security_invoker = true) as
with recursive tree as (
  select
    l.id, l.household_id, l.parent_id, l.name, l.kind, l.sort_order, l.barcode,
    l.name::text as path,
    1            as depth
  from public.storage_locations l
  where l.parent_id is null

  union all

  select
    c.id, c.household_id, c.parent_id, c.name, c.kind, c.sort_order, c.barcode,
    t.path || ' › ' || c.name,
    t.depth + 1
  from public.storage_locations c
  join tree t on t.id = c.parent_id
) cycle id set is_cycle using cycle_path
select id, household_id, parent_id, name, kind, sort_order, path, depth, barcode
from tree
where not is_cycle;

grant select on public.v_location_paths to authenticated;
