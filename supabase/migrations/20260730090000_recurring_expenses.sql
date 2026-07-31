-- ============================================================================
-- 0014 · Recurring (fixed) expenses
-- ============================================================================
-- Rent, Strom, insurance — costs that repeat on a schedule rather than being
-- entered by hand every month. A recurring_expenses row is a template; the
-- hourly household-tick cron (see supabase/functions/household-tick) turns a
-- due template into a *real* row in public.expenses on its due date, through
-- the same apply_expense_split() the manual create-expense flow uses. That is
-- deliberate: the generated expense is indistinguishable from one a person
-- typed in — same balance/settlement/stats treatment, no parallel "projected
-- spend" bookkeeping that could disagree with what's actually in the ledger.
--
-- Split is always 'equal'. apply_expense_split() also supports 'shares' and
-- 'items', but those need either a shares array or item lines at creation
-- time — inputs a template has no way to supply on its own. Equal covers
-- every real fixed cost this app's two-person household model has (rent,
-- utilities, subscriptions are normally split down the middle); custom-ratio
-- recurring costs can be added later if that turns out to be wrong.
-- ============================================================================

create table public.recurring_expenses (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid        not null references public.households (id) on delete cascade,
  name                      text        not null check (length(btrim(name)) between 1 and 120),
  category                  text,
  amount_cents              bigint      not null check (amount_cents > 0),
  currency                  char(3)     not null default 'EUR',
  paid_by                   uuid        not null,

  recurrence_unit           text        not null default 'month'
                               check (recurrence_unit in ('week', 'month')),
  recurrence_interval       int         not null default 1
                               check (recurrence_interval between 1 and 60),
  -- Month only. Clamped for short months the same way cleaning_next_due()
  -- clamps day_of_month, so "Miete am 31." lands on the 28th/29th in February
  -- rather than erroring.
  day_of_month              smallint    check (day_of_month between 1 and 31),

  next_due_on               date        not null default current_date,
  last_generated_expense_id uuid references public.expenses (id) on delete set null,

  is_active                 boolean     not null default true,
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint recurring_expenses_id_household_key unique (id, household_id),
  constraint recurring_expenses_paid_by_fkey foreign key (paid_by, household_id)
    references public.profiles (id, household_id) on delete restrict,
  constraint recurring_expenses_day_of_month_monthly_only
    check (day_of_month is null or recurrence_unit = 'month')
);

-- The exact index generate_due_recurring_expenses() hits.
create index recurring_expenses_due_idx
  on public.recurring_expenses (household_id, is_active, next_due_on);

comment on table public.recurring_expenses is
  'Templates for fixed costs (rent, Strom, subscriptions). Materialised into real expenses rows by the hourly cron — see generate_due_recurring_expenses().';

create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

select public.apply_household_rls('recurring_expenses');

-- ----------------------------------------------------------------------------
-- Next due date. A trimmed cleaning_next_due(): only 'week'/'month', no
-- weekday-array pinning (a fixed cost has one due day, not a set of them),
-- and no schedule_mode — fixed costs always advance from the *scheduled*
-- date, the way schedule_mode = 'fixed' cleaning tasks do. A bill you forgot
-- to look at for two months should not compress the next two occurrences
-- into next week; it should just show up as (still) due.
-- ----------------------------------------------------------------------------
create or replace function public.recurring_expense_next_due(
  p_row public.recurring_expenses
)
returns date
language plpgsql
immutable
as $$
declare
  v_step  interval;
  v_next  date;
  v_dim   int;
  v_guard int := 0;
begin
  v_step := case p_row.recurrence_unit
              when 'week'  then make_interval(weeks  => p_row.recurrence_interval)
              when 'month' then make_interval(months => p_row.recurrence_interval)
            end;

  v_next := (p_row.next_due_on + v_step)::date;

  if p_row.recurrence_unit = 'month' and p_row.day_of_month is not null then
    v_dim  := extract(day from (date_trunc('month', v_next::timestamp)
                                 + interval '1 month - 1 day'))::int;
    v_next := (date_trunc('month', v_next::timestamp)
                 + make_interval(days => least(p_row.day_of_month, v_dim) - 1))::date;
  end if;

  -- Guards against a due date that, after clamping, didn't actually move
  -- forward (possible right at a month boundary) — never loop forever.
  while v_next <= p_row.next_due_on and v_guard < 60 loop
    v_next  := (v_next + v_step)::date;
    v_guard := v_guard + 1;
  end loop;

  return v_next;
end;
$$;

comment on function public.recurring_expense_next_due(public.recurring_expenses) is
  'Next due date for a recurring expense template, advanced from its own scheduled date.';

-- ----------------------------------------------------------------------------
-- The generator. SECURITY DEFINER and parameterless: called from
-- household-tick via the service role, which has no auth.uid() — there is no
-- "calling user" for a system-generated bill, so this intentionally does not
-- go through current_household_id() the way the user-facing RPCs do. It scans
-- every household's due templates in one call.
-- ----------------------------------------------------------------------------
create or replace function public.generate_due_recurring_expenses()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       public.recurring_expenses;
  v_expense   public.expenses;
  v_generated int := 0;
begin
  for v_row in
    select * from public.recurring_expenses
    where is_active and next_due_on <= current_date
    order by next_due_on
    -- A template stuck due for a long time (household inactive for months)
    -- only ever produces the *next* occurrence per run, not a backlog — the
    -- loop below still catches up its next_due_on so it does not fall further
    -- behind, it just doesn't flood the ledger with months of missed bills.
    for update
  loop
    insert into public.expenses (
      household_id, paid_by, title, category, total_cents,
      currency, purchased_at, split_type, created_by
    )
    values (
      v_row.household_id, v_row.paid_by, v_row.name, v_row.category, v_row.amount_cents,
      v_row.currency, v_row.next_due_on::timestamptz, 'equal', v_row.created_by
    )
    returning * into v_expense;

    perform public.apply_expense_split(v_expense.id);

    update public.recurring_expenses
       set next_due_on               = public.recurring_expense_next_due(v_row),
           last_generated_expense_id = v_expense.id
     where id = v_row.id;

    v_generated := v_generated + 1;
  end loop;

  return v_generated;
end;
$$;

comment on function public.generate_due_recurring_expenses() is
  'Materialises every due recurring_expenses template into a real expenses row. Called hourly by household-tick.';

revoke all on function public.generate_due_recurring_expenses() from public;
grant execute on function public.generate_due_recurring_expenses() to service_role;

-- ----------------------------------------------------------------------------
-- Read model: spend per category per month, for the stats screen. Mirrors
-- v_cleaning_stats's shape (household, grouping key, month, aggregates).
-- ----------------------------------------------------------------------------
create view public.v_expense_category_month with (security_invoker = true) as
select
  e.household_id,
  coalesce(e.category, 'Sonstiges')         as category,
  date_trunc('month', e.purchased_at)::date as month,
  count(*)::int                             as expense_count,
  sum(e.total_cents)::bigint                as total_cents
from public.expenses e
group by e.household_id, coalesce(e.category, 'Sonstiges'), date_trunc('month', e.purchased_at);

comment on view public.v_expense_category_month is
  'Spend per category per month, across both open and settled expenses.';

-- ----------------------------------------------------------------------------
-- Read model: "how often do we buy this". Grouped on normalised item name
-- since expense_items.name is free text — different casing/whitespace for
-- the same product should still count as one line, exact spelling variants
-- (Milch vs. Vollmilch) deliberately do not merge, that would need real
-- product matching this table has no way to do.
-- ----------------------------------------------------------------------------
create view public.v_item_purchase_frequency with (security_invoker = true) as
select
  e.household_id,
  lower(btrim(ei.name))    as item_name,
  count(*)::int            as purchase_count,
  sum(ei.total_cents)::bigint as total_cents,
  max(e.purchased_at)      as last_purchased_at
from public.expense_items ei
join public.expenses e on e.id = ei.expense_id
group by e.household_id, lower(btrim(ei.name));

comment on view public.v_item_purchase_frequency is
  'How often each item name shows up across all itemised expenses, for the "was kaufen wir oft" stat.';

grant select on
  public.v_expense_category_month,
  public.v_item_purchase_frequency
to authenticated;

-- ----------------------------------------------------------------------------
-- household-tick reports how many bills it materialised this run, right next
-- to notifications_sent — same observability story, same table.
-- ----------------------------------------------------------------------------
alter table public.system_heartbeat
  add column recurring_expenses_generated int not null default 0;

-- ----------------------------------------------------------------------------
-- Realtime. See 20260729121200_realtime.sql for why both of these lines are
-- needed — that migration already ran, so a new table has to register itself.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'recurring_expenses'
  ) then
    alter publication supabase_realtime add table public.recurring_expenses;
  end if;

  alter table public.recurring_expenses replica identity full;
end
$$;
