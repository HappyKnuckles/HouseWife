-- ============================================================================
-- 0002 · Households, profiles, invites
-- ============================================================================
-- The household is the tenant boundary. Every other table in this schema
-- carries household_id so that a) every RLS policy is the same one-liner and
-- b) every realtime subscription can filter on a single indexed column.
-- ============================================================================

create table public.households (
  id                     uuid primary key default gen_random_uuid(),
  name                   text        not null check (length(btrim(name)) between 1 and 80),
  -- Reminder scheduling happens in the household's own local time, so the
  -- hourly cron never has to reason about UTC offsets or DST.
  timezone               text        not null default 'Europe/Berlin',
  currency               char(3)     not null default 'EUR',
  reminder_hour          smallint    not null default 18 check (reminder_hour between 0 and 23),
  -- When a cleaning task is overdue, notify both members, not just the one
  -- who is nominally responsible.
  notify_both_on_overdue boolean     not null default true,
  max_members            smallint    not null default 2 check (max_members between 1 and 20),
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.households is
  'One shared household. All data is scoped to exactly one of these.';

-- ----------------------------------------------------------------------------
-- profiles: 1:1 with auth.users, created automatically on signup.
-- household_id is nullable because a user exists between signing up and
-- creating/joining a household.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  household_id uuid references public.households (id) on delete set null,
  display_name text        not null default '',
  avatar_url   text,
  -- Used consistently across balances, rotation chips and the Putzplan avatars.
  color        text        not null default '#4F8DF7' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Referenced by the composite foreign keys of every person-valued column in
  -- the schema. This is what makes "assignee must be a member of the same
  -- household" a database guarantee rather than an application convention.
  constraint profiles_id_household_key unique (id, household_id)
);

create index profiles_household_id_idx on public.profiles (household_id);

alter table public.households
  add constraint households_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Invites: how the second member joins. Short human-typeable code, single use.
-- ----------------------------------------------------------------------------
create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  code         text        not null unique check (code ~ '^[A-Z0-9]{6}$'),
  created_by   uuid references public.profiles (id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_by  uuid references public.profiles (id) on delete set null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index household_invites_household_id_idx on public.household_invites (household_id);

-- Ambiguity-free alphabet: no I, O, 0 or 1 to survive being read aloud.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_attempt  int := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from public.household_invites where code = v_code);

    v_attempt := v_attempt + 1;
    if v_attempt > 50 then
      raise exception 'could not generate a unique invite code';
    end if;
  end loop;

  return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- Every signup gets a profile row, so the app never has to handle the
-- "logged in but no profile" state.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'Mitbewohner'), '@', 1)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
