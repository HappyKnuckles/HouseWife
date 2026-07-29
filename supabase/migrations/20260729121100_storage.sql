-- ============================================================================
-- 0012 · Storage bucket for receipts
-- ============================================================================
-- The only Supabase-specific file in this migration set besides the auth
-- references. If the project ever moves to plain Postgres, this is the file to
-- replace with whatever object store takes its place.
--
-- Authorisation is entirely path-based: every object MUST be stored as
--     {household_id}/{expense_id}/{uuid}.jpg
-- and the policies below compare the first path segment against the caller's
-- household. public.receipts has a matching CHECK constraint so the metadata
-- row and the object can never disagree about which household owns the file.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,                              -- private; the app uses signed URLs
  10485760,                           -- 10 MB, generous for a compressed photo
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

drop policy if exists receipts_update on storage.objects;
create policy receipts_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );
