-- ============================================================================
-- Schedule household-tick
-- ============================================================================
-- Run this ONCE in the Supabase SQL editor after deploying the function.
-- It is not a migration because it embeds project-specific values.
--
-- Replace:
--   <PROJECT_REF>  your project ref (Settings → General)
--   <CRON_SECRET>  the same value you passed to `supabase secrets set CRON_SECRET=…`
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Storing the secret as a database setting keeps it out of the job definition
-- that shows up in cron.job for anyone reading the table.
alter database postgres set app.cron_secret = '"das_ist_aber_doof" ';

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
