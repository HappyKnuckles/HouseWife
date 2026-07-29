-- ============================================================================
-- 0013 · Realtime
-- ============================================================================
-- Two things are needed for a table to sync live, and the second one is the
-- one everybody forgets:
--
--   1. membership in the supabase_realtime publication
--   2. REPLICA IDENTITY FULL
--
-- Without (2), Postgres only ships the primary key for DELETE events. Realtime
-- then has no row to evaluate the RLS policy against, so it drops the event
-- entirely — deleting a to-do would simply never disappear on the other phone.
-- It looks like a client bug and it is not one.
--
-- FULL also means UPDATE events carry the old row, which is what lets the
-- client patch its cache instead of refetching.
-- ============================================================================

do $$
declare
  v_tables constant text[] := array[
    -- expenses
    'expenses', 'expense_items', 'expense_shares', 'receipts',
    'settlements', 'settlement_expenses',
    -- todos
    'todos',
    -- putzplan
    'cleaning_areas', 'cleaning_tasks', 'cleaning_completions',
    -- inventory
    'storage_locations', 'products', 'inventory_items',
    -- household
    'profiles', 'households'
  ];
  v_table text;
begin
  -- Supabase creates this publication for us; a plain Postgres does not.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;

  foreach v_table in array v_tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;

    execute format('alter table public.%I replica identity full', v_table);
  end loop;
end
$$;

-- inventory_movements, notification_log and system_heartbeat are deliberately
-- NOT published: they are append-only logs that no screen subscribes to, and
-- streaming them would just burn realtime quota.
