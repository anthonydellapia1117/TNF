-- Migration 35: blocked_address_hashes and the trigger that keeps a blocked
-- address out of every table that holds one.
--
-- The hash is computed here from first principles (sha256 of lower(btrim()))
-- rather than through address_hash(), so a broken address_hash() fails this
-- suite instead of agreeing with itself.
--
-- Mutation check (CLAUDE.md: re-verify, not just re-run): drop
-- participants_reject_blocked_address and section 3 raises. If it still
-- passes, the assertion is dead.

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- 1. Admin-only, on the same footing as owners and pending_actions.
do $$
declare
  p text;
begin
  if not (select relrowsecurity from pg_class where oid = 'blocked_address_hashes'::regclass) then
    raise exception 'TEST FAILURE: RLS is off on blocked_address_hashes';
  end if;
  foreach p in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('anon', 'blocked_address_hashes', p) then
      raise exception 'TEST FAILURE: anon holds % on blocked_address_hashes', p;
    end if;
  end loop;
  foreach p in array array['insert', 'update', 'delete'] loop
    if has_table_privilege('authenticated', 'blocked_address_hashes', p) then
      raise exception 'TEST FAILURE: authenticated holds direct % on blocked_address_hashes', p;
    end if;
  end loop;
  if has_function_privilege('anon', 'admin_block_address_hash(text,text,text)', 'execute') then
    raise exception 'TEST FAILURE: anon can execute admin_block_address_hash';
  end if;
  if exists (select 1 from information_schema.view_table_usage
              where view_schema = 'public' and table_name = 'blocked_address_hashes') then
    raise exception 'TEST FAILURE: a view selects from blocked_address_hashes';
  end if;
  if (select count(*) from blocked_address_hashes) <> 0 then
    raise exception 'TEST FAILURE: the migration seeded a hash; hashes are seeded by hand, never committed';
  end if;
end $$;

-- 2. Seeding: admin only, well-formed, with a reason, audited.
do $$
declare
  v_h text := encode(sha256(convert_to('blocked@tnf.test', 'UTF8')), 'hex');
begin
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_block_address_hash(v_h, 'test', 'test');
    raise exception 'TEST FAILURE: a non-admin seeded a hash';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

  begin
    perform admin_block_address_hash('blocked@tnf.test', 'test', 'test');
    raise exception 'TEST FAILURE: an address was accepted where a hash belongs';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%64 hex characters%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_block_address_hash(v_h, ' ', 'test');
    raise exception 'TEST FAILURE: a hash was seeded with no reason';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%reason is required%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;

  perform admin_block_address_hash(upper(v_h), 'fixture: never stored', 'test');
  if not exists (select 1 from blocked_address_hashes where hash = v_h) then
    raise exception 'TEST FAILURE: the hash was not stored lowercase';
  end if;
  if not exists (select 1 from audit_log where action = 'block_address_hash' and target_id = v_h) then
    raise exception 'TEST FAILURE: seeding wrote no audit row';
  end if;
  perform admin_block_address_hash(v_h, 'again', 'test');
  if (select count(*) from audit_log where action = 'block_address_hash' and target_id = v_h) <> 1 then
    raise exception 'TEST FAILURE: re-seeding the same hash wrote a second audit row';
  end if;
end $$;

-- 3. Every address column on every address table refuses it, in any case and
--    with any surrounding space, on insert and on update, by any path. The
--    error names the column and never the address.
do $$
declare
  v_id uuid;
  v_variant text;
  v_ok int := 0;
begin
  insert into participants (full_name, email, owner_group) values ('Clean Probe', 'clean@tnf.test', 'AVD')
  returning id into v_id;

  foreach v_variant in array array['blocked@tnf.test', '  Blocked@TNF.test ', 'BLOCKED@TNF.TEST'] loop
    begin
      insert into participants (full_name, email, owner_group) values ('Blocked Probe', v_variant, 'AVD');
      raise exception 'TEST FAILURE: participants.email accepted a blocked address (%)', v_variant;
    exception when check_violation then
      if sqlerrm not like 'blocked address: participants.email%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
      if sqlerrm ilike '%blocked@tnf.test%' then raise exception 'TEST FAILURE: the refusal echoes the address'; end if;
      v_ok := v_ok + 1;
    end;
  end loop;

  begin
    update participants set cc_email = 'blocked@tnf.test' where id = v_id;
    raise exception 'TEST FAILURE: participants.cc_email accepted a blocked address on update';
  exception when check_violation then
    if sqlerrm not like 'blocked address: participants.cc_email%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    v_ok := v_ok + 1;
  end;

  begin
    update owners set alt_email = 'blocked@tnf.test' where code = 'AVD';
    raise exception 'TEST FAILURE: owners.alt_email accepted a blocked address';
  exception when check_violation then
    if sqlerrm not like 'blocked address: owners.alt_email%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    v_ok := v_ok + 1;
  end;

  begin
    perform admin_set_owner_contact('DN', 'email', 'Blocked@tnf.test', 'test');
    raise exception 'TEST FAILURE: admin_set_owner_contact stored a blocked address';
  exception when check_violation then
    if sqlerrm not like 'blocked address: owners.email%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    v_ok := v_ok + 1;
  end;

  begin
    perform admin_import_prospects(array['fine@tnf.test', 'blocked@tnf.test'], 'msg-fixture-blocked', 'test');
    raise exception 'TEST FAILURE: an import stored a blocked address';
  exception when check_violation then
    if sqlerrm not like 'blocked address: prospects.email%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    v_ok := v_ok + 1;
  end;
  if exists (select 1 from prospects where email = 'fine@tnf.test') then
    raise exception 'TEST FAILURE: an import with a blocked address half-applied';
  end if;

  if v_ok <> 7 then raise exception 'TEST FAILURE: % of 7 refusals fired', v_ok; end if;

  -- An ordinary address still goes in.
  update participants set cc_email = 'still-fine@tnf.test' where id = v_id;
  if (select cc_email from participants where id = v_id) is distinct from 'still-fine@tnf.test' then
    raise exception 'TEST FAILURE: an ordinary address was refused';
  end if;
end $$;

-- 4. Seeding refuses while a stored row still holds the address: clean first.
do $$
declare
  v_h text := encode(sha256(convert_to('held@tnf.test', 'UTF8')), 'hex');
begin
  perform admin_import_prospects(array['held@tnf.test'], 'msg-fixture-held', 'test');
  begin
    perform admin_block_address_hash(v_h, 'test', 'test');
    raise exception 'TEST FAILURE: a hash was seeded while a prospect row still held the address';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%still hold that address%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform admin_remove_prospect('held@tnf.test', 'never stored', 'test');
  perform admin_block_address_hash(v_h, 'test', 'test');
  if not exists (select 1 from blocked_address_hashes where hash = v_h) then
    raise exception 'TEST FAILURE: seeding after cleanup did not store the hash';
  end if;
end $$;

-- 5. A non-admin session reads no hash.
do $$
declare
  v_n int;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  select count(*) into v_n from blocked_address_hashes;
  reset role;
  if v_n is null then raise exception 'TEST FAILURE: count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: a non-admin session read % hashes', v_n; end if;
end $$;

rollback;
