-- ============================================================================
-- 0021 · Restock to-dos react to stock immediately
-- ============================================================================
-- 0020 only reconciled the list from the hourly cron. So you scan the flour
-- back in, look at the to-do list, and "Mehl kaufen" is still there — for up to
-- an hour. The list is wrong exactly when you are standing in front of it.
--
-- So the reconciliation moves into triggers on the two tables that can change
-- the answer, and the cron keeps calling it as a safety net for anything that
-- changed some other way.
--
-- One function does both directions for one product or for all of them;
-- generate_restock_todos() becomes the "all of them" call. Two copies of this
-- logic would drift the first time one of them is fixed.
-- ============================================================================

create or replace function public.sync_restock_todos(p_product_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created int;
  v_cleared int;
begin
  with resolved as (
    delete from public.todos t
    where t.source = 'restock'
      and not t.is_done
      and t.product_id is not null
      and (p_product_id is null or t.product_id = p_product_id)
      and not exists (
        select 1
        from public.v_inventory_totals v
        where v.product_id = t.product_id
          and v.is_low
      )
    returning 1
  )
  select count(*) into v_cleared from resolved;

  with created as (
    insert into public.todos (household_id, product_id, title, source, position)
    select
      v.household_id,
      v.product_id,
      v.name || ' kaufen',
      'restock',
      coalesce(base.min_position, 0)
        - row_number() over (partition by v.household_id order by v.name)
    from public.v_inventory_totals v
    left join lateral (
      select min(t.position) as min_position
      from public.todos t
      where t.household_id = v.household_id
    ) base on true
    where v.is_low
      and (p_product_id is null or v.product_id = p_product_id)
    on conflict (household_id, product_id) where source = 'restock' and not is_done
    do nothing
    returning 1
  )
  select count(*) into v_created from created;

  return v_created + v_cleared;
end;
$$;

comment on function public.sync_restock_todos(uuid) is
  'Keeps one open to-do per product at or below its restock threshold, and removes it once stock recovers. NULL syncs every product.';

revoke all on function public.sync_restock_todos(uuid) from public;
grant execute on function public.sync_restock_todos(uuid) to service_role;

-- The cron entry point is now a thin wrapper. Kept as its own name because
-- household-tick calls it and the heartbeat column is named after it.
create or replace function public.generate_restock_todos()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.sync_restock_todos(null);
$$;

revoke all on function public.generate_restock_todos() from public;
grant execute on function public.generate_restock_todos() to service_role;

-- ----------------------------------------------------------------------------
-- Triggers
--
-- SECURITY DEFINER so the sync is not subject to the caller's RLS — but the
-- product id comes from the row being written, and RLS already decided the
-- caller may write that row, so this cannot reach another household.
--
-- Both are AFTER triggers: they need the new totals, not the old ones.
-- ----------------------------------------------------------------------------
create or replace function public.tg_inventory_sync_restock_todo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- On DELETE, NEW is unassigned. On INSERT, OLD is.
  perform public.sync_restock_todos(
    coalesce(
      case when tg_op = 'DELETE' then null else new.product_id end,
      case when tg_op = 'INSERT' then null else old.product_id end
    )
  );
  return null;
end;
$$;

-- Fires for every write, including the delete inventory_adjust() does when a
-- lot empties — which is the single most important moment for this feature.
create trigger inventory_items_sync_restock_todo
  after insert or update or delete on public.inventory_items
  for each row execute function public.tg_inventory_sync_restock_todo();

create or replace function public.tg_products_sync_restock_todo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_restock_todos(new.id);
  return null;
end;
$$;

-- Flipping the "Nachkauf-Erinnerung" switch off must take the to-do with it,
-- and switching it on for something already empty must produce one.
create trigger products_sync_restock_todo
  after update of restock_min_quantity on public.products
  for each row
  when (new.restock_min_quantity is distinct from old.restock_min_quantity)
  execute function public.tg_products_sync_restock_todo();
