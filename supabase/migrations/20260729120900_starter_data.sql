-- ============================================================================
-- 0010 · Starter data for a fresh household
-- ============================================================================
-- Called by create_household(). A brand-new Putzplan that is completely empty
-- is a worse first impression than one you have to edit, so a new household
-- gets a plausible German default schedule and a few storage locations.
-- Everything here is ordinary user data and can be deleted in the app.
-- ============================================================================

create or replace function public.seed_starter_data(p_household_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_me       uuid := auth.uid();
  v_kueche   uuid;
  v_bad      uuid;
  v_wohnen   uuid;
  v_schlafen uuid;
  v_flur     uuid;
begin
  -- Explicit membership check: this function is reached through a SECURITY
  -- DEFINER caller, where RLS would not stop a hostile household_id.
  if p_household_id is distinct from public.current_household_id() then
    raise exception 'not a member of household %', p_household_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent: never seed a household that already has a Putzplan.
  if exists (select 1 from public.cleaning_tasks where household_id = p_household_id) then
    return;
  end if;

  insert into public.cleaning_areas (household_id, name, icon, color, sort_order)
  values
    (p_household_id, 'Küche',        'restaurant',  '#F2994A', 1),
    (p_household_id, 'Bad',          'water',       '#56CCF2', 2),
    (p_household_id, 'Wohnzimmer',   'tv',          '#6FCF97', 3),
    (p_household_id, 'Schlafzimmer', 'bed',         '#BB6BD9', 4),
    (p_household_id, 'Flur',         'walk',        '#828282', 5);

  select id into v_kueche   from public.cleaning_areas where household_id = p_household_id and name = 'Küche';
  select id into v_bad      from public.cleaning_areas where household_id = p_household_id and name = 'Bad';
  select id into v_wohnen   from public.cleaning_areas where household_id = p_household_id and name = 'Wohnzimmer';
  select id into v_schlafen from public.cleaning_areas where household_id = p_household_id and name = 'Schlafzimmer';
  select id into v_flur     from public.cleaning_areas where household_id = p_household_id and name = 'Flur';

  insert into public.cleaning_tasks (
    household_id, area_id, name, estimated_minutes,
    recurrence_unit, recurrence_interval, weekdays, day_of_month,
    schedule_mode, assignment_mode, assigned_to, rotation_order,
    next_due_on, sort_order, created_by
  )
  values
    -- Fixed weekday chores: these belong to a day, not to an interval.
    (p_household_id, v_bad,      'Bad putzen',            30, 'week',  1, array[6]::smallint[], null,
     'fixed',            'rotating', v_me, array[v_me], current_date, 1, v_me),
    (p_household_id, v_kueche,   'Küche wischen',         20, 'week',  1, array[7]::smallint[], null,
     'fixed',            'rotating', v_me, array[v_me], current_date, 2, v_me),
    (p_household_id, v_flur,     'Müll rausbringen',       5, 'week',  1, array[2]::smallint[], null,
     'fixed',            'rotating', v_me, array[v_me], current_date, 3, v_me),

    -- Interval chores: doing them late genuinely moves the next one.
    (p_household_id, v_wohnen,   'Staubsaugen',           25, 'day',   4, null, null,
     'after_completion', 'rotating', v_me, array[v_me], current_date, 4, v_me),
    (p_household_id, v_kueche,   'Spülmaschine ausräumen', 5, 'day',   1, null, null,
     'after_completion', 'rotating', v_me, array[v_me], current_date, 5, v_me),
    (p_household_id, v_schlafen, 'Bettwäsche wechseln',   15, 'week',  2, null, null,
     'after_completion', 'rotating', v_me, array[v_me], current_date, 6, v_me),
    (p_household_id, v_wohnen,   'Staub wischen',         20, 'week',  2, null, null,
     'after_completion', 'rotating', v_me, array[v_me], current_date, 7, v_me),

    -- Monthly, pinned to the 1st.
    (p_household_id, v_bad,      'Fenster putzen',        45, 'month', 1, null, 1::smallint,
     'fixed',            'rotating', v_me, array[v_me], current_date, 8, v_me);

  -- Interval tasks legitimately start "due today". Calendar-pinned ones must
  -- not: a Saturday task created on a Tuesday should say Saturday, not today.
  update public.cleaning_tasks t
     set next_due_on = calc.next_due
    from (
      select ct.id, public.cleaning_next_due(ct, current_date - 1) as next_due
      from public.cleaning_tasks ct
      where ct.household_id = p_household_id
        and (ct.weekdays is not null or ct.day_of_month is not null)
    ) calc
   where t.id = calc.id;

  insert into public.storage_locations (household_id, name, kind, sort_order)
  values
    (p_household_id, 'Küche',   'room', 1),
    (p_household_id, 'Keller',  'room', 2),
    (p_household_id, 'Bad',     'room', 3),
    (p_household_id, 'Abstellkammer', 'room', 4);

  insert into public.storage_locations (household_id, parent_id, name, kind, sort_order)
  select p_household_id, l.id, 'Vorratsschrank', 'cabinet', 1
  from public.storage_locations l
  where l.household_id = p_household_id and l.name = 'Küche';

  insert into public.storage_locations (household_id, parent_id, name, kind, sort_order)
  select p_household_id, l.id, 'Kühlschrank', 'fridge', 2
  from public.storage_locations l
  where l.household_id = p_household_id and l.name = 'Küche';
end;
$$;

comment on function public.seed_starter_data(uuid) is
  'Populates a new household with a default Putzplan and storage locations. Idempotent.';
