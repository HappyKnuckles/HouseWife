-- ============================================================================
-- 0022 · Places you can actually shape
-- ============================================================================
-- Three limits, all of them arbitrary rather than principled:
--
--   1. `kind` was a CHECK over seven values. It only ever picks an icon, so a
--      "Speisekammer" or "Garage" was impossible for no reason at all.
--   2. A location could be created and deleted, never renamed or re-parented.
--      Fixing a typo meant deleting it — which took its QR code with it, and
--      any code already printed and stuck to the shelf became waste paper.
--   3. Re-parenting needs a cycle guard, which is why it is an RPC and not an
--      update policy. parent_id is a plain self-reference; making a location
--      its own grandparent is accepted by every constraint on the table and
--      then hangs the recursive CTE in v_location_paths.
-- ============================================================================

alter table public.storage_locations
  drop constraint storage_locations_kind_check;

-- Still NOT NULL with a default, still the icon key — just no longer a closed
-- set. The client maps the known ones to icons and falls back to a pin.
alter table public.storage_locations
  add constraint storage_locations_kind_check
    check (length(btrim(kind)) between 1 and 40);

comment on column public.storage_locations.kind is
  'Free text. Known values (room, shelf, box, fridge, freezer, cabinet, other) get their own icon in the app; anything else falls back to a generic one.';

-- ----------------------------------------------------------------------------
-- update_location()
--
-- An RPC purely for the cycle check. Everything else here is a plain update
-- that RLS would have allowed anyway.
-- ----------------------------------------------------------------------------
create or replace function public.update_location(
  p_location_id uuid,
  p_name        text default null,
  p_kind        text default null,
  p_parent_id   uuid default null,
  p_clear_parent boolean default false
)
returns public.storage_locations
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_location public.storage_locations;
  v_parent   uuid;
begin
  select * into v_location from public.storage_locations where id = p_location_id;
  if not found then
    raise exception 'location not found' using errcode = 'no_data_found';
  end if;

  -- NULL means "leave it alone", so clearing the parent needs its own flag
  -- rather than overloading NULL to mean both.
  v_parent := case
                when p_clear_parent then null
                when p_parent_id is null then v_location.parent_id
                else p_parent_id
              end;

  if v_parent = p_location_id then
    raise exception 'a location cannot be its own parent' using errcode = 'check_violation';
  end if;

  if v_parent is not null then
    if not exists (
      select 1 from public.storage_locations
      where id = v_parent and household_id = v_location.household_id
    ) then
      raise exception 'parent location is not in this household'
        using errcode = 'foreign_key_violation';
    end if;

    -- Walking up from the proposed parent must never arrive back here. Without
    -- this, v_location_paths recurses forever and the Orte screen stops
    -- loading at all — including the screen you would need to undo it.
    if exists (
      with recursive ancestors as (
        select id, parent_id from public.storage_locations where id = v_parent
        union all
        select l.id, l.parent_id
        from public.storage_locations l
        join ancestors a on l.id = a.parent_id
      )
      select 1 from ancestors where id = p_location_id
    ) then
      raise exception 'that would make the location its own ancestor'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.storage_locations
     set name      = coalesce(nullif(btrim(p_name), ''), name),
         kind      = coalesce(nullif(btrim(p_kind), ''), kind),
         parent_id = v_parent
   where id = p_location_id
  returning * into v_location;

  return v_location;
end;
$$;

comment on function public.update_location(uuid, text, text, uuid, boolean) is
  'Renames / re-types / re-parents a location, refusing any move that would make it its own ancestor.';

revoke all on function public.update_location(uuid, text, text, uuid, boolean) from public;
grant execute on function public.update_location(uuid, text, text, uuid, boolean) to authenticated;
