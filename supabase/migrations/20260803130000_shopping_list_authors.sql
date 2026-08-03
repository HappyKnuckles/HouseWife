-- ============================================================================
-- 0027 · The Einkaufsliste says what, and who put it there
-- ============================================================================
-- Two corrections to how a shopping entry reads.
--
-- 1. The generator writes "Mehl kaufen". That was right when the row landed on
--    the to-do list, where the verb was the whole point. On a list *called*
--    Einkaufsliste every line already means "kaufen", so the word is noise on
--    every row, and it is the word that pushes long product names into an
--    ellipsis. The title becomes the product name.
--
-- 2. `created_by` has never been written for a to-do. Nothing set it: the
--    client omits the column, the column has no default, and the only trigger
--    on the table stamps done_at/done_by. So "wer hat das aufgeschrieben" —
--    the question you actually have standing in the shop, holding a list with
--    "Käse" on it — was unanswerable.
--
--    Stamped in a trigger rather than sent by the client, for the same reason
--    done_by is (migration 0005): it must be true regardless of which client
--    wrote the row, and a client can lie about it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The label
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
      -- Just the name. The list is the verb.
      v.name,
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

revoke all on function public.sync_restock_todos(uuid) from public;
grant execute on function public.sync_restock_todos(uuid) to service_role;

-- Rows already on the list, including ticked-off ones: a list where half the
-- entries carry the old suffix reads like two different features.
update public.todos
   set title = regexp_replace(title, '\s+kaufen$', '')
 where source = 'restock'
   and title ~ '\s+kaufen$'
   -- A product genuinely called "kaufen" would be left with an empty title,
   -- which todos_title_check would reject. Vanishingly unlikely, but the
   -- backfill should not be the thing that fails the migration.
   and length(btrim(regexp_replace(title, '\s+kaufen$', ''))) > 0;

-- ----------------------------------------------------------------------------
-- 2. The author
--
-- A generated row is forced back to NULL rather than merely defaulted, because
-- the trigger that runs sync_restock_todos() fires inside *someone's*
-- transaction — whoever consumed the last of the flour — so auth.uid() is set
-- and would put that person's face on a row nobody wrote. See migration 0020.
-- ----------------------------------------------------------------------------
create or replace function public.tg_todos_stamp_author()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'manual' then
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_by := null;
  end if;

  return new;
end;
$$;

create trigger todos_stamp_author
  before insert on public.todos
  for each row execute function public.tg_todos_stamp_author();

comment on column public.todos.created_by is
  'Who wrote this line. NULL on generated restock rows — nobody did.';
