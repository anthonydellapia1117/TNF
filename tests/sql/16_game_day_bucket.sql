-- Game-day grid files (migration 22): a public bucket only the admin writes.
--
-- The game-day email links to the grid PNG and PDF in storage bucket
-- game-day. Anyone may read them (the grid page is public). Only the admin,
-- signed in through Supabase Auth, may insert or replace them, and only in
-- that bucket. Nothing deletes.
begin;

-- The bucket exists, is public, and takes only the two file types.
do $$
declare v_public boolean; v_types text[];
begin
  select public, allowed_mime_types into v_public, v_types
    from storage.buckets where id = 'game-day';
  if v_public is null then
    raise exception 'TEST FAILURE: bucket game-day does not exist';
  end if;
  if not v_public then
    raise exception 'TEST FAILURE: bucket game-day is not public';
  end if;
  if v_types is null or not (v_types @> array['image/png', 'application/pdf']) then
    raise exception 'TEST FAILURE: bucket game-day allowed_mime_types is %', v_types;
  end if;
end $$;

-- All three policies are present and shaped as intended.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('game_day_public_read', 'game_day_admin_insert', 'game_day_admin_update');
  if n <> 3 then
    raise exception 'TEST FAILURE: % of 3 game-day policies present', n;
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'game_day%' and cmd = 'DELETE'
  ) then
    raise exception 'TEST FAILURE: a game-day delete policy exists; nothing deletes';
  end if;
end $$;

-- Anti-vacuity: put a file in the bucket before checking that anon sees it.
insert into storage.objects (bucket_id, name)
values ('game-day', '2026-09-09_TNF_G01_grid.png');

-- Anyone can read the game-day files ...
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'game-day';
  if n <> 1 then
    raise exception 'TEST FAILURE: anon read % game-day objects, expected 1', n;
  end if;
end $$;

-- ... but cannot write one.
do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('game-day', 'anon.png');
    raise exception 'TEST FAILURE: anon inserted into game-day';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A signed-in session that is not the admin cannot write either.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"someone@else.test","role":"authenticated"}', true);
do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('game-day', 'other.png');
    raise exception 'TEST FAILURE: a non-admin session inserted into game-day';
  exception
    when insufficient_privilege then null;
  end;
  begin
    update storage.objects set updated_at = now() where bucket_id = 'game-day';
    if found then
      raise exception 'TEST FAILURE: a non-admin session updated a game-day object';
    end if;
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The admin can insert and replace (upsert), but only inside game-day.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com","role":"authenticated"}', true);
do $$
declare n int;
begin
  insert into storage.objects (bucket_id, name)
  values ('game-day', '2026-09-09_TNF_G01_grid.pdf');

  update storage.objects set updated_at = now()
   where bucket_id = 'game-day' and name = '2026-09-09_TNF_G01_grid.pdf';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'TEST FAILURE: admin update touched % rows, expected 1', n;
  end if;

  begin
    insert into storage.objects (bucket_id, name) values ('elsewhere', 'x.png');
    raise exception 'TEST FAILURE: admin inserted outside game-day';
  exception
    when insufficient_privilege or foreign_key_violation then null;
  end;
end $$;
reset role;

rollback;
