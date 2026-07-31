-- ============================================================================
-- 0023 · Termine, Jahrestage, Geburtstage
-- ============================================================================
-- "Wann kommt Marie nochmal vorbei?" and "seit wann sind wir eigentlich
-- zusammen?" are the same shape of question — a named date with a place and a
-- note — so they are one table with a `kind` rather than three.
--
-- Dates, not timestamps. Every scheduled thing in this schema (cleaning_tasks
-- .next_due_on, recurring_expenses.next_due_on, notification_log.due_on) is a
-- household-local date, because the reminder cron compares against the
-- household's own local day and never does UTC arithmetic. A timestamptz here
-- would be the one exception and would have to be converted back at every
-- comparison. Time of day is a separate, optional column: it is display only,
-- reminders fire on the day.
-- ============================================================================

create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid        not null references public.households (id) on delete cascade,
  kind               text        not null default 'event'
                       check (kind in ('event', 'anniversary', 'birthday')),
  title              text        not null check (length(btrim(title)) between 1 and 200),
  description        text,
  place              text,
  starts_on          date        not null,
  /** NULL = ganztägig. Display only; reminders fire on the day. */
  starts_at          time,
  /** NULL = a single day. */
  ends_on            date,
  repeat_yearly      boolean     not null default false,
  remind_days_before int         not null default 1 check (remind_days_before between 0 and 30),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Needed by notification_log's composite FK below: the reminder row must
  -- belong to the same household as the event, not merely to some event.
  constraint events_id_household_key unique (id, household_id),

  constraint events_range_ok check (ends_on is null or ends_on >= starts_on),
  -- A Jahrestag that does not come back every year is not a Jahrestag.
  constraint events_yearly_kinds check (
    kind = 'event' or repeat_yearly
  )
);

create index events_household_date_idx on public.events (household_id, starts_on);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

select public.apply_household_rls('events');

-- ----------------------------------------------------------------------------
-- event_next_occurrence()
--
-- For a one-off this is just the date. For a yearly one it is this year's
-- instance, or next year's once this year's has passed.
-- ----------------------------------------------------------------------------
create or replace function public.event_next_occurrence(
  p_starts_on     date,
  p_repeat_yearly boolean,
  p_today         date
)
returns date
language plpgsql
immutable
as $$
declare
  v_year  int;
  v_month int := extract(month from p_starts_on)::int;
  v_day   int := extract(day   from p_starts_on)::int;
  v_next  date;
begin
  -- 29 February exists in one year out of four, so the day is clamped to the
  -- length of the target month. That is what calendars do and what people mean
  -- by "same day next year".
  if not p_repeat_yearly or p_starts_on > p_today then
    return p_starts_on;
  end if;

  v_year := extract(year from p_today)::int;
  v_next := make_date(v_year, v_month, 1)
            + (least(
                 v_day,
                 extract(day from (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::int
               ) - 1);

  if v_next < p_today then
    v_year := v_year + 1;
    v_next := make_date(v_year, v_month, 1)
              + (least(
                   v_day,
                   extract(day from (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::int
                 ) - 1);
  end if;

  return v_next;
end;
$$;

-- ----------------------------------------------------------------------------
-- v_event_agenda — the shape every events screen wants
--
-- days_since_start is what "seit X Tagen zusammen" reads off; `years` is the
-- ordinal of the upcoming occurrence, so a wedding in 2019 shows its 7th
-- Jahrestag in 2026.
-- ----------------------------------------------------------------------------
create or replace view public.v_event_agenda with (security_invoker = true) as
select
  e.id,
  e.household_id,
  e.kind,
  e.title,
  e.description,
  e.place,
  e.starts_on,
  e.starts_at,
  e.ends_on,
  e.repeat_yearly,
  e.remind_days_before,
  e.created_by,
  n.next_on,
  (n.next_on - current_date)::int                                as days_until,
  case
    when e.repeat_yearly
    then (extract(year from n.next_on) - extract(year from e.starts_on))::int
  end                                                            as years,
  greatest((current_date - e.starts_on)::int, 0)                 as days_since_start
from public.events e
cross join lateral (
  select public.event_next_occurrence(e.starts_on, e.repeat_yearly, current_date) as next_on
) n;

grant select on public.v_event_agenda to authenticated;

-- ----------------------------------------------------------------------------
-- Reminders reuse notification_log, exactly like the restock nudges did.
--
-- The dedupe index is non-partial for the same reason as the restock one: an
-- event row has task_id and product_id NULL, so under the default
-- NULLS DISTINCT it only ever constrains event rows — and it stays usable as
-- a PostgREST on_conflict target, which a partial index would not be.
-- ----------------------------------------------------------------------------
alter table public.notification_log
  add column event_id uuid,
  add constraint notification_log_event_fkey
    foreign key (event_id, household_id)
    references public.events (id, household_id) on delete cascade;

alter table public.notification_log
  drop constraint notification_log_kind_check;

alter table public.notification_log
  add constraint notification_log_kind_check
    check (kind in ('due', 'overdue', 'digest', 'restock', 'event'));

create unique index notification_log_event_dedupe
  on public.notification_log (event_id, profile_id, kind, due_on);

alter table public.system_heartbeat
  add column event_notifications_sent int not null default 0;

-- ----------------------------------------------------------------------------
-- Realtime. REPLICA IDENTITY FULL or a deleted event never disappears on the
-- other phone — see migration 0013.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end
$$;

alter table public.events replica identity full;
