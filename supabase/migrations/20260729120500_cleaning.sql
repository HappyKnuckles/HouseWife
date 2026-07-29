-- ============================================================================
-- 0006 · Putzplan — recurring cleaning schedule
-- ============================================================================

create table public.cleaning_areas (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  name         text        not null check (length(btrim(name)) between 1 and 60),
  icon         text        not null default 'home',
  color        text        not null default '#4F8DF7' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint cleaning_areas_id_household_key unique (id, household_id),
  constraint cleaning_areas_name_unique unique (household_id, name)
);

comment on table public.cleaning_areas is 'Rooms / zones: Bad, Küche, Wohnzimmer …';

-- ----------------------------------------------------------------------------
-- cleaning_tasks
--
-- Two fields carry most of the design weight:
--
-- schedule_mode
--   'fixed'            next due advances from the *scheduled* date. "Bad jeden
--                      Samstag" stays on Saturdays even if you clean on Sunday.
--   'after_completion' next due advances from the *completion* date. "Saugen
--                      alle 7 Tage" genuinely shifts when you do it late.
--   Supporting only one of these would be wrong about half of all real chores.
--
-- next_due_on
--   Materialised rather than computed on read. The hourly reminder cron and the
--   agenda screen both need "what is due" to be a single indexed comparison;
--   recomputing a recurrence rule for every task on every read would make both
--   slower and — worse — able to disagree with each other.
-- ----------------------------------------------------------------------------
create table public.cleaning_tasks (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid        not null references public.households (id) on delete cascade,
  area_id             uuid,
  name                text        not null check (length(btrim(name)) between 1 and 120),
  description         text,
  estimated_minutes   int         check (estimated_minutes between 1 and 600),

  recurrence_unit     text        not null default 'week'
                        check (recurrence_unit in ('day', 'week', 'month')),
  recurrence_interval int         not null default 1
                        check (recurrence_interval between 1 and 365),
  -- ISO weekday numbers, 1 = Montag … 7 = Sonntag. Only used when
  -- recurrence_unit = 'week' and the task should land on specific days.
  weekdays            smallint[],
  day_of_month        smallint    check (day_of_month between 1 and 31),
  schedule_mode       text        not null default 'after_completion'
                        check (schedule_mode in ('fixed', 'after_completion')),

  assignment_mode     text        not null default 'rotating'
                        check (assignment_mode in ('fixed', 'rotating')),
  -- Current responsible person; doubles as the rotation cursor.
  assigned_to         uuid,
  -- Ordered profile ids for assignment_mode = 'rotating'.
  rotation_order      uuid[]      not null default '{}',

  next_due_on         date        not null default current_date,
  last_completed_at   timestamptz,
  last_completed_by   uuid references public.profiles (id) on delete set null,

  reminder_enabled    boolean     not null default true,
  remind_days_before  smallint    not null default 0 check (remind_days_before between 0 and 14),

  is_active           boolean     not null default true,
  sort_order          int         not null default 0,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint cleaning_tasks_id_household_key unique (id, household_id),
  constraint cleaning_tasks_area_fkey foreign key (area_id, household_id)
    references public.cleaning_areas (id, household_id) on delete set null (area_id),
  constraint cleaning_tasks_assigned_fkey foreign key (assigned_to, household_id)
    references public.profiles (id, household_id) on delete set null (assigned_to),
  constraint cleaning_tasks_weekdays_valid
    check (weekdays is null or (weekdays <@ array[1,2,3,4,5,6,7]::smallint[])),
  -- A rotating task without a rotation list would silently never rotate.
  constraint cleaning_tasks_rotation_present
    check (assignment_mode <> 'rotating' or cardinality(rotation_order) > 0)
);

-- The exact index the hourly cron and the agenda screen both hit.
create index cleaning_tasks_due_idx
  on public.cleaning_tasks (household_id, is_active, next_due_on);
create index cleaning_tasks_area_idx on public.cleaning_tasks (area_id);

-- ----------------------------------------------------------------------------
-- Completion history. Also the undo buffer: the previous schedule state is
-- stored on the completion row, so undoing is an exact restore rather than a
-- recomputation that could land somewhere else.
-- ----------------------------------------------------------------------------
create table public.cleaning_completions (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid        not null,
  task_id               uuid        not null,
  completed_by          uuid,
  completed_at          timestamptz not null default now(),
  -- What the task was due for when it was completed — enables "3 Tage zu spät".
  due_on                date        not null,
  duration_minutes      int         check (duration_minutes between 1 and 600),
  note                  text,

  previous_next_due_on  date        not null,
  previous_assigned_to  uuid,

  created_at            timestamptz not null default now(),

  constraint cleaning_completions_task_fkey foreign key (task_id, household_id)
    references public.cleaning_tasks (id, household_id) on delete cascade,
  constraint cleaning_completions_by_fkey foreign key (completed_by, household_id)
    references public.profiles (id, household_id) on delete set null (completed_by)
);

create index cleaning_completions_task_idx
  on public.cleaning_completions (task_id, completed_at desc);
create index cleaning_completions_stats_idx
  on public.cleaning_completions (household_id, completed_at desc);

-- ----------------------------------------------------------------------------
-- The recurrence engine.
--
-- Lives in SQL — not in TypeScript — because two callers need it: the
-- complete_cleaning_task() RPC and the starter-data seeder. A second
-- implementation in the app would eventually disagree about what "next
-- Tuesday" means, and the disagreement would only show up as a missed
-- reminder weeks later.
-- ----------------------------------------------------------------------------
create or replace function public.cleaning_next_due(
  p_task public.cleaning_tasks,
  p_from date
)
returns date
language plpgsql
immutable
as $$
declare
  v_step   interval;
  v_anchor date;
  v_next   date;
  v_guard  int := 0;
  v_dim    int;
begin
  v_step := case p_task.recurrence_unit
              when 'day'   then make_interval(days   => p_task.recurrence_interval)
              when 'week'  then make_interval(weeks  => p_task.recurrence_interval)
              when 'month' then make_interval(months => p_task.recurrence_interval)
            end;

  -- Weekly tasks pinned to specific weekdays: walk forward to the next matching
  -- ISO weekday, then skip the remaining N-1 weeks for "every 2nd Saturday".
  if p_task.recurrence_unit = 'week'
     and p_task.weekdays is not null
     and cardinality(p_task.weekdays) > 0
  then
    v_next := p_from + 1;
    while v_guard < 7 loop
      exit when extract(isodow from v_next)::smallint = any (p_task.weekdays);
      v_next  := v_next + 1;
      v_guard := v_guard + 1;
    end loop;

    return (v_next + make_interval(weeks => p_task.recurrence_interval - 1))::date;
  end if;

  v_anchor := case
                when p_task.schedule_mode = 'after_completion' then p_from
                else coalesce(p_task.next_due_on, p_from)
              end;

  v_next := (v_anchor + v_step)::date;

  -- Monthly tasks pinned to a day of month, clamped for short months
  -- (day_of_month = 31 in February lands on the 28th/29th).
  if p_task.recurrence_unit = 'month' and p_task.day_of_month is not null then
    v_dim  := extract(day from (date_trunc('month', v_next::timestamp)
                                 + interval '1 month - 1 day'))::int;
    v_next := (date_trunc('month', v_next::timestamp)
                 + make_interval(days => least(p_task.day_of_month, v_dim) - 1))::date;
  end if;

  -- A 'fixed' task completed long after it was due must still land in the
  -- future, otherwise it would come back as overdue the moment it was ticked.
  v_guard := 0;
  while v_next <= p_from and v_guard < 400 loop
    v_next  := (v_next + v_step)::date;
    v_guard := v_guard + 1;
  end loop;

  return v_next;
end;
$$;

comment on function public.cleaning_next_due(public.cleaning_tasks, date) is
  'Next due date for a task, given the date it was completed / evaluated from.';

-- ----------------------------------------------------------------------------
create trigger cleaning_areas_set_updated_at
  before update on public.cleaning_areas
  for each row execute function public.set_updated_at();

create trigger cleaning_tasks_set_updated_at
  before update on public.cleaning_tasks
  for each row execute function public.set_updated_at();

select public.apply_household_rls('cleaning_areas');
select public.apply_household_rls('cleaning_tasks');
select public.apply_household_rls('cleaning_completions');
