-- ============================================================================
-- 0028 · Die Einkaufsliste bekommt ein Gedächtnis
-- ============================================================================
-- Until now "Gekauftes löschen" was a DELETE, so the one thing a shopping list
-- knows that nothing else in the schema knows — what this household actually
-- buys, and how often — was thrown away every week. done_at and done_by were
-- already being stamped on every tick and deleted seconds later.
--
-- Three things here, all of them consequences of keeping those rows:
--
--   1. `cleared_at` — clearing the list stops meaning "destroy it". The row
--      leaves the screen; it stays in the table. Deleting a single row by hand
--      is still a hard delete, because that means "I never wanted this", which
--      is not a purchase and must not pollute the history.
--
--   2. `expense_id` — a finished shop can point at the expense it produced, so
--      "was hat der Wocheneinkauf gekostet" is answerable, and so the shopping
--      list and the Ausgaben half of the app stop being strangers.
--
--   3. v_shopping_suggestions — what to offer for one-tap re-adding, how long
--      ago it was last bought, how often it is normally bought, and what it
--      normally costs.
--
-- Deliberately NOT a separate history table. The row already exists, already
-- carries who/when/which product, and already has the right RLS; copying it
-- into `shopping_history` on tick would be a second source of truth that can
-- disagree with the first.
-- ============================================================================

alter table public.todos
  add column cleared_at timestamptz,
  add column expense_id uuid;

comment on column public.todos.cleared_at is
  'When this row was cleared off the screen. NULL = still on the list. Bought-ness is is_done/done_at; this is only visibility.';

comment on column public.todos.expense_id is
  'The expense this shopping row was billed into, if the shop was booked as one.';

-- Composite FK, like every other cross-table reference here: the expense must
-- belong to the same household, not merely exist. ON DELETE SET NULL because
-- deleting the expense must not take the purchase history with it.
alter table public.todos
  add constraint todos_expense_fkey foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete set null (expense_id);

-- Every list query now carries `cleared_at is null`, so it belongs in the index
-- that serves them. Partial, because the cleared rows are read by exactly one
-- query (the history) and it does not need this index at all.
drop index if exists todos_household_list_idx;
create index todos_household_list_idx
  on public.todos (household_id, list, is_done, position)
  where cleared_at is null;

create index todos_history_idx
  on public.todos (household_id, list, done_at desc)
  where is_done;

-- ----------------------------------------------------------------------------
-- v_shopping_suggestions
--
-- A FULL OUTER JOIN of two histories that answer different questions:
--
--   what you put on the list  (todos)         — covers everything, no prices
--   what you paid for         (expense_items) — has prices, only itemised bons
--
-- Either one alone would be half a memory: the list knows you buy Käse every
-- ten days but not that it costs 3,49 €, and the receipts know the price but
-- not the ones you bought without itemising. Joined on the same normalised
-- name the existing v_item_purchase_frequency already groups by.
--
-- The join key is lower(btrim(title)) rather than product_id, and that is
-- deliberate: since migration 0027 a generated row is titled with the bare
-- product name, so "Mehl" typed by hand and "Mehl" written by the restock
-- generator land on the same key by construction. product_id comes along for
-- the ride when there is one, which is what lets a suggestion be booked
-- straight back into the inventory.
-- ----------------------------------------------------------------------------
create or replace view public.v_shopping_suggestions with (security_invoker = true) as
with bought as (
  select
    t.household_id,
    lower(btrim(t.title))                                          as item_key,
    -- The most recent spelling wins the label, so a stray lowercase entry
    -- does not permanently rename the suggestion.
    (array_agg(t.title order by t.done_at desc))[1]                as name,
    (array_agg(t.product_id order by t.done_at desc)
       filter (where t.product_id is not null))[1]                 as product_id,
    count(*)::int                                                  as times_bought,
    max(t.done_at)                                                 as last_bought_at,
    -- Mean gap between the first and the last purchase. NULL until there are
    -- two, because one purchase says nothing about a rhythm.
    case
      when count(*) > 1
      then round(
        (extract(epoch from (max(t.done_at) - min(t.done_at)))::numeric
         / 86400.0
         / (count(*) - 1))
      , 1)
    end                                                            as avg_interval_days
  from public.todos t
  where t.list = 'shopping'
    and t.is_done
    and t.done_at is not null
  group by t.household_id, lower(btrim(t.title))
),
priced as (
  select
    e.household_id,
    lower(btrim(ei.name))                                          as item_key,
    (array_agg(ei.name order by e.purchased_at desc))[1]           as name,
    (array_agg(ei.total_cents order by e.purchased_at desc))[1]    as last_price_cents,
    (sum(ei.total_cents) / count(*))::bigint                       as avg_price_cents,
    max(e.purchased_at)                                            as last_paid_at,
    count(*)::int                                                  as times_paid
  from public.expense_items ei
  join public.expenses e on e.id = ei.expense_id
  group by e.household_id, lower(btrim(ei.name))
)
select
  coalesce(b.household_id, p.household_id)                         as household_id,
  coalesce(b.item_key, p.item_key)                                 as item_key,
  coalesce(b.name, p.name)                                         as name,
  b.product_id,
  coalesce(b.times_bought, 0)                                      as times_bought,
  b.last_bought_at,
  b.avg_interval_days,
  case
    when b.last_bought_at is not null
    then (current_date - b.last_bought_at::date)
  end                                                              as days_since_bought,
  -- "Fällig": bought often enough to have a rhythm, and the rhythm has
  -- elapsed. Three purchases rather than two, because two points make a line
  -- through anything.
  (
    b.times_bought >= 3
    and b.avg_interval_days is not null
    and b.avg_interval_days > 0
    and (current_date - b.last_bought_at::date) >= b.avg_interval_days
  )                                                                as is_due,
  p.last_price_cents,
  p.avg_price_cents,
  p.last_paid_at,
  coalesce(p.times_paid, 0)                                        as times_paid
from bought b
full outer join priced p
  on p.household_id = b.household_id
 and p.item_key     = b.item_key;

comment on view public.v_shopping_suggestions is
  'What this household buys: how often, how long ago, at what price. Union of ticked-off Einkaufsliste rows and itemised receipt lines, keyed on the normalised name.';

grant select on public.v_shopping_suggestions to authenticated;
