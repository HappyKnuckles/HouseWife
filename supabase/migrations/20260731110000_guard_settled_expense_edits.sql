-- ============================================================================
-- 0016 · A settled expense cannot be edited
-- ============================================================================
-- update_expense() happily rewrote the total of an already-settled expense.
-- Nothing crashed, which is the problem: v_household_balances only counts
-- status = 'open', so the edit moved no balance at all, while the settlements
-- row went on claiming a transfer that no longer matches the expenses behind
-- it. The user sees "I corrected the amount and nothing happened", and the
-- history quietly stops adding up.
--
-- Raising is the honest answer. Correcting a settled expense means undoing
-- the settlement first — which is a deliberate act, not a side effect of
-- fixing a typo.
--
-- Enforced here rather than only in the UI for the same reason every other
-- invariant in this schema is: an old app version on the other phone is not
-- something the database should trust.
-- ============================================================================

create or replace function public.update_expense(
  p_expense_id   uuid,
  p_title        text        default null,
  p_total_cents  bigint      default null,
  p_paid_by      uuid        default null,
  p_split_type   text        default null,
  p_purchased_at timestamptz default null,
  p_note         text        default null,
  p_category     text        default null,
  p_items        jsonb       default '[]'::jsonb,
  p_shares       jsonb       default null
)
returns public.expenses
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses;
begin
  -- RLS makes this return nothing for an expense outside the household.
  select * into v_expense from public.expenses where id = p_expense_id;

  if not found then
    raise exception 'expense not found' using errcode = 'no_data_found';
  end if;

  if v_expense.status = 'settled' then
    raise exception 'a settled expense cannot be edited'
      using errcode = 'check_violation',
            hint = 'Undo the settlement first, then edit.';
  end if;

  update public.expenses
     set title        = coalesce(btrim(p_title), title),
         total_cents  = coalesce(p_total_cents, total_cents),
         paid_by      = coalesce(p_paid_by, paid_by),
         split_type   = coalesce(p_split_type, split_type),
         purchased_at = coalesce(p_purchased_at, purchased_at),
         note         = p_note,
         category     = p_category
   where id = p_expense_id
  returning * into v_expense;

  perform public.apply_expense_split(p_expense_id, p_items, p_shares);

  return v_expense;
end;
$$;
