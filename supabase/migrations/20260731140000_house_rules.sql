-- ============================================================================
-- 0019 · Hausregeln
-- ============================================================================
-- The things you agree on once and then forget: Schuhe aus, Spülmaschine
-- ausräumen wer zuerst aufsteht, Müll raus am Dienstag. A numbered list both
-- of you can point at.
--
-- Shaped after `todos` — the simplest table that works, hard deletes, no
-- soft-delete column to filter on in every query and every realtime handler.
-- The one difference is ordering: a to-do list is a set, a rule list is a
-- sequence ("Regel 3"), so `position` is load-bearing here rather than a
-- convenience.
-- ============================================================================

create table public.house_rules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  text         text        not null check (length(btrim(text)) between 1 and 500),
  -- Fractional index, like todos.position: moving one rule writes one row
  -- instead of renumbering the whole list.
  position     numeric     not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index house_rules_household_idx on public.house_rules (household_id, position);

create trigger house_rules_set_updated_at
  before update on public.house_rules
  for each row execute function public.set_updated_at();

select public.apply_household_rls('house_rules');

-- ----------------------------------------------------------------------------
-- Reordering
--
-- Two rows change, so this is an RPC: PostgREST runs one statement per
-- request, and a client doing two updates could leave the list half-swapped
-- if the second one fails. Not SECURITY DEFINER — it runs as the caller, so
-- RLS makes a rule from another household simply not exist.
-- ----------------------------------------------------------------------------
create or replace function public.house_rules_move(
  p_rule_id   uuid,
  p_direction text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rule  public.house_rules;
  v_other public.house_rules;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'direction must be up or down' using errcode = 'check_violation';
  end if;

  select * into v_rule from public.house_rules where id = p_rule_id;
  if not found then
    raise exception 'rule not found' using errcode = 'no_data_found';
  end if;

  -- Compared as a row rather than on position alone: two phones adding in the
  -- same second can produce equal positions, and created_at is what the list
  -- is actually sorted by after that. Comparing the pair finds the true
  -- neighbour in either case.
  if p_direction = 'up' then
    select * into v_other
    from public.house_rules
    where household_id = v_rule.household_id
      and (position, created_at) < (v_rule.position, v_rule.created_at)
    order by position desc, created_at desc
    limit 1;
  else
    select * into v_other
    from public.house_rules
    where household_id = v_rule.household_id
      and (position, created_at) > (v_rule.position, v_rule.created_at)
    order by position asc, created_at asc
    limit 1;
  end if;

  -- Already first or last.
  if not found then
    return;
  end if;

  if v_other.position = v_rule.position then
    -- Tied on position, so swapping them would be a no-op. Step off the tie
    -- instead; positions are numeric, nothing has to be renumbered.
    update public.house_rules
       set position = v_rule.position + case when p_direction = 'up' then -1 else 1 end
     where id = v_rule.id;
  else
    update public.house_rules set position = v_other.position where id = v_rule.id;
    update public.house_rules set position = v_rule.position  where id = v_other.id;
  end if;
end;
$$;

comment on function public.house_rules_move(uuid, text) is
  'Swaps a rule with its neighbour in one transaction.';

revoke all on function public.house_rules_move(uuid, text) from public;
grant execute on function public.house_rules_move(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime
--
-- REPLICA IDENTITY FULL is not optional: without it Postgres ships only the
-- primary key for DELETE, realtime has no row to check the RLS policy against
-- and drops the event, and a rule deleted on one phone stays on the other.
-- See migration 0013.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'house_rules'
  ) then
    alter publication supabase_realtime add table public.house_rules;
  end if;
end
$$;

alter table public.house_rules replica identity full;

comment on table public.house_rules is
  'Household ground rules, ordered by a fractional position index.';
