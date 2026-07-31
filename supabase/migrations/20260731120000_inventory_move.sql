-- ============================================================================
-- 0017 · Moving stock between locations
-- ============================================================================
-- "Das Mehl steht jetzt im Keller" was expressible in the schema — the
-- movement log has had from_location_id/to_location_id and reason = 'move'
-- since the start — but there was no way to actually do it.
--
-- A plain `update inventory_items set location_id = ...` is not good enough:
-- inventory_items_lot_unique is (product_id, location_id, expires_on) with
-- NULLS NOT DISTINCT, so moving a lot into a location that already holds the
-- same product with the same expiry hits a unique violation. That is not an
-- error case, it is the *normal* case — you are putting the rest of the flour
-- where the flour already lives. So the move merges instead.
-- ============================================================================

create or replace function public.inventory_move(
  p_item_id     uuid,
  p_location_id uuid default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item   public.inventory_items;
  v_target public.inventory_items;
  v_from   uuid;
begin
  -- RLS makes this return nothing for an item outside the household.
  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'inventory item not found' using errcode = 'no_data_found';
  end if;

  if v_item.location_id is not distinct from p_location_id then
    return v_item;
  end if;

  v_from := v_item.location_id;

  -- The composite FK on inventory_items only guarantees the location belongs
  -- to *some* household once it is written; checking here gives a readable
  -- error instead of a constraint name.
  if p_location_id is not null and not exists (
    select 1 from public.storage_locations
    where id = p_location_id and household_id = v_item.household_id
  ) then
    raise exception 'location is not in this household' using errcode = 'foreign_key_violation';
  end if;

  select * into v_target
  from public.inventory_items
  where household_id = v_item.household_id
    and product_id   = v_item.product_id
    and location_id  is not distinct from p_location_id
    and expires_on   is not distinct from v_item.expires_on
    and id <> v_item.id;

  if found then
    -- Merge: the destination already holds this product with the same expiry.
    update public.inventory_items
       set quantity = quantity + v_item.quantity
     where id = v_target.id
    returning * into v_target;

    delete from public.inventory_items where id = v_item.id;
    v_item := v_target;
  else
    update public.inventory_items
       set location_id = p_location_id
     where id = v_item.id
    returning * into v_item;
  end if;

  -- delta 0: a move changes where stock is, never how much of it there is.
  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason,
    from_location_id, to_location_id, created_by
  )
  values (
    v_item.household_id, v_item.id, v_item.product_id, 0, 'move',
    v_from, p_location_id, auth.uid()
  );

  return v_item;
end;
$$;

comment on function public.inventory_move(uuid, uuid) is
  'Moves a stock lot to another location, merging into an existing lot there rather than failing the lot-uniqueness index.';

revoke all on function public.inventory_move(uuid, uuid) from public;
grant execute on function public.inventory_move(uuid, uuid) to authenticated;
