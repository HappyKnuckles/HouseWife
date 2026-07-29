-- ============================================================================
-- 0009 · Read models
-- ============================================================================
-- Every view is declared WITH (security_invoker = true). Without that flag a
-- view executes with the *owner's* privileges, which in Postgres means it
-- quietly bypasses the RLS policies of its base tables — a view would become a
-- hole straight through the household boundary.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Who owes whom. Only expenses with status = 'open' count; settling closes
-- expenses, which removes them from this view by construction.
--
-- The two nets always sum to zero, so the UI reads one row:
--   net_cents > 0  →  this person is owed money.
-- ----------------------------------------------------------------------------
create view public.v_household_balances with (security_invoker = true) as
select
  p.household_id,
  p.id                                                        as profile_id,
  p.display_name,
  p.color,
  coalesce(paid.cents, 0)::bigint                             as paid_cents,
  coalesce(owed.cents, 0)::bigint                             as owed_cents,
  (coalesce(paid.cents, 0) - coalesce(owed.cents, 0))::bigint as net_cents
from public.profiles p
left join lateral (
  select sum(e.total_cents) as cents
  from public.expenses e
  where e.paid_by      = p.id
    and e.household_id = p.household_id
    and e.status       = 'open'
) paid on true
left join lateral (
  select sum(s.share_cents) as cents
  from public.expense_shares s
  join public.expenses e on e.id = s.expense_id
  where s.profile_id   = p.id
    and s.household_id = p.household_id
    and e.status       = 'open'
) owed on true
where p.household_id is not null;

-- ----------------------------------------------------------------------------
-- The Putzplan agenda. "Today" is resolved in the household's own timezone, so
-- a task due Monday does not turn red at 01:00 Monday for someone in Berlin
-- just because the server thinks in UTC.
-- ----------------------------------------------------------------------------
create view public.v_cleaning_agenda with (security_invoker = true) as
select
  t.id,
  t.household_id,
  t.name,
  t.description,
  t.area_id,
  a.name                                as area_name,
  a.color                               as area_color,
  a.icon                                as area_icon,
  t.estimated_minutes,
  t.recurrence_unit,
  t.recurrence_interval,
  t.weekdays,
  t.day_of_month,
  t.schedule_mode,
  t.assignment_mode,
  t.assigned_to,
  asg.display_name                      as assignee_name,
  asg.color                             as assignee_color,
  t.rotation_order,
  t.next_due_on,
  t.last_completed_at,
  t.last_completed_by,
  t.reminder_enabled,
  t.remind_days_before,
  t.is_active,
  t.sort_order,
  (t.next_due_on - (now() at time zone h.timezone)::date) as days_until,
  case
    when t.next_due_on <  (now() at time zone h.timezone)::date     then 'overdue'
    when t.next_due_on =  (now() at time zone h.timezone)::date     then 'due_today'
    when t.next_due_on <= (now() at time zone h.timezone)::date + 2 then 'due_soon'
    else                                                                 'upcoming'
  end                                   as status
from public.cleaning_tasks t
join public.households h  on h.id  = t.household_id
left join public.cleaning_areas a on a.id = t.area_id
left join public.profiles asg     on asg.id = t.assigned_to;

-- ----------------------------------------------------------------------------
-- Fairness stats: who actually did how much, per month.
-- ----------------------------------------------------------------------------
create view public.v_cleaning_stats with (security_invoker = true) as
select
  c.household_id,
  c.completed_by                                  as profile_id,
  p.display_name,
  p.color,
  date_trunc('month', c.completed_at)::date       as month,
  count(*)::int                                   as completions,
  coalesce(sum(c.duration_minutes), 0)::int       as minutes,
  count(*) filter (where c.completed_at::date > c.due_on)::int as late_completions
from public.cleaning_completions c
join public.profiles p on p.id = c.completed_by
group by c.household_id, c.completed_by, p.display_name, p.color, date_trunc('month', c.completed_at);

-- ----------------------------------------------------------------------------
-- "Keller › Regal 2 › Kiste A" for the location picker.
-- The CYCLE clause makes a mis-parented location a filtered-out row instead of
-- an infinite loop.
-- ----------------------------------------------------------------------------
create view public.v_location_paths with (security_invoker = true) as
with recursive tree as (
  select
    l.id, l.household_id, l.parent_id, l.name, l.kind, l.sort_order,
    l.name::text as path,
    1            as depth
  from public.storage_locations l
  where l.parent_id is null

  union all

  select
    c.id, c.household_id, c.parent_id, c.name, c.kind, c.sort_order,
    t.path || ' › ' || c.name,
    t.depth + 1
  from public.storage_locations c
  join tree t on t.id = c.parent_id
) cycle id set is_cycle using cycle_path
select id, household_id, parent_id, name, kind, sort_order, path, depth
from tree
where not is_cycle;

-- ----------------------------------------------------------------------------
-- "Haben wir noch Kaffee?" — totals across every location, plus the low-stock
-- flag the inventory screen sorts by.
-- ----------------------------------------------------------------------------
create view public.v_inventory_totals with (security_invoker = true) as
select
  pr.household_id,
  pr.id                                             as product_id,
  pr.name,
  pr.brand,
  pr.barcode,
  pr.category,
  pr.image_url,
  pr.unit,
  coalesce(sum(i.quantity), 0)::numeric(12,3)       as total_quantity,
  count(i.id) filter (where i.quantity > 0)::int    as location_count,
  min(i.expires_on)                                 as next_expiry,
  bool_or(i.min_quantity is not null and i.quantity <= i.min_quantity) as is_low
from public.products pr
left join public.inventory_items i on i.product_id = pr.id
group by pr.household_id, pr.id, pr.name, pr.brand, pr.barcode, pr.category, pr.image_url, pr.unit;

-- ----------------------------------------------------------------------------
grant select on
  public.v_household_balances,
  public.v_cleaning_agenda,
  public.v_cleaning_stats,
  public.v_location_paths,
  public.v_inventory_totals
to authenticated;
