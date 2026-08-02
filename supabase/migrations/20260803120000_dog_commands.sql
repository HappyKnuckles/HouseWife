-- ============================================================================
-- 0026 · Hundekommandos
-- ============================================================================
-- Two people training one dog have to use the *same* word for the same thing,
-- or the dog learns neither. So this is a shared glossary: the command, and
-- what the dog is supposed to do when it hears it — including the hand signal
-- and the reward, which is the part that actually differs between two humans
-- and that nobody writes down.
--
-- Shaped after house_rules (0019): the simplest table that works, hard deletes,
-- no soft-delete column to filter on in every query and every realtime handler.
-- Two differences, both deliberate:
--
--   * `description` is a real column rather than more text in the title. It is
--     what gets exported and what the dog-sitter reads, so it has to survive
--     being rendered on its own.
--   * No `position`. A rule list is a sequence you point at ("Regel 3"); a
--     glossary is a set you look things up in. Ordering by created_at keeps
--     "the ones we taught first" at the top for free, and nothing here depends
--     on a number staying attached to an entry.
-- ============================================================================

create table public.dog_commands (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  command      text        not null check (length(btrim(command)) between 1 and 80),
  description  text        check (description is null or length(description) <= 1000),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index dog_commands_household_idx on public.dog_commands (household_id, created_at);

create trigger dog_commands_set_updated_at
  before update on public.dog_commands
  for each row execute function public.set_updated_at();

select public.apply_household_rls('dog_commands');

-- ----------------------------------------------------------------------------
-- Realtime
--
-- REPLICA IDENTITY FULL is not optional: without it Postgres ships only the
-- primary key on DELETE, realtime has no row to evaluate the RLS policy
-- against and drops the event — so a command deleted on one phone would stay
-- on the other. See migration 0013.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dog_commands'
  ) then
    alter publication supabase_realtime add table public.dog_commands;
  end if;
end
$$;

alter table public.dog_commands replica identity full;

comment on table public.dog_commands is
  'The household''s shared dog vocabulary: one word per row, plus what it means. Exportable as text so the dog-sitter gets the same list.';
