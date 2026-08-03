-- ============================================================================
-- 0029 · Vom Einkauf zurück ins Inventar
-- ============================================================================
-- The last missing edge of the loop. Stock running low writes a line onto the
-- Einkaufsliste (0024); buying it books an expense (0028); and now putting it
-- away books it back into the inventory — which is what makes the threshold
-- stop firing without anyone scanning anything a second time.
--
-- inventory_scan_in() cannot be reused here. It resolves a product by barcode
-- or, failing that, by name — and a shopping row already *knows* its
-- product_id, having been generated from it. Going back through the name would
-- be strictly worse: two products can share a name, and the name match
-- deliberately prefers the unbarcoded entry, so "Mehl" bought from a
-- restock reminder for the scanned Mehl could top up the wrong catalog row.
--
-- Same shape as inventory_scan_in() otherwise: find the (product, location,
-- no expiry) lot, add to it or create it, log the movement.
-- ============================================================================

create or replace function public.inventory_add_stock(
  p_product_id  uuid,
  p_quantity    numeric default 1,
  p_location_id uuid    default null,
  p_note        text    default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household uuid := public.current_household_id();
  v_product   public.products;
  v_location  uuid;
  v_item      public.inventory_items;
begin
  if v_household is null then
    raise exception 'you do not belong to a household' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = 'check_violation';
  end if;

  -- RLS already restricts this select to the caller's household, so a product
  -- id from somewhere else simply does not exist here.
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'product not found' using errcode = 'no_data_found';
  end if;

  -- Where it usually lives, unless told otherwise. Someone unpacking shopping
  -- should not have to answer "welches Regal" for the flour they have put in
  -- the same cupboard for a year.
  v_location := coalesce(p_location_id, v_product.default_location_id);

  select * into v_item
  from public.inventory_items
  where household_id = v_household
    and product_id   = p_product_id
    and location_id  is not distinct from v_location
    and expires_on   is null;

  if found then
    update public.inventory_items
       set quantity = quantity + p_quantity
     where id = v_item.id
    returning * into v_item;
  else
    insert into public.inventory_items (
      household_id, product_id, location_id, quantity, unit, created_by
    )
    values (v_household, p_product_id, v_location, p_quantity, v_product.unit, auth.uid())
    returning * into v_item;
  end if;

  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason, to_location_id, note, created_by
  )
  values (v_household, v_item.id, p_product_id, p_quantity, 'scan_in', v_location, p_note, auth.uid());

  return v_item;
end;
$$;

comment on function public.inventory_add_stock(uuid, numeric, uuid, text) is
  'Books stock onto a known product — the way back from the Einkaufsliste into the inventory. Exact by product id, unlike inventory_scan_in() which resolves by barcode or name.';

revoke all on function public.inventory_add_stock(uuid, numeric, uuid, text) from public;
grant execute on function public.inventory_add_stock(uuid, numeric, uuid, text) to authenticated;
