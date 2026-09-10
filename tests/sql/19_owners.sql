-- The owners lookup: admin-only, eight codes, no leak to anon.
--
-- Every assertion that reads a value guards for NULL and raises, per the
-- CLAUDE.md rule learned from migrations 15 and 16: a conditionally-visible
-- column that comes back NULL turns "if value <> expected" into a no-op and
-- the suite reports PASS while testing nothing.

do $$
declare
  v_n int;
  v_name text;
  v_email text;
begin
  -- 1. All eight codes are present, and only those eight.
  select count(*) into v_n from owners;
  if v_n is null then raise exception 'TEST FAILURE: owners count came back NULL'; end if;
  if v_n <> 8 then raise exception 'TEST FAILURE: expected 8 owners, found %', v_n; end if;

  select count(*) into v_n from owners
   where code not in ('AVD','RM','MAP','JPOD','EJD','NL','GD','BG');
  if v_n is null then raise exception 'TEST FAILURE: stray-code count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: % owner rows carry an unknown code', v_n; end if;

  -- 2. Every code in the participants CHECK has a person attached. This is the
  --    gap NL and BG were: a code in the schema with no name anywhere.
  select count(*) into v_n from (
    select unnest(array['AVD','RM','MAP','JPOD','EJD','NL','GD','BG']) as code
  ) c where not exists (select 1 from owners o where o.code = c.code);
  if v_n is null then raise exception 'TEST FAILURE: unmatched-code count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: % owner codes have no person attached', v_n; end if;

  -- 3. The two codes named on 2026-09-09 specifically.
  select full_name into v_name from owners where code = 'NL';
  if v_name is null then raise exception 'TEST FAILURE: NL has no name'; end if;
  if v_name <> 'Nolan Lawrence' then raise exception 'TEST FAILURE: NL reads %', v_name; end if;
  select full_name into v_name from owners where code = 'BG';
  if v_name is null then raise exception 'TEST FAILURE: BG has no name'; end if;
  if v_name <> 'Billy Guyon' then raise exception 'TEST FAILURE: BG reads %', v_name; end if;

  -- 4. Every row carries a usable address, admin-side.
  select count(*) into v_n from owners where email is null or position('@' in email) < 2;
  if v_n is null then raise exception 'TEST FAILURE: bad-email count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: % owner rows have no usable email', v_n; end if;

  -- 5. The table is not reachable from any public projection. An owner email in
  --    a v_public_* view would publish it to anon, which is the whole reason
  --    these addresses are not in the public repo either.
  select count(*) into v_n
    from information_schema.view_table_usage
   where view_schema = 'public' and view_name like 'v_public%' and table_name = 'owners';
  if v_n is null then raise exception 'TEST FAILURE: view-usage count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: % public views select from owners', v_n; end if;

  select count(*) into v_n
    from information_schema.view_table_usage
   where view_schema = 'public' and view_name = 'v_pot' and table_name = 'owners';
  if v_n is null then raise exception 'TEST FAILURE: v_pot usage count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: v_pot selects from owners'; end if;

  -- 6. RLS is on and anon holds no privilege.
  select count(*) into v_n from pg_class where relname = 'owners' and relrowsecurity;
  if v_n <> 1 then raise exception 'TEST FAILURE: RLS is not enabled on owners'; end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_name = 'owners' and grantee = 'anon';
  if v_n is null then raise exception 'TEST FAILURE: anon grant count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: anon holds % grants on owners', v_n; end if;

  raise notice 'owners: 8 codes, all named, admin-only, no public view, anon has nothing';
end $$;

-- 7. With no admin claim, the RLS policy returns nothing. Proves the read is
--    actually gated rather than merely declared.
do $$
declare
  v_n int;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  select count(*) into v_n from owners;
  if v_n is null then raise exception 'TEST FAILURE: non-admin owners count came back NULL'; end if;
  if v_n <> 0 then
    raise exception 'TEST FAILURE: a non-admin session read % owner rows', v_n;
  end if;
  reset role;
  raise notice 'owners: a non-admin session sees 0 rows';
end $$;
