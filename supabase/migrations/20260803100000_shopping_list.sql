-- ============================================================================
-- 0024 · Einkaufsliste
-- ============================================================================
-- "Klopapier kaufen" was never a to-do. It has a different lifetime (it is
-- gone the moment you are back from the shop), it is read in a different place
-- (standing in the Netto), and it was the only thing on the to-do list nobody
-- had written. Since 0020 the app generates those rows itself, so the to-do
-- list slowly filled up with the household's shopping.
--
-- So: a second list, not a second table.
--
-- A shopping item is a to-do in every way that matters — a title, a checkbox,
-- an optional assignee, a position, hard delete, the same RLS, the same
-- realtime subscription — and it already carries the two columns that only a
-- shopping item has (`product_id`, `source`). A `shopping_items` table would
-- have been a copy of `todos` plus a rewritten sync_restock_todos(), i.e. two
-- of everything to maintain and one more thing the restock triggers could
-- disagree with. One discriminator column buys the same separation for the
-- price of a WHERE clause.
-- ============================================================================

alter table public.todos
  add column list text not null default 'todo'
    check (list in ('todo', 'shopping'));

comment on column public.todos.list is
  'Which of the two lists the row belongs to. Generated restock rows are always shopping.';

-- Everything the generator ever wrote was a shopping item; it only sat on the
-- to-do list because until now there was nowhere else to put it.
update public.todos set list = 'shopping' where source = 'restock';

-- ...and it stays that way. Without this, a restock row could be moved to the
-- to-do list by hand and would then be invisible to the screen that owns it
-- while still blocking todos_restock_open_unique.
alter table public.todos
  add constraint todos_restock_is_shopping
    check (source <> 'restock' or list = 'shopping');

-- Both screens read exactly one list, so `list` belongs directly behind the
-- household. Replaces todos_household_open_idx, whose leading columns no query
-- matches any more — (household_id, list, …) still serves the household-wide
-- reads (clearing done rows) by scanning one household's slice.
drop index if exists todos_household_open_idx;
create index todos_household_list_idx on public.todos (household_id, list, is_done, position);

-- ----------------------------------------------------------------------------
-- sync_restock_todos() — unchanged except for where it writes.
--
-- Two edits, both about the list: generated rows are inserted with
-- list = 'shopping', and the position they are prepended to is now the top of
-- the *shopping* list rather than the top of everything. Without the second
-- one the first shopping item would inherit a position derived from the to-do
-- list and land in an arbitrary spot on its own screen.
-- ----------------------------------------------------------------------------
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
    insert into public.todos (household_id, product_id, title, source, list, position)
    select
      v.household_id,
      v.product_id,
      v.name || ' kaufen',
      'restock',
      'shopping',
      coalesce(base.min_position, 0)
        - row_number() over (partition by v.household_id order by v.name)
    from public.v_inventory_totals v
    left join lateral (
      select min(t.position) as min_position
      from public.todos t
      where t.household_id = v.household_id
        and t.list = 'shopping'
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
  'Keeps one open Einkaufsliste entry per product at or below its restock threshold, and removes it once stock recovers. NULL syncs every product.';

revoke all on function public.sync_restock_todos(uuid) from public;
grant execute on function public.sync_restock_todos(uuid) to service_role;
