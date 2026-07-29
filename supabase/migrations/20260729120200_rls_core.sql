-- ============================================================================
-- 0003 · The RLS keystone + policies for the core tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Every policy in this schema resolves through this one function.
--
-- SECURITY DEFINER is load-bearing, not laziness: the function reads
-- public.profiles, and the RLS policy on public.profiles calls this function.
-- Without DEFINER (which bypasses RLS for the function body) that is infinite
-- recursion and Postgres errors out at query time. The blast radius is
-- deliberately tiny: one row, keyed by auth.uid(), no arguments.
-- ----------------------------------------------------------------------------
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select household_id from public.profiles where id = auth.uid()
$$;

comment on function public.current_household_id() is
  'The calling user''s household. Anchor of every RLS policy in this schema.';

revoke all on function public.current_household_id() from public;
grant execute on function public.current_household_id() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Policy generator for the ~15 plain household-scoped tables.
--
-- Every feature table is protected by the identical four policies, so they are
-- generated from one definition instead of being copy-pasted 60 times. The
-- payoff is that the tables which need *different* rules — profiles,
-- notification_log, product_lookup_cache, push_tokens — are hand-written and
-- therefore visibly special.
--
-- Inspect the result at any time with:  select * from pg_policies;
-- ----------------------------------------------------------------------------
create or replace function public.apply_household_rls(p_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format($f$
      create policy %I on public.%I for select to authenticated
        using (household_id = public.current_household_id())
    $f$, p_table || '_select', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_insert', p_table);
  execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (household_id = public.current_household_id())
    $f$, p_table || '_insert', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_update', p_table);
  execute format($f$
      create policy %I on public.%I for update to authenticated
        using (household_id = public.current_household_id())
        with check (household_id = public.current_household_id())
    $f$, p_table || '_update', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_delete', p_table);
  execute format($f$
      create policy %I on public.%I for delete to authenticated
        using (household_id = public.current_household_id())
    $f$, p_table || '_delete', p_table);

  execute format('revoke all on public.%I from anon', p_table);
  execute format('grant select, insert, update, delete on public.%I to authenticated', p_table);
end;
$$;

comment on function public.apply_household_rls(text) is
  'Applies the standard four household-scoped RLS policies and grants to a table.';

-- ----------------------------------------------------------------------------
-- households
-- ----------------------------------------------------------------------------
alter table public.households enable row level security;

create policy households_select on public.households
  for select to authenticated
  using (id = public.current_household_id());

create policy households_update on public.households
  for update to authenticated
  using (id = public.current_household_id())
  with check (id = public.current_household_id());

-- No INSERT or DELETE policy on purpose. Households are created exclusively
-- through public.create_household(), which also links the creator's profile in
-- the same transaction — otherwise a failed second step would leave an orphan
-- household that nobody can see or clean up.

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or household_id = public.current_household_id());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Column-level privileges close the hole the policy above cannot: the policy
-- lets you update your own row, and without this revoke that includes setting
-- household_id to any UUID you can guess — i.e. joining a stranger's
-- household. Membership changes are therefore only possible through the
-- SECURITY DEFINER functions create_household() and accept_invite().
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, color) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- household_invites
--
-- Read access is intentionally limited to invites of your *own* household, so
-- codes cannot be enumerated. Redeeming an invite you cannot see is handled by
-- accept_invite(), which is SECURITY DEFINER and rate-limited by the code
-- being unguessable (32^6 ≈ 1e9) and single-use.
-- ----------------------------------------------------------------------------
alter table public.household_invites enable row level security;

create policy household_invites_select on public.household_invites
  for select to authenticated
  using (household_id = public.current_household_id());

create policy household_invites_insert on public.household_invites
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy household_invites_delete on public.household_invites
  for delete to authenticated
  using (household_id = public.current_household_id());

-- ----------------------------------------------------------------------------
-- Table privileges. Supabase's default privileges already grant these; being
-- explicit keeps the dump self-contained and portable.
-- ----------------------------------------------------------------------------
revoke all on public.households, public.profiles, public.household_invites from anon;

grant select, update              on public.households        to authenticated;
grant select                      on public.profiles          to authenticated;
grant select, insert, delete      on public.household_invites to authenticated;
