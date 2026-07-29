-- ============================================================================
-- 0004 · Expense splitting
-- ============================================================================
-- Money is always bigint cents. Never float, never numeric — column names end
-- in _cents so a misread is impossible.
--
-- expense_shares is the single source of truth for "who owes whom". The split
-- *rule* (equal / custom shares / per item) is only an input; what balances are
-- computed from is always the materialised per-person cent amount. A deferred
-- constraint trigger guarantees those amounts sum to the expense total, so no
-- client bug — or old app version — can leave the ledger inconsistent.
-- ============================================================================

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  paid_by      uuid        not null,
  title        text        not null check (length(btrim(title)) between 1 and 120),
  note         text,
  category     text,
  total_cents  bigint      not null check (total_cents > 0),
  currency     char(3)     not null default 'EUR',
  purchased_at timestamptz not null default now(),
  split_type   text        not null default 'equal'
                 check (split_type in ('equal', 'shares', 'items')),
  status       text        not null default 'open'
                 check (status in ('open', 'settled')),
  settled_at   timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Target for the composite foreign keys of every child table below.
  constraint expenses_id_household_key unique (id, household_id),

  -- The payer must be a member of the same household. Enforced, not assumed.
  constraint expenses_paid_by_fkey foreign key (paid_by, household_id)
    references public.profiles (id, household_id) on delete restrict,

  -- status and settled_at can never disagree.
  constraint expenses_settled_consistent
    check ((status = 'settled') = (settled_at is not null))
);

create index expenses_household_status_idx  on public.expenses (household_id, status, purchased_at desc);
create index expenses_household_paid_by_idx on public.expenses (household_id, paid_by);

comment on column public.expenses.split_type is
  'How shares were derived. equal = 50/50, shares = custom ratios, items = summed from expense_items.';

-- ----------------------------------------------------------------------------
-- Optional itemisation. paid_for = NULL means "shared line, split equally";
-- setting it means that person alone owes the line. This is what drives
-- split_type = 'items'.
-- ----------------------------------------------------------------------------
create table public.expense_items (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid        not null,
  expense_id       uuid        not null,
  position         int         not null default 0,
  name             text        not null check (length(btrim(name)) between 1 and 160),
  quantity         numeric(10,3) not null default 1 check (quantity > 0),
  unit_price_cents bigint      check (unit_price_cents >= 0),
  total_cents      bigint      not null check (total_cents >= 0),
  paid_for         uuid,
  -- Distinguishes a hand-typed line from one an OCR provider produced, so the
  -- UI can flag low-confidence rows for review.
  source           text        not null default 'manual'
                     check (source in ('manual', 'ocr')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint expense_items_expense_fkey foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete cascade,
  constraint expense_items_paid_for_fkey foreign key (paid_for, household_id)
    references public.profiles (id, household_id) on delete set null (paid_for)
);

create index expense_items_expense_idx on public.expense_items (expense_id, position);

-- ----------------------------------------------------------------------------
-- The ledger.
-- ----------------------------------------------------------------------------
create table public.expense_shares (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null,
  expense_id   uuid        not null,
  profile_id   uuid        not null,
  share_cents  bigint      not null check (share_cents >= 0),
  -- Only meaningful for split_type = 'shares'; kept so the edit screen can
  -- restore the ratios the user actually typed.
  share_ratio  numeric(6,5) check (share_ratio >= 0 and share_ratio <= 1),
  created_at   timestamptz not null default now(),

  constraint expense_shares_unique unique (expense_id, profile_id),
  constraint expense_shares_expense_fkey foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete cascade,
  constraint expense_shares_profile_fkey foreign key (profile_id, household_id)
    references public.profiles (id, household_id) on delete restrict
);

create index expense_shares_profile_idx on public.expense_shares (household_id, profile_id);

-- ----------------------------------------------------------------------------
-- The invariant: shares always sum to the expense total.
--
-- Implemented as a DEFERRABLE INITIALLY DEFERRED constraint trigger so the app
-- can insert the expense and its shares in any order within one transaction —
-- the check only runs at COMMIT.
-- ----------------------------------------------------------------------------
create or replace function public.assert_expense_balanced(p_expense_id uuid)
returns void
language plpgsql
as $$
declare
  v_total bigint;
  v_sum   bigint;
begin
  select total_cents into v_total from public.expenses where id = p_expense_id;

  -- Expense was deleted in the same transaction; nothing left to balance.
  if v_total is null then
    return;
  end if;

  select coalesce(sum(share_cents), 0) into v_sum
  from public.expense_shares
  where expense_id = p_expense_id;

  if v_sum <> v_total then
    raise exception
      'expense % is unbalanced: shares sum to % cents, total is % cents',
      p_expense_id, v_sum, v_total
      using errcode = 'check_violation',
            hint = 'Write expense_shares rows for every member in the same transaction.';
  end if;
end;
$$;

create or replace function public.tg_assert_expense_balanced()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'expenses' then
    perform public.assert_expense_balanced(new.id);
  else
    perform public.assert_expense_balanced(coalesce(new.expense_id, old.expense_id));
  end if;
  return null;
end;
$$;

create constraint trigger expense_shares_balanced
  after insert or update or delete on public.expense_shares
  deferrable initially deferred
  for each row execute function public.tg_assert_expense_balanced();

-- Also fires when an expense is created without any shares at all, or when its
-- total is edited without the shares being recalculated.
create constraint trigger expenses_balanced
  after insert or update of total_cents on public.expenses
  deferrable initially deferred
  for each row execute function public.tg_assert_expense_balanced();

-- ----------------------------------------------------------------------------
-- Receipts. Binary lives in Supabase Storage; this table is the metadata plus
-- the OCR extension point.
--
-- storage_path MUST start with the household id — the storage.objects policies
-- authorise on the first path segment (see migration 0012).
-- ----------------------------------------------------------------------------
create table public.receipts (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid        not null,
  expense_id       uuid        not null,
  storage_path     text        not null unique,
  mime_type        text        not null default 'image/jpeg',
  size_bytes       bigint,
  width            int,
  height           int,
  uploaded_by      uuid references public.profiles (id) on delete set null,

  ocr_status       text        not null default 'pending'
                     check (ocr_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  ocr_provider     text,
  ocr_raw          jsonb,
  ocr_parsed       jsonb,
  ocr_error        text,
  ocr_completed_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint receipts_expense_fkey foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete cascade,
  constraint receipts_path_scoped
    check (storage_path like household_id::text || '/%')
);

create index receipts_expense_idx    on public.receipts (expense_id);
create index receipts_ocr_status_idx on public.receipts (ocr_status) where ocr_status = 'pending';

comment on column public.receipts.ocr_parsed is
  'ParsedReceipt JSON written by the ocr-receipt Edge Function. Shape is defined in src/features/expenses/ocr.ts.';

-- ----------------------------------------------------------------------------
-- Settlements. A settlement closes whole expenses rather than transferring an
-- arbitrary amount: that keeps the open balance exact by construction and
-- matches the open/settled status the UI shows.
-- ----------------------------------------------------------------------------
create table public.settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  from_profile uuid        not null,
  to_profile   uuid        not null,
  amount_cents bigint      not null check (amount_cents > 0),
  currency     char(3)     not null default 'EUR',
  method       text        not null default 'other'
                 check (method in ('cash', 'transfer', 'paypal', 'other')),
  note         text,
  settled_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint settlements_id_household_key unique (id, household_id),
  constraint settlements_from_fkey foreign key (from_profile, household_id)
    references public.profiles (id, household_id) on delete restrict,
  constraint settlements_to_fkey foreign key (to_profile, household_id)
    references public.profiles (id, household_id) on delete restrict,
  constraint settlements_distinct_parties check (from_profile <> to_profile)
);

create index settlements_household_idx on public.settlements (household_id, settled_at desc);

create table public.settlement_expenses (
  settlement_id uuid not null,
  expense_id    uuid not null,
  household_id  uuid not null,

  primary key (settlement_id, expense_id),
  constraint settlement_expenses_settlement_fkey foreign key (settlement_id, household_id)
    references public.settlements (id, household_id) on delete cascade,
  constraint settlement_expenses_expense_fkey foreign key (expense_id, household_id)
    references public.expenses (id, household_id) on delete cascade
);

create index settlement_expenses_expense_idx on public.settlement_expenses (expense_id);

-- ----------------------------------------------------------------------------
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create trigger expense_items_set_updated_at
  before update on public.expense_items
  for each row execute function public.set_updated_at();

create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

select public.apply_household_rls('expenses');
select public.apply_household_rls('expense_items');
select public.apply_household_rls('expense_shares');
select public.apply_household_rls('receipts');
select public.apply_household_rls('settlements');
select public.apply_household_rls('settlement_expenses');
