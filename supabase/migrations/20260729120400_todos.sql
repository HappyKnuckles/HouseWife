-- ============================================================================
-- 0005 · Shared to-do list
-- ============================================================================
-- Deliberately the simplest table in the schema. Hard delete rather than a
-- deleted_at column: undo is a client-side snackbar, and a soft-delete column
-- would mean every query and every realtime handler has to filter on it.
-- ============================================================================

create table public.todos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  title        text        not null check (length(btrim(title)) between 1 and 200),
  notes        text,
  assignee_id  uuid,
  due_date     date,
  is_done      boolean     not null default false,
  done_at      timestamptz,
  done_by      uuid references public.profiles (id) on delete set null,
  -- Fractional index: reordering writes one row instead of renumbering the list.
  position     numeric     not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- NULL assignee means "whoever gets to it first". MATCH SIMPLE semantics make
  -- the composite key check pass when assignee_id is NULL, which is exactly
  -- what we want.
  constraint todos_assignee_fkey foreign key (assignee_id, household_id)
    references public.profiles (id, household_id) on delete set null (assignee_id),

  constraint todos_done_consistent check ((is_done) = (done_at is not null))
);

create index todos_household_open_idx on public.todos (household_id, is_done, position);

-- Keeps is_done / done_at / done_by consistent no matter which client writes,
-- so the checkbox can be a single-column optimistic update.
create or replace function public.tg_todos_stamp_done()
returns trigger
language plpgsql
as $$
begin
  -- OLD is unassigned on INSERT, so tg_op has to be checked before touching it.
  if new.is_done and (tg_op = 'INSERT' or not old.is_done) then
    new.done_at := coalesce(new.done_at, now());
    new.done_by := coalesce(new.done_by, auth.uid());
  elsif not new.is_done then
    new.done_at := null;
    new.done_by := null;
  end if;

  return new;
end;
$$;

create trigger todos_stamp_done
  before insert or update on public.todos
  for each row execute function public.tg_todos_stamp_done();

create trigger todos_set_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();

select public.apply_household_rls('todos');
