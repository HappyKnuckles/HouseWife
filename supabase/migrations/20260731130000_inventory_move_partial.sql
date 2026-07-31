-- ============================================================================
-- 0018 · Moving part of a lot
-- ============================================================================
-- inventory_move() could only move a whole lot. "Drei von den zehn Dosen in
-- den Keller" had no expression: you would have had to consume three here and
-- scan three in there, which lies twice in the movement log and loses the
-- expiry date.
--
-- p_quantity null keeps the old meaning — all of it — so the two-argument
-- call still resolves through PostgREST's default handling.
--
-- The old signature is dropped rather than replaced. `create or replace` with
-- a longer parameter list would leave an overload behind, and two functions
-- named inventory_move differing only in defaults is exactly the ambiguity
-- that makes a schema hard to reason about later.
-- ============================================================================

drop function if exists public.inventory_move(uuid, uuid);

create or replace function public.inventory_move(
  p_item_id     uuid,
  p_location_id uuid    default null,
  p_quantity    numeric default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item   public.inventory_items;
  v_target public.inventory_items;
  v_from   uuid;
  v_qty    numeric;
  v_merge  boolean;
begin
  -- RLS makes this return nothing for an item outside the household.
  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'inventory item not found' using errcode = 'no_data_found';
  end if;

  v_qty := coalesce(p_quantity, v_item.quantity);

  if v_qty <= 0 then
    raise exception 'the amount to move must be greater than zero'
      using errcode = 'check_violation';
  end if;

  -- Refusing rather than clamping: the caller asked for an amount that is not
  -- there, and moving silently less would leave stock where they believe it
  -- no longer is. The UI caps its input at the lot, so in practice this only
  -- fires when the other phone consumed some in the meantime — which is
  -- precisely the case worth being told about.
  if v_qty > v_item.quantity then
    raise exception 'only % of this lot is on hand', v_item.quantity
      using errcode = 'check_violation';
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

  -- inventory_items_lot_unique is (product_id, location_id, expires_on) with
  -- NULLS NOT DISTINCT, so the destination may already hold this product at
  -- the same expiry. That is the normal case — you are putting the rest of the
  -- flour where the flour already lives — not an error.
  select * into v_target
  from public.inventory_items
  where household_id = v_item.household_id
    and product_id   = v_item.product_id
    and location_id  is not distinct from p_location_id
    and expires_on   is not distinct from v_item.expires_on
    and id <> v_item.id;

  v_merge := v_target.id is not null;

  if not v_merge and v_qty = v_item.quantity then
    -- Nothing to merge with and everything is going: the lot itself relocates.
    -- Its quantity does not change, hence delta 0.
    update public.inventory_items
       set location_id = p_location_id
     where id = v_item.id
    returning * into v_item;

    insert into public.inventory_movements (
      household_id, item_id, product_id, delta, reason,
      from_location_id, to_location_id, created_by
    )
    values (
      v_item.household_id, v_item.id, v_item.product_id, 0, 'move',
      v_from, p_location_id, auth.uid()
    );

    return v_item;
  end if;

  -- Everything else moves stock *between* two lots, so both sides get a real
  -- delta and the pair cancels out. Logged before the source is touched:
  -- inventory_movements.item_id is ON DELETE SET NULL, so a row written after
  -- the delete would still survive, but one written before also records which
  -- lot it left while that lot still exists.
  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason,
    from_location_id, to_location_id, created_by
  )
  values (
    v_item.household_id, v_item.id, v_item.product_id, -v_qty, 'move',
    v_from, p_location_id, auth.uid()
  );

  if v_qty = v_item.quantity then
    delete from public.inventory_items where id = v_item.id;
  else
    update public.inventory_items
       set quantity = quantity - v_qty
     where id = v_item.id;
  end if;

  if v_merge then
    update public.inventory_items
       set quantity = quantity + v_qty
     where id = v_target.id
    returning * into v_target;
  else
    -- A partial move to a location that holds none of this product yet. The
    -- expiry travels with the stock — it is a property of the goods, not of
    -- the shelf — and so do note and opened_at, because the lot model has no
    -- finer granularity to split them by.
    insert into public.inventory_items (
      household_id, product_id, location_id, quantity, unit,
      expires_on, opened_at, note, created_by
    )
    values (
      v_item.household_id, v_item.product_id, p_location_id, v_qty, v_item.unit,
      v_item.expires_on, v_item.opened_at, v_item.note, auth.uid()
    )
    returning * into v_target;
  end if;

  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason,
    from_location_id, to_location_id, created_by
  )
  values (
    v_target.household_id, v_target.id, v_target.product_id, v_qty, 'move',
    v_from, p_location_id, auth.uid()
  );

  return v_target;
end;
$$;

comment on function public.inventory_move(uuid, uuid, numeric) is
  'Moves stock to another location — all of a lot by default, or p_quantity of it. Merges into an existing lot there, or splits off a new one, rather than failing the lot-uniqueness index.';

revoke all on function public.inventory_move(uuid, uuid, numeric) from public;
grant execute on function public.inventory_move(uuid, uuid, numeric) to authenticated;
