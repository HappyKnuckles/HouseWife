-- ============================================================================
-- Schedule household-tick
-- ============================================================================
-- Run this ONCE after deploying the function. It is safe to re-run.
--   npx supabase db query --linked -f supabase/cron/schedule.sql
-- or paste it into the Dashboard SQL editor.
--
-- It is not a migration because it embeds project-specific values.
--
-- The secret below must equal what you passed to
-- `supabase secrets set CRON_SECRET=…` byte for byte. No surrounding double
-- quotes, no trailing space: the function compares the header with !==, so a
-- stray character means every hourly run gets a silent 401 and nothing else
-- in the system tells you why. Verify with system_heartbeat, never with
-- cron.job_run_details — see the bottom of this file.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret lives in Vault rather than in the job definition, so that reading
-- cron.job does not hand it over.
--
-- The obvious way to do that is `alter database postgres set app.cron_secret`,
-- which is what this file used to do — but a custom GUC is only a placeholder
-- until an extension claims the prefix, and Postgres requires superuser to set
-- a placeholder at database level. Supabase's `postgres` role owns the
-- database but is not a superuser, so that statement fails with
--   42501: permission denied to set parameter "app.cron_secret"
-- Vault is installed on every Supabase project, encrypts at rest, and is
-- readable by `postgres` — which is the role pg_cron runs the job as, since
-- jobs run as whoever scheduled them. Same goal, privileges we actually have.
do $vault$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'cron_secret';

  if v_id is null then
    perform vault.create_secret(
      '<CRON_SECRET>',
      'cron_secret',
      'x-cron-secret header for the household-tick function'
    );
  else
    -- Re-running after a rotation must replace the value; create_secret would
    -- fail on the unique name instead.
    perform vault.update_secret(v_id, '<CRON_SECRET>');
  end if;
end
$vault$;

-- Re-running this file should replace the job, not add a second one.
select cron.unschedule('household-tick')
where exists (select 1 from cron.job where jobname = 'household-tick');

select cron.schedule(
  'household-tick',
  '0 * * * *',              -- hourly, on the hour
  $$
  select net.http_post(
    url     := 'https://mkpvteezfkmvwpknhugb.supabase.co/functions/v1/household-tick',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', current_setting('app.cron_secret', true)
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- ----------------------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------------------
-- The job exists:
--   select jobname, schedule, active from cron.job;
--
-- It has been running (pg_cron's own log):
--   select status, start_time, return_message
--   from cron.job_run_details
--   where jobname = 'household-tick'
--   order by start_time desc limit 10;
--
-- The function actually did something (our log — this is the keep-alive proof):
--   select ran_at, households_scanned, tasks_due, notifications_sent,
--          duration_ms, error
--   from public.system_heartbeat
--   order by ran_at desc limit 24;
--
-- If the newest row in system_heartbeat is older than ~2 hours, reminders are
-- not firing AND the project is drifting towards a free-tier pause.
