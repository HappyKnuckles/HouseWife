-- ============================================================================
-- 0032 · Vorräte und Ausstattung
-- ============================================================================
-- Until now every product was implicitly a consumable: it had a quantity that
-- went down, a threshold that could put it on the Einkaufsliste, and a -/+
-- stepper in the list. That is the wrong shape for a Akkuschrauber. A tool does
-- not run out — it is either where it belongs or somebody left it in the Bad.
--
-- So products get a `kind`:
--
--   consumable  what you eat and use up. Everything as before.
--   equipment   what you own. No threshold, no Einkaufsliste, no expiry —
--               instead a *fester Platz* it is supposed to live at.
--
-- The fester Platz is not a new column. products.default_location_id already
-- existed as "where this gets put away when nobody says otherwise", which is
-- the same fact read from the other side: for a consumable it answers "wohin
-- damit", for a tool it also answers "wo müsste es sein". Adding a second
-- location column would mean two answers that can disagree.
--
-- Deliberately on the product and not on the lot, for the same reason the
-- restock threshold is: inventory_adjust() deletes an emptied lot, and a tool
-- that is currently lent out should not lose the memory of where it belongs.
-- ============================================================================

alter table public.products
  add column kind text not null default 'consumable'
    check (kind in ('consumable', 'equipment'));

comment on column public.products.kind is
  'consumable = eaten/used up, tracked by quantity and restock threshold. equipment = owned, tracked by whether it sits at its default_location_id.';

comment on column public.products.default_location_id is
  'Where stock is put away by default (inventory_add_stock falls back to it). For kind = equipment this is also the fester Platz the item is expected to be at.';

-- A tool cannot be "low", so it must not carry a threshold either. Enforced
-- rather than merely avoided in the UI: is_low below reads both columns, and
-- two sources of truth that can contradict each other is exactly how a
-- Bohrmaschine ends up on the Einkaufsliste.
alter table public.products
  add constraint products_equipment_has_no_threshold
    check (kind = 'consumable' or restock_min_quantity is null);

-- ----------------------------------------------------------------------------
-- v_inventory_totals
--
-- CREATE OR REPLACE VIEW may change a column's expression but not its name,
-- type or position — so is_low keeps its slot while gaining the kind guard,
-- and the two new columns are appended at the end.
--
-- default_location_id is exposed here because the Ausstattung list compares it
-- against each lot's actual location; without it every row would need a second
-- round trip to products just to know where it should have been.
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
    pr.kind = 'consumable'
    and pr.restock_min_quantity is not null
    and coalesce(sum(i.quantity), 0) <= pr.restock_min_quantity
  )                                                 as is_low,
  pr.restock_min_quantity,
  pr.kind,
  pr.default_location_id,
  -- Ausstattung that is not at its fester Platz. NULL default_location_id means
  -- no place was ever agreed on, which is not the same as being in the wrong
  -- one — so it stays false rather than flagging every new tool.
  (
    pr.kind = 'equipment'
    and pr.default_location_id is not null
    and coalesce(
      bool_or(i.quantity > 0 and i.location_id is distinct from pr.default_location_id),
      false
    )
  )                                                 as is_misplaced
from public.products pr
left join public.inventory_items i on i.product_id = pr.id
group by
  pr.household_id, pr.id, pr.name, pr.brand, pr.barcode, pr.category,
  pr.image_url, pr.unit, pr.restock_min_quantity, pr.kind, pr.default_location_id;

-- ----------------------------------------------------------------------------
-- The restock to-do sync already reads is_low, so flipping a product to
-- equipment silently makes it ineligible. What it does *not* do by itself is
-- notice — the trigger from 0021 only fires on restock_min_quantity.
--
-- In practice the app clears the threshold in the same UPDATE (the constraint
-- above leaves it no choice), so the old trigger would fire anyway. This makes
-- that a property of the schema rather than of one caller getting it right.
-- ----------------------------------------------------------------------------
drop trigger if exists products_sync_restock_todo on public.products;

create trigger products_sync_restock_todo
  after update of restock_min_quantity, kind on public.products
  for each row
  when (
    new.restock_min_quantity is distinct from old.restock_min_quantity
    or new.kind is distinct from old.kind
  )
  execute function public.tg_products_sync_restock_todo();

-- ----------------------------------------------------------------------------
-- inventory_scan_in — now knows which of the two it is creating.
--
-- DROP and CREATE rather than CREATE OR REPLACE: an added parameter makes a new
-- overload rather than replacing the old one, and two overloads that differ
-- only by a defaulted argument make every named-argument call from PostgREST
-- ambiguous.
--
-- p_kind applies only when a product is *created*. An existing catalog entry
-- keeps its kind: scanning a tool back in must not silently reclassify it, and
-- the barcode/name match is about identity, not about category.
--
-- NULL means "no preference", and is not the same as 'consumable':
--
--   given      the caller just said which of the two this is (the Ausstattung
--              form), so a name match is restricted to that kind — otherwise
--              adding the tool "Batterien" would top up the Vorrat "Batterien".
--   NULL       the caller has no idea (the Einkauf checkout booking in a
--              hand-written row), so any kind may match and a new entry
--              defaults to consumable. Buying a replacement Akkuschrauber
--              should land on the Akkuschrauber you already own — including
--              its fester Platz — rather than fork a second entry.
-- ----------------------------------------------------------------------------
drop function public.inventory_scan_in(text, text, uuid, numeric, text, date, text, text, text, jsonb);

create function public.inventory_scan_in(
  p_barcode           text        default null,
  p_name              text        default null,
  p_location_id       uuid        default null,
  p_quantity          numeric     default 1,
  p_unit              text        default 'piece',
  p_expires_on        date        default null,
  p_brand             text        default null,
  p_image_url         text        default null,
  p_external_provider text        default null,
  p_external_payload  jsonb       default null,
  p_kind              text        default null
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

  if p_kind is not null and p_kind not in ('consumable', 'equipment') then
    raise exception 'unknown product kind %', p_kind using errcode = 'check_violation';
  end if;

  if p_barcode is not null then
    select id into v_product_id
    from public.products
    where household_id = v_household and barcode = p_barcode;
  elsif nullif(btrim(p_name), '') is not null then
    -- Matches products_name_idx (household_id, lower(name)) exactly. Prefers
    -- an unbarcoded entry so typing "Mehl" tops up the manually-created one
    -- rather than silently attaching to a scanned product of the same name.
    --
    -- Narrowed to one kind only when the caller named one — see the note above
    -- the function.
    select id into v_product_id
    from public.products
    where household_id = v_household
      and (p_kind is null or kind = p_kind)
      and lower(name) = lower(btrim(p_name))
    order by (barcode is not null), created_at
    limit 1;
  end if;

  if v_product_id is null then
    insert into public.products (
      household_id, barcode, name, brand, unit, image_url,
      default_location_id, kind, source, external_provider, external_payload, created_by
    )
    values (
      v_household,
      p_barcode,
      coalesce(nullif(btrim(p_name), ''), 'Unbenannt ' || coalesce(p_barcode, '')),
      p_brand,
      coalesce(p_unit, 'piece'),
      p_image_url,
      p_location_id,
      coalesce(p_kind, 'consumable'),
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

-- A freshly created function grants EXECUTE to PUBLIC, so the revoke from 0011
-- has to be re-applied to the new signature.
revoke all on function
  public.inventory_scan_in(text, text, uuid, numeric, text, date, text, text, text, jsonb, text)
from public;

grant execute on function
  public.inventory_scan_in(text, text, uuid, numeric, text, date, text, text, text, jsonb, text)
to authenticated;
