-- ============================================================================
-- 0011 · RPCs
-- ============================================================================
-- Anything that changes more than one row at a time lives here rather than in
-- the client. Two reasons: atomicity (a half-applied settlement or a rotation
-- that advanced without recording the completion would corrupt the ledger),
-- and realtime (one transaction = one coherent burst of events on the other
-- phone instead of a visible multi-step animation).
--
-- Almost all of these are SECURITY INVOKER, so RLS still applies inside them —
-- defence in depth. The three that must be DEFINER are the membership
-- functions, and each one re-checks membership by hand.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Membership
-- ----------------------------------------------------------------------------
create or replace function public.create_household(
  p_name     text,
  p_timezone text default 'Europe/Berlin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me        uuid := auth.uid();
  v_household uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if public.current_household_id() is not null then
    raise exception 'you already belong to a household' using errcode = 'unique_violation';
  end if;

  insert into public.households (name, timezone, created_by)
  values (btrim(p_name), coalesce(nullif(btrim(p_timezone), ''), 'Europe/Berlin'), v_me)
  returning id into v_household;

  update public.profiles set household_id = v_household where id = v_me;

  perform public.seed_starter_data(v_household);

  return v_household;
end;
$$;

create or replace function public.create_invite()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := public.current_household_id();
  v_code      text;
begin
  if v_household is null then
    raise exception 'you do not belong to a household' using errcode = 'insufficient_privilege';
  end if;

  -- Invites are single-use; drop any outstanding ones so only one code is live.
  delete from public.household_invites
   where household_id = v_household and accepted_at is null;

  v_code := public.generate_invite_code();

  insert into public.household_invites (household_id, code, created_by)
  values (v_household, v_code, auth.uid());

  return v_code;
end;
$$;

create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_invite public.household_invites;
  v_count  int;
  v_max    smallint;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if public.current_household_id() is not null then
    raise exception 'you already belong to a household' using errcode = 'unique_violation';
  end if;

  select * into v_invite
  from public.household_invites
  where code = upper(btrim(p_code))
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invalid or expired invite code' using errcode = 'no_data_found';
  end if;

  select count(*), max(h.max_members) into v_count, v_max
  from public.profiles p
  join public.households h on h.id = v_invite.household_id
  where p.household_id = v_invite.household_id;

  if v_count >= v_max then
    raise exception 'household is full' using errcode = 'check_violation';
  end if;

  update public.profiles set household_id = v_invite.household_id where id = v_me;

  update public.household_invites
     set accepted_at = now(), accepted_by = v_me
   where id = v_invite.id;

  -- Join every rotating chore, otherwise the new member would never come up in
  -- the rotation and the Putzplan would quietly stay a one-person job.
  update public.cleaning_tasks
     set rotation_order = rotation_order || v_me
   where household_id    = v_invite.household_id
     and assignment_mode = 'rotating'
     and not (v_me = any (rotation_order));

  return v_invite.household_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Expenses
-- ----------------------------------------------------------------------------
-- Expenses are created through these functions rather than by inserting rows,
-- and that is a hard requirement, not a style preference: expense_shares must
-- balance against expenses.total_cents at COMMIT, and PostgREST gives the
-- client one statement per request — so an insert of the expense followed by an
-- insert of its shares can never be one transaction and would always fail.
-- One RPC = one transaction = one coherent realtime burst.
--
-- Rounding rule for odd cents: the remainder goes to the payer first, then by
-- profile id. 40.01 € split 50/50 makes the payer's share 20.01 €. Deterministic,
-- reproducible, and the shares always sum to the total exactly.
create or replace function public.apply_expense_split(
  p_expense_id uuid,
  p_items      jsonb default '[]'::jsonb,
  p_shares     jsonb default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_expense  public.expenses;
  v_members  uuid[];
  v_n        int;
  v_shared   bigint;
  v_base     bigint;
  v_rem      bigint;
  v_assigned bigint;
  v_share    bigint;
  v_sum      bigint;
  i          int;
begin
  select * into v_expense from public.expenses where id = p_expense_id;
  if not found then
    raise exception 'expense not found' using errcode = 'no_data_found';
  end if;

  delete from public.expense_items  where expense_id = p_expense_id;
  delete from public.expense_shares where expense_id = p_expense_id;

  insert into public.expense_items (
    household_id, expense_id, position, name, quantity,
    unit_price_cents, total_cents, paid_for, source
  )
  select
    v_expense.household_id,
    p_expense_id,
    coalesce((l ->> 'position')::int, (ord - 1)::int),
    l ->> 'name',
    coalesce((l ->> 'quantity')::numeric, 1),
    nullif(l ->> 'unit_price_cents', '')::bigint,
    (l ->> 'total_cents')::bigint,
    nullif(l ->> 'paid_for', '')::uuid,
    coalesce(nullif(l ->> 'source', ''), 'manual')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(l, ord);

  -- Payer first so odd cents land on them.
  select array_agg(id order by (id <> v_expense.paid_by), id)
    into v_members
  from public.profiles
  where household_id = v_expense.household_id;

  v_n := coalesce(cardinality(v_members), 0);
  if v_n = 0 then
    raise exception 'household has no members' using errcode = 'no_data_found';
  end if;

  if v_expense.split_type = 'shares' then
    if p_shares is null or jsonb_array_length(p_shares) = 0 then
      raise exception 'split_type = shares requires an explicit shares array'
        using errcode = 'invalid_parameter_value';
    end if;

    select coalesce(sum((s ->> 'share_cents')::bigint), 0) into v_sum
    from jsonb_array_elements(p_shares) s;

    if v_sum <> v_expense.total_cents then
      raise exception 'custom shares sum to % cents but the total is % cents',
        v_sum, v_expense.total_cents using errcode = 'check_violation';
    end if;

    insert into public.expense_shares (household_id, expense_id, profile_id, share_cents, share_ratio)
    select
      v_expense.household_id,
      p_expense_id,
      (s ->> 'profile_id')::uuid,
      (s ->> 'share_cents')::bigint,
      round((s ->> 'share_cents')::numeric / v_expense.total_cents, 5)
    from jsonb_array_elements(p_shares) s;

    return;
  end if;

  -- 'equal' splits the whole total; 'items' splits only what no one was
  -- explicitly assigned — which conveniently also absorbs deposit, tips or any
  -- rounding between the line items and the receipt total.
  if v_expense.split_type = 'items' then
    select coalesce(sum((l ->> 'total_cents')::bigint), 0) into v_assigned
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) l
    where nullif(l ->> 'paid_for', '') is not null;

    if v_assigned > v_expense.total_cents then
      raise exception 'assigned line items (% cents) exceed the expense total (% cents)',
        v_assigned, v_expense.total_cents using errcode = 'check_violation';
    end if;

    v_shared := v_expense.total_cents - v_assigned;
  else
    v_shared := v_expense.total_cents;
  end if;

  v_base := v_shared / v_n;
  v_rem  := v_shared - (v_base * v_n);

  for i in 1 .. v_n loop
    v_share := v_base + case when i <= v_rem then 1 else 0 end;

    if v_expense.split_type = 'items' then
      v_share := v_share + coalesce((
        select sum((l ->> 'total_cents')::bigint)
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) l
        where nullif(l ->> 'paid_for', '')::uuid = v_members[i]
      ), 0);
    end if;

    insert into public.expense_shares (household_id, expense_id, profile_id, share_cents, share_ratio)
    values (
      v_expense.household_id, p_expense_id, v_members[i], v_share,
      round(v_share::numeric / v_expense.total_cents, 5)
    );
  end loop;
end;
$$;

create or replace function public.create_expense(
  p_title        text,
  p_total_cents  bigint,
  p_paid_by      uuid        default null,
  p_split_type   text        default 'equal',
  p_purchased_at timestamptz default now(),
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
  v_household uuid := public.current_household_id();
  v_expense   public.expenses;
begin
  if v_household is null then
    raise exception 'you do not belong to a household' using errcode = 'insufficient_privilege';
  end if;

  insert into public.expenses (
    household_id, paid_by, title, note, category,
    total_cents, purchased_at, split_type, created_by
  )
  values (
    v_household, coalesce(p_paid_by, auth.uid()), btrim(p_title), p_note, p_category,
    p_total_cents, coalesce(p_purchased_at, now()), coalesce(p_split_type, 'equal'), auth.uid()
  )
  returning * into v_expense;

  perform public.apply_expense_split(v_expense.id, p_items, p_shares);

  return v_expense;
end;
$$;

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

  if not found then
    raise exception 'expense not found' using errcode = 'no_data_found';
  end if;

  perform public.apply_expense_split(p_expense_id, p_items, p_shares);

  return v_expense;
end;
$$;

-- Closes whole expenses and records what was actually transferred. Passing an
-- empty array settles everything currently open.
create or replace function public.settle_up(
  p_expense_ids uuid[] default null,
  p_method      text   default 'other',
  p_note        text   default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household  uuid := public.current_household_id();
  v_me         uuid := auth.uid();
  v_other      uuid;
  v_ids        uuid[] := p_expense_ids;
  v_paid       bigint;
  v_owed       bigint;
  v_net        bigint;
  v_settlement uuid;
begin
  if v_household is null then
    raise exception 'you do not belong to a household' using errcode = 'insufficient_privilege';
  end if;

  if v_ids is null or cardinality(v_ids) = 0 then
    select array_agg(id) into v_ids
    from public.expenses
    where household_id = v_household and status = 'open';
  end if;

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'nothing to settle' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(e.total_cents) filter (where e.paid_by = v_me), 0)
    into v_paid
  from public.expenses e
  where e.id = any (v_ids) and e.household_id = v_household and e.status = 'open';

  select coalesce(sum(s.share_cents), 0)
    into v_owed
  from public.expense_shares s
  join public.expenses e on e.id = s.expense_id
  where s.expense_id = any (v_ids)
    and s.profile_id = v_me
    and e.status     = 'open';

  v_net := v_paid - v_owed;

  select id into v_other
  from public.profiles
  where household_id = v_household and id <> v_me
  limit 1;

  -- A net of exactly zero is a real outcome (everyone paid their own share);
  -- close the expenses without inventing a 0 € transfer.
  if v_net <> 0 then
    if v_other is null then
      raise exception 'no second household member to settle with'
        using errcode = 'no_data_found';
    end if;

    insert into public.settlements
      (household_id, from_profile, to_profile, amount_cents, method, note, created_by)
    values (
      v_household,
      case when v_net > 0 then v_other else v_me end,
      case when v_net > 0 then v_me    else v_other end,
      abs(v_net),
      coalesce(p_method, 'other'),
      p_note,
      v_me
    )
    returning id into v_settlement;

    insert into public.settlement_expenses (settlement_id, expense_id, household_id)
    select v_settlement, e.id, v_household
    from public.expenses e
    where e.id = any (v_ids) and e.household_id = v_household and e.status = 'open';
  end if;

  update public.expenses
     set status = 'settled', settled_at = now()
   where id = any (v_ids) and household_id = v_household and status = 'open';

  return v_settlement;
end;
$$;

-- ----------------------------------------------------------------------------
-- Putzplan
-- ----------------------------------------------------------------------------
create or replace function public.complete_cleaning_task(
  p_task_id          uuid,
  p_completed_at     timestamptz default now(),
  p_duration_minutes int         default null,
  p_note             text        default null
)
returns public.cleaning_tasks
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_task     public.cleaning_tasks;
  v_tz       text;
  v_today    date;
  v_next     date;
  v_assignee uuid;
  v_idx      int;
begin
  -- RLS makes this return nothing for a task outside the household.
  select * into v_task from public.cleaning_tasks where id = p_task_id;
  if not found then
    raise exception 'cleaning task not found' using errcode = 'no_data_found';
  end if;

  select timezone into v_tz from public.households where id = v_task.household_id;
  v_today := (p_completed_at at time zone coalesce(v_tz, 'Europe/Berlin'))::date;

  insert into public.cleaning_completions (
    household_id, task_id, completed_by, completed_at, due_on,
    duration_minutes, note, previous_next_due_on, previous_assigned_to
  )
  values (
    v_task.household_id, v_task.id, auth.uid(), p_completed_at, v_task.next_due_on,
    p_duration_minutes, p_note, v_task.next_due_on, v_task.assigned_to
  );

  v_next := public.cleaning_next_due(v_task, v_today);

  v_assignee := v_task.assigned_to;
  if v_task.assignment_mode = 'rotating' and cardinality(v_task.rotation_order) > 0 then
    -- array_position returns NULL when the current assignee is not in the list
    -- (or is NULL); coalescing to 0 makes the rotation start at the first entry.
    v_idx      := coalesce(array_position(v_task.rotation_order, v_task.assigned_to), 0);
    v_assignee := v_task.rotation_order[(v_idx % cardinality(v_task.rotation_order)) + 1];
  end if;

  update public.cleaning_tasks
     set next_due_on       = v_next,
         assigned_to       = v_assignee,
         last_completed_at = p_completed_at,
         last_completed_by = auth.uid()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

-- Exact restore rather than a recomputation: the completion row carries the
-- schedule state it replaced, so undo always lands back where you were.
create or replace function public.undo_cleaning_completion(p_completion_id uuid)
returns public.cleaning_tasks
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_completion public.cleaning_completions;
  v_task       public.cleaning_tasks;
  v_prev       public.cleaning_completions;
begin
  select * into v_completion from public.cleaning_completions where id = p_completion_id;
  if not found then
    raise exception 'completion not found' using errcode = 'no_data_found';
  end if;

  delete from public.cleaning_completions where id = p_completion_id;

  select * into v_prev
  from public.cleaning_completions
  where task_id = v_completion.task_id
  order by completed_at desc
  limit 1;

  update public.cleaning_tasks
     set next_due_on       = v_completion.previous_next_due_on,
         assigned_to       = v_completion.previous_assigned_to,
         last_completed_at = v_prev.completed_at,
         last_completed_by = v_prev.completed_by
   where id = v_completion.task_id
  returning * into v_task;

  return v_task;
end;
$$;

-- ----------------------------------------------------------------------------
-- Inventory
-- ----------------------------------------------------------------------------
-- The scan → lookup → store flow, server side: find or create the catalog
-- entry for this barcode, then add to the right stock lot, then log it.
create or replace function public.inventory_scan_in(
  p_barcode           text        default null,
  p_name              text        default null,
  p_location_id       uuid        default null,
  p_quantity          numeric     default 1,
  p_unit              text        default 'piece',
  p_expires_on        date        default null,
  p_brand             text        default null,
  p_image_url         text        default null,
  p_external_provider text        default null,
  p_external_payload  jsonb       default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household  uuid := public.current_household_id();
  v_product_id uuid;
  v_item       public.inventory_items;
begin
  if v_household is null then
    raise exception 'you do not belong to a household' using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = 'check_violation';
  end if;

  if p_barcode is not null then
    select id into v_product_id
    from public.products
    where household_id = v_household and barcode = p_barcode;
  end if;

  if v_product_id is null then
    insert into public.products (
      household_id, barcode, name, brand, unit, image_url,
      default_location_id, source, external_provider, external_payload, created_by
    )
    values (
      v_household,
      p_barcode,
      coalesce(nullif(btrim(p_name), ''), 'Unbenannt ' || coalesce(p_barcode, '')),
      p_brand,
      coalesce(p_unit, 'piece'),
      p_image_url,
      p_location_id,
      case when p_external_provider is not null then 'external'
           when p_barcode is not null          then 'scan'
           else 'manual' end,
      p_external_provider,
      p_external_payload,
      auth.uid()
    )
    returning id into v_product_id;
  end if;

  -- One stock row per product / location / expiry lot. Written as an explicit
  -- lookup instead of ON CONFLICT because the uniqueness involves NULLs, and
  -- IS NOT DISTINCT FROM says what is meant far more plainly than relying on
  -- NULLS NOT DISTINCT index inference.
  select * into v_item
  from public.inventory_items
  where household_id = v_household
    and product_id   = v_product_id
    and location_id  is not distinct from p_location_id
    and expires_on   is not distinct from p_expires_on;

  if found then
    update public.inventory_items
       set quantity = quantity + p_quantity
     where id = v_item.id
    returning * into v_item;
  else
    insert into public.inventory_items (
      household_id, product_id, location_id, quantity, unit, expires_on, created_by
    )
    values (
      v_household, v_product_id, p_location_id, p_quantity,
      coalesce(p_unit, 'piece'), p_expires_on, auth.uid()
    )
    returning * into v_item;
  end if;

  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason, to_location_id, created_by
  )
  values (v_household, v_item.id, v_product_id, p_quantity, 'scan_in', p_location_id, auth.uid());

  return v_item;
end;
$$;

create or replace function public.inventory_adjust(
  p_item_id uuid,
  p_delta   numeric,
  p_reason  text default 'manual_adjust',
  p_note    text default null
)
returns public.inventory_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items;
begin
  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'inventory item not found' using errcode = 'no_data_found';
  end if;

  -- Clamp at zero rather than raising: "we ran out" is the normal case, and a
  -- failed decrement in the UI is more annoying than a floor.
  update public.inventory_items
     set quantity = greatest(0, quantity + p_delta)
   where id = p_item_id
  returning * into v_item;

  insert into public.inventory_movements (
    household_id, item_id, product_id, delta, reason, note, created_by
  )
  values (v_item.household_id, v_item.id, v_item.product_id, p_delta,
          coalesce(p_reason, 'manual_adjust'), p_note, auth.uid());

  return v_item;
end;
$$;

-- ----------------------------------------------------------------------------
revoke all on function
  public.create_household(text, text),
  public.create_invite(),
  public.accept_invite(text),
  public.apply_expense_split(uuid, jsonb, jsonb),
  public.create_expense(text, bigint, uuid, text, timestamptz, text, text, jsonb, jsonb),
  public.update_expense(uuid, text, bigint, uuid, text, timestamptz, text, text, jsonb, jsonb),
  public.settle_up(uuid[], text, text),
  public.complete_cleaning_task(uuid, timestamptz, int, text),
  public.undo_cleaning_completion(uuid),
  public.inventory_scan_in(text, text, uuid, numeric, text, date, text, text, text, jsonb),
  public.inventory_adjust(uuid, numeric, text, text),
  public.seed_starter_data(uuid)
from public;

grant execute on function
  public.create_household(text, text),
  public.create_invite(),
  public.accept_invite(text),
  public.apply_expense_split(uuid, jsonb, jsonb),
  public.create_expense(text, bigint, uuid, text, timestamptz, text, text, jsonb, jsonb),
  public.update_expense(uuid, text, bigint, uuid, text, timestamptz, text, text, jsonb, jsonb),
  public.settle_up(uuid[], text, text),
  public.complete_cleaning_task(uuid, timestamptz, int, text),
  public.undo_cleaning_completion(uuid),
  public.inventory_scan_in(text, text, uuid, numeric, text, date, text, text, text, jsonb),
  public.inventory_adjust(uuid, numeric, text, text),
  public.seed_starter_data(uuid)
to authenticated;
