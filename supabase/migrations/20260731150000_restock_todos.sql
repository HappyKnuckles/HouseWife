-- ============================================================================
-- 0020 · Low stock writes itself onto the to-do list
-- ============================================================================
-- The restock push (migration 0015) nudges you once and is then gone. What you
-- actually want at the shop is a list, and there already is one.
--
-- The trigger for this is the switch that already exists: a product with
-- restock_min_quantity set is one you asked to be reminded about. No second
-- opt-in, no new column on products.
--
-- Two directions, both in the generator:
--   low  → an open to-do exists
--   not low → that to-do disappears again
-- The second half matters more than it looks. Without it, buying the toilet
-- paper leaves "Klopapier kaufen" on the list until someone ticks it by hand,
-- and a list that lies gets ignored.
-- ============================================================================

alter table public.todos
  add column product_id uuid,
  add column source     text not null default 'manual'
    check (source in ('manual', 'restock'));

-- Composite FK, like everywhere else: the product must belong to the same
-- household as the to-do, not merely exist.
alter table public.todos
  add constraint todos_product_fkey foreign key (product_id, household_id)
    references public.products (id, household_id) on delete set null (product_id);

-- The dedupe. Partial, because it must constrain only the generated rows: you
-- can still write "Klopapier kaufen" by hand as often as you like, and a
-- ticked-off restock to-do must not block the next one months later.
create unique index todos_restock_open_unique
  on public.todos (household_id, product_id)
  where source = 'restock' and not is_done;

-- ----------------------------------------------------------------------------
-- generate_restock_todos()
--
-- SECURITY DEFINER and parameterless for the same reason as
-- generate_due_recurring_expenses(): the caller is the cron, which has no
-- household and no auth.uid(), so it cannot pass current_household_id() and
-- must not be trusted to pass a household id either.
--
-- created_by stays NULL. Nobody wrote this to-do; claiming one of the two
-- members did would put a wrong face on the row.
-- ----------------------------------------------------------------------------
create or replace function public.generate_restock_todos()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created int;
  v_cleared int;
begin
  -- Gone again: stock is back above the threshold, or the reminder was
  -- switched off entirely. Only rows this function created are touched, and
  -- only while they are still open — a ticked-off to-do is history.
  with resolved as (
    delete from public.todos t
    where t.source = 'restock'
      and not t.is_done
      and t.product_id is not null
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
      -- Top of the list: this is the only kind of to-do the app writes by
      -- itself, so it should be visible without scrolling. Matches
      -- useAddTodo(), which also prepends. row_number() keeps several
      -- products going low in the same run from landing on one position.
      coalesce(base.min_position, 0)
        - row_number() over (partition by v.household_id order by v.name)
    from public.v_inventory_totals v
    left join lateral (
      select min(t.position) as min_position
      from public.todos t
      where t.household_id = v.household_id
    ) base on true
    where v.is_low
    -- Inference, not `on constraint`: todos_restock_open_unique is a partial
    -- index, and ON CONFLICT can only target one by repeating its predicate.
    on conflict (household_id, product_id) where source = 'restock' and not is_done
    do nothing
    returning 1
  )
  select count(*) into v_created from created;

  return v_created + v_cleared;
end;
$$;

comment on function public.generate_restock_todos() is
  'Keeps one open to-do per product that has fallen to its restock threshold, and removes it again once stock recovers. Returns rows added plus rows cleared.';

-- Only the cron runs this, same as generate_due_recurring_expenses(): revoking
-- from PUBLIC drops the implicit EXECUTE that every function is created with,
-- so `authenticated` cannot reach it even though it is SECURITY DEFINER.
revoke all on function public.generate_restock_todos() from public;
grant execute on function public.generate_restock_todos() to service_role;

alter table public.system_heartbeat
  add column restock_todos_synced int not null default 0;
