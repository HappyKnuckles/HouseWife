-- ============================================================================
-- 0001 · Extensions, roles and shared helpers
-- ============================================================================
-- Everything in this file is idempotent and is a no-op on a real Supabase
-- project. The guarded blocks exist so the whole migration set can also be
-- applied to a plain PostgreSQL 15+ instance (psql -f) for local testing or if
-- the project ever moves off Supabase.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Roles. Supabase ships these; a vanilla Postgres does not.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Auth surface.
--
-- On Supabase the schema, the users table and auth.uid() all exist already and
-- NOTHING in this block runs. That is deliberate and the checks have to be
-- explicit: `create table if not exists auth.users` is NOT safe here, because
-- Postgres verifies CREATE permission on the schema *before* it evaluates
-- IF NOT EXISTS — and on Supabase the auth schema is owned by
-- supabase_auth_admin, so the statement fails with "permission denied for
-- schema auth" even though the table is right there.
--
-- Guarding on catalog lookups instead means no DDL is ever attempted against a
-- schema we do not own.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    execute 'create schema auth';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
  ) then
    execute $tbl$
      create table auth.users (
        id                 uuid primary key,
        email              text,
        raw_user_meta_data jsonb,
        created_at         timestamptz not null default now()
      );
    $tbl$;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $body$;
    $fn$;

    -- Only granted alongside the stub. On Supabase these privileges already
    -- exist and this block never runs, so the real auth schema is left alone.
    execute 'grant usage on schema auth to anon, authenticated, service_role';
    execute 'grant execute on function auth.uid() to anon, authenticated, service_role';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Shared trigger helper: keeps updated_at honest without the client having to
-- remember. Attached to every table that has the column.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at = now().';
