-- ============================================================================
-- 0008 · Push tokens, notification log, cron heartbeat
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Per *device*, not per user: you will have a phone and probably a tablet, and
-- a token that Expo reports as dead must be prunable without touching the
-- user's session.
-- ----------------------------------------------------------------------------
create table public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  profile_id   uuid        not null references public.profiles (id) on delete cascade,
  token        text        not null unique check (token like 'ExponentPushToken[%'),
  platform     text        not null check (platform in ('ios', 'android')),
  device_name  text,
  last_seen_at timestamptz not null default now(),
  -- Set by household-tick when Expo reports DeviceNotRegistered.
  disabled_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index push_tokens_active_idx
  on public.push_tokens (profile_id)
  where disabled_at is null;

alter table public.push_tokens enable row level security;

-- You may only ever see and manage your own devices, even inside the household.
create policy push_tokens_select on public.push_tokens
  for select to authenticated using (profile_id = auth.uid());

create policy push_tokens_insert on public.push_tokens
  for insert to authenticated
  with check (profile_id = auth.uid() and household_id = public.current_household_id());

create policy push_tokens_update on public.push_tokens
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy push_tokens_delete on public.push_tokens
  for delete to authenticated using (profile_id = auth.uid());

-- ----------------------------------------------------------------------------
-- notification_log
--
-- The UNIQUE index below is the entire anti-spam mechanism. household-tick
-- inserts here with ON CONFLICT DO NOTHING *before* sending, and only pushes
-- for rows that actually inserted. The cron can therefore run every hour,
-- crash halfway through a batch, or be re-triggered by hand, and you still get
-- exactly one "Bad putzen" per task per due date per person.
-- ----------------------------------------------------------------------------
create table public.notification_log (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid        not null references public.households (id) on delete cascade,
  task_id              uuid,
  profile_id           uuid        not null references public.profiles (id) on delete cascade,
  kind                 text        not null check (kind in ('due', 'overdue', 'digest')),
  due_on               date        not null,
  title                text,
  body                 text,
  sent_at              timestamptz not null default now(),
  expo_ticket_id       text,
  expo_receipt_status  text        check (expo_receipt_status in ('ok', 'error')),
  error                text,

  constraint notification_log_task_fkey foreign key (task_id, household_id)
    references public.cleaning_tasks (id, household_id) on delete cascade
);

create unique index notification_log_dedupe
  on public.notification_log (task_id, profile_id, kind, due_on);

create index notification_log_receipts_idx
  on public.notification_log (sent_at)
  where expo_ticket_id is not null and expo_receipt_status is null;

alter table public.notification_log enable row level security;

-- Readable so the app can show "Erinnerung gesendet"; only the service role
-- (household-tick) ever writes.
create policy notification_log_select on public.notification_log
  for select to authenticated
  using (household_id = public.current_household_id());

-- ----------------------------------------------------------------------------
-- push_receipts
--
-- Expo accepts a push immediately (a "ticket") and only tells you whether the
-- device actually got it minutes later (a "receipt"). One notification_log row
-- can fan out to several devices, so tickets live in their own table keyed by
-- ticket id and pointing at the token that produced them. That is what lets
-- household-tick disable a dead token instead of pushing to it forever.
-- ----------------------------------------------------------------------------
create table public.push_receipts (
  ticket_id       text primary key,
  notification_id uuid references public.notification_log (id) on delete cascade,
  token_id        uuid references public.push_tokens (id) on delete cascade,
  status          text check (status in ('ok', 'error')),
  error_code      text,
  created_at      timestamptz not null default now(),
  checked_at      timestamptz
);

create index push_receipts_pending_idx
  on public.push_receipts (created_at)
  where checked_at is null;

-- Service role only: nothing in the app reads or writes this.
alter table public.push_receipts enable row level security;

-- ----------------------------------------------------------------------------
-- system_heartbeat
--
-- Written on every household-tick run. Two jobs:
--   1. keep-alive — a row written through PostgREST is unambiguous project
--      activity, which is what stops a free-tier project pausing after 7 days.
--   2. observability — one query tells you whether the scheduler has been
--      alive all week, and how long each run took.
-- ----------------------------------------------------------------------------
create table public.system_heartbeat (
  id                 bigint generated always as identity primary key,
  ran_at             timestamptz not null default now(),
  run_kind           text        not null default 'cron'
                       check (run_kind in ('cron', 'manual', 'keepalive')),
  households_scanned int         not null default 0,
  tasks_due          int         not null default 0,
  notifications_sent int         not null default 0,
  duration_ms        int,
  error              text
);

create index system_heartbeat_ran_at_idx on public.system_heartbeat (ran_at desc);

alter table public.system_heartbeat enable row level security;

create policy system_heartbeat_select on public.system_heartbeat
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
create trigger push_tokens_set_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

revoke all on public.push_tokens, public.notification_log, public.system_heartbeat from anon;
grant select, insert, update, delete on public.push_tokens      to authenticated;
grant select                        on public.notification_log  to authenticated;
grant select                        on public.system_heartbeat  to authenticated;
