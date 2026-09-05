-- Game-day grid files (migration 22).
--
-- The game-day email carries links, not attachments: the PNG and the PDF of
-- /grid?g=N live in a PUBLIC storage bucket named game-day and the body
-- links to them. Public read is the point: the grid page itself is public,
-- names and block numbers only, and the files are renders of it.
--
-- Writes are admin-only. The pack command (scripts/game-day-pack.mts
-- --upload) signs in as the admin through Supabase Auth with ADMIN_EMAIL and
-- ADMIN_PASSWORD, never a service-role key, and uploads over the Storage
-- REST API, so the insert and update policies re-check is_admin() the same
-- way every admin_* RPC does. There is no delete policy: nothing deletes.
--
-- Object names are <YYYY-MM-DD>_TNF_G0N_grid.png and .pdf (the game's own
-- ET date). Upsert re-renders replace a file in place.
--
-- Not applied automatically. Apply to production only after the local SQL
-- suites pass (tests/sql/16_game_day_bucket.sql).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-day', 'game-day', true, 10485760, array['image/png', 'application/pdf'])
on conflict (id) do update
   set public = true,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- create policy has no IF NOT EXISTS; guard each by name so a re-run is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'game_day_public_read'
  ) then
    create policy game_day_public_read on storage.objects
      for select
      using (bucket_id = 'game-day');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'game_day_admin_insert'
  ) then
    create policy game_day_admin_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'game-day' and public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'game_day_admin_update'
  ) then
    create policy game_day_admin_update on storage.objects
      for update to authenticated
      using (bucket_id = 'game-day' and public.is_admin())
      with check (bucket_id = 'game-day' and public.is_admin());
  end if;
end $$;
