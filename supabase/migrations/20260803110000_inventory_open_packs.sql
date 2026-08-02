-- ============================================================================
-- 0025 · Angebrochene Packungen
-- ============================================================================
-- inventory_items.quantity has been numeric(12,3) since 0007, so "1,5 Packungen
-- Mehl" was always storable — there was simply no way to say it. The only
-- write path was inventory_adjust(±1) from the stepper, which can express
-- "eine weg" and nothing in between.
--
-- That gap is exactly where the restock threshold lives. With whole packs only,
-- "erinnere mich, wenn nur noch eine Packung da ist" fires while there is still
-- a full, unopened pack in the cupboard — and the alternative, waiting for
-- zero, fires when it is already too late. Half a pack is the answer, and it
-- needs a way in.
--
-- So: set the amount instead of nudging it.
--
-- An RPC rather than an UPDATE, for the same reason inventory_move() is one:
-- the delta has to be computed from the row's *current* value, and computing it
-- on the client means two phones that both saw "2" can write "1,5" twice and
-- lose a pack. Here it happens under a row lock, inside one transaction, and
-- goes through inventory_adjust() — so the movement log, the emptied-lot
-- cleanup and the restock triggers all behave exactly as they do everywhere
-- else, rather than being reimplemented slightly differently.
-- ============================================================================

comment on column public.inventory_items.opened_at is
  'When this lot was first broken into. Set by inventory_set_quantity(p_opened => true); what makes "noch eine halbe Packung" distinguishable from "1,5 ungeöffnete".';

create or replace function public.inventory_set_quantity(
  p_item_id  uuid,
  p_quantity numeric,
  p_opened   boolean default null,
  p_note     text    default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item  public.inventory_items;
  v_delta numeric;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'quantity must not be negative' using errcode = 'check_violation';
  end if;

  -- FOR UPDATE, not a plain select: the delta below is only correct against the
  -- value nobody else is changing at the same moment. RLS applies to the lock
  -- as well, so another household's lot simply does not exist here.
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'inventory item not found' using errcode = 'no_data_found';
  end if;

  -- NULL means "leave it alone", so re-counting a lot does not silently claim
  -- it was opened, and closing it again is expressible.
  if p_opened is not null then
    update public.inventory_items
       set opened_at = case when p_opened then coalesce(opened_at, now()) else null end
     where id = p_item_id
    returning * into v_item;
  end if;

  v_delta := p_quantity - v_item.quantity;
  if v_delta = 0 then
    return v_item;
  end if;

  -- 'correction' rather than 'consume': "es ist noch eine halbe drin" is a
  -- statement about what is there, not a record of something being used.
  return public.inventory_adjust(p_item_id, v_delta, 'correction', p_note);
end;
$$;

comment on function public.inventory_set_quantity(uuid, numeric, boolean, text) is
  'Sets a lot to an exact amount (fractions included) and optionally marks it opened. Goes through inventory_adjust(), so the movement log and the empty-lot cleanup are the same as everywhere else.';

revoke all on function public.inventory_set_quantity(uuid, numeric, boolean, text) from public;
grant execute on function public.inventory_set_quantity(uuid, numeric, boolean, text) to authenticated;
