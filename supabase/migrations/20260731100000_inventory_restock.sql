-- ============================================================================
-- 0015 · Staples, empty-lot cleanup, and name-based deduplication
-- ============================================================================
-- Three related changes to how inventory behaves:
--
--   1. A lot that reaches zero is DELETED rather than kept at 0. An empty
--      shelf row is not inventory; it is clutter that makes "wo ist das
--      Mehl" harder to answer.
--
--   2. Because of (1), the "remind me when this runs low" threshold cannot
--      live on the lot any more — deleting the last lot would delete exactly
--      the row that knows toilet paper needs restocking. It moves to
--      products.restock_min_quantity, which is where it belonged anyway:
--      "we always want toilet paper in the house" is a fact about the
--      product, not about one particular shelf.
--
--      inventory_items.min_quantity is left in place and unused rather than
--      dropped — it is nullable, nothing writes it after this migration, and
--      dropping a column is the one schema change that cannot be undone
--      without data loss if this turns out to be wrong.
--
--   3. Manual (barcode-less) entry now matches an existing catalog entry by
--      name, so typing "Mehl" twice adds to the same product instead of
--      creating a second one. Barcodes already deduplicated; names did not.
-- ============================================================================

alter table public.products
  add column restock_min_quantity numeric(12,3)
    check (restock_min_quantity is null or restock_min_quantity >= 0);

comment on column public.products.restock_min_quantity is
  'Staple threshold. NULL = not tracked. Otherwise household-tick reminds when the total across all lots falls to or below this.';

-- ----------------------------------------------------------------------------
-- v_inventory_totals
--
-- CREATE OR REPLACE VIEW may change an existing column's *expression* but not
-- its name, type or position — so is_low keeps its slot and its boolean type
-- while changing meaning (lot-level min_quantity → product-level threshold),
-- and restock_min_quantity is appended at the end.
-- ----------------------------------------------------------------------------
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
    pr.restock_min_quantity is not null
    and coalesce(sum(i.quantity), 0) <= pr.restock_min_quantity
  )                                                 as is_low,
  pr.restock_min_quantity
from public.products pr
left join public.inventory_items i on i.product_id = pr.id
group by
  pr.household_id, pr.id, pr.name, pr.brand, pr.barcode, pr.category,
  pr.image_url, pr.unit, pr.restock_min_quantity;

-- ----------------------------------------------------------------------------
-- inventory_adjust — now removes an emptied lot.
--
-- The movement is logged *before* the delete. inventory_movements.item_id is
-- ON DELETE SET NULL, so the row survives the deletion with item_id nulled;
-- product_id still carries which product it was, which is what the history
-- screen actually reads.
-- ----------------------------------------------------------------------------
create or replace function public.inventory_adjust(
  p_item_id uuid,
  p_delta   numeric,
  p_reason  text default 'manual_adjust',
  p_note    text default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items;
begin
  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'inventory item not found' using errcode = 'no_data_found';
  end if;

  -- Clamp at zero rather than raising: "we ran out" is the normal case, and a
  -- failed decrement in the UI is more annoying than a floor.
  update public.inventory_items
     set quantity = greatest(0, quantity + p_delta)
   where id = p_item_id
  returning * into v_item;

  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason, note, created_by
  )
  values (v_item.household_id, v_item.id, v_item.product_id, p_delta,
          coalesce(p_reason, 'manual_adjust'), p_note, auth.uid());

  -- An empty lot is not inventory. The product stays in the catalog, so
  -- re-scanning or re-typing it still deduplicates, and a staple keeps
  -- reminding (its threshold lives on the product, not here).
  if v_item.quantity <= 0 then
    delete from public.inventory_items where id = p_item_id;
  end if;

  -- Returned with quantity 0 even when the row is gone: the caller needs an
  -- answer, and every screen refetches from v_inventory_totals anyway.
  return v_item;
end;
$$;

-- ----------------------------------------------------------------------------
-- inventory_scan_in — barcode match first, then name match.
--
-- Name matching is deliberately limited to the barcode-less case. A scanned
-- barcode is authoritative: two different products can share a name ("Mehl"
-- from two brands) and merging them because the text happens to match would
-- be wrong. Typed entry has no such evidence, so the best available signal is
-- the name, normalised the same way products_name_idx is (lower + trim).
-- ----------------------------------------------------------------------------
create or replace function public.inventory_scan_in(
  p_barcode           text        default null,
  p_name              text        default null,
  p_location_id       uuid        default null,
  p_quantity          numeric     default 1,
  p_unit              text        default 'piece',
  p_expires_on        date        default null,
  p_brand             text        default null,
  p_image_url         text        default null,
  p_external_provider text        default null,
  p_external_payload  jsonb       default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household  uuid := public.current_household_id();
  v_product_id uuid;
  v_item       public.inventory_items;
begin
  if v_household is null then
    raise exception 'you do not belong to a household' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = 'check_violation';
  end if;

  if p_barcode is not null then
    select id into v_product_id
    from public.products
    where household_id = v_household and barcode = p_barcode;
  elsif nullif(btrim(p_name), '') is not null then
    -- Matches products_name_idx (household_id, lower(name)) exactly. Prefers
    -- an unbarcoded entry so typing "Mehl" tops up the manually-created one
    -- rather than silently attaching to a scanned product of the same name.
    select id into v_product_id
    from public.products
    where household_id = v_household
      and lower(name) = lower(btrim(p_name))
    order by (barcode is not null), created_at
    limit 1;
  end if;

  if v_product_id is null then
    insert into public.products (
      household_id, barcode, name, brand, unit, image_url,
      default_location_id, source, external_provider, external_payload, created_by
    )
    values (
      v_household,
      p_barcode,
      coalesce(nullif(btrim(p_name), ''), 'Unbenannt ' || coalesce(p_barcode, '')),
      p_brand,
      coalesce(p_unit, 'piece'),
      p_image_url,
      p_location_id,
      case when p_external_provider is not null then 'external'
           when p_barcode is not null          then 'scan'
           else 'manual' end,
      p_external_provider,
      p_external_payload,
      auth.uid()
    )
    returning id into v_product_id;
  end if;

  select * into v_item
  from public.inventory_items
  where household_id = v_household
    and product_id   = v_product_id
    and location_id  is not distinct from p_location_id
    and expires_on   is not distinct from p_expires_on;

  if found then
    update public.inventory_items
       set quantity = quantity + p_quantity
     where id = v_item.id
    returning * into v_item;
  else
    insert into public.inventory_items (
      household_id, product_id, location_id, quantity, unit, expires_on, created_by
    )
    values (
      v_household, v_product_id, p_location_id, p_quantity,
      coalesce(p_unit, 'piece'), p_expires_on, auth.uid()
    )
    returning * into v_item;
  end if;

  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason, to_location_id, created_by
  )
  values (v_household, v_item.id, v_product_id, p_quantity, 'scan_in', p_location_id, auth.uid());

  return v_item;
end;
$$;

-- ----------------------------------------------------------------------------
-- Restock reminders reuse notification_log, so they inherit its whole
-- anti-spam mechanism rather than growing a parallel one.
--
-- The new unique index is NOT partial, and does not need to be: a cleaning
-- row has product_id NULL and a restock row has task_id NULL, so under the
-- default NULLS DISTINCT each index only ever constrains its own kind of row.
-- That also keeps both usable as a PostgREST `on_conflict` target, which a
-- partial index would not be.
--
-- due_on carries the household-local date the reminder was for, so a staple
-- that stays empty nudges at most once per person per day and stops by
-- itself the moment stock goes back above the threshold.
-- ----------------------------------------------------------------------------
alter table public.notification_log
  add column product_id uuid,
  add constraint notification_log_product_fkey
    foreign key (product_id, household_id)
    references public.products (id, household_id) on delete cascade;

alter table public.notification_log
  drop constraint notification_log_kind_check;

alter table public.notification_log
  add constraint notification_log_kind_check
    check (kind in ('due', 'overdue', 'digest', 'restock'));

create unique index notification_log_restock_dedupe
  on public.notification_log (product_id, profile_id, kind, due_on);

-- household-tick reports how many restock nudges it sent, alongside the
-- cleaning reminders and generated bills.
alter table public.system_heartbeat
  add column restock_notifications_sent int not null default 0;
