-- Migration 34: owners TJA and DN, owner contact, prospect removal, the
-- all-owner recruit exclusion, the reply-to-a-message events, and the digest's
-- owners-with-no-address list.
--
-- One transaction, rolled back. Every value read is guarded for NULL, and every
-- expected refusal checks its error text (CLAUDE.md, migrations 15 and 16).
-- Fixture addresses use the reserved tnf.test domain only.

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Fixture owner addresses, written directly: a fresh database has none.
update owners set email = lower(code) || '@tnf.test';
update owners set email = 'avd-primary@tnf.test', alt_email = 'avd-alt@tnf.test' where code = 'AVD';
update owners set email = null where code = 'DN';

-- 1. The two codes are accepted wherever an owner code is, and the lists are
--    still closed.
do $$
declare
  v_id uuid;
  v_code text;
begin
  foreach v_code in array array['TJA', 'DN'] loop
    insert into participants (full_name, owner_group) values (v_code || ' Probe', v_code) returning id into v_id;
    if (select owner_group from participants where id = v_id) is distinct from v_code then
      raise exception 'TEST FAILURE: participants rejected or changed owner code %', v_code;
    end if;
    insert into payments (participant_id, amount_cents, method, paid_on, source_ref, collected_by)
    values (v_id, 50000, 'cash', '2026-10-08', 'fixture', v_code);
    if not exists (select 1 from payments where participant_id = v_id and collected_by = v_code) then
      raise exception 'TEST FAILURE: payments.collected_by rejected %', v_code;
    end if;
  end loop;

  begin
    insert into payments (participant_id, amount_cents, method, paid_on, source_ref, collected_by)
    values (v_id, 50000, 'cash', '2026-10-08', 'fixture', 'ZZZ');
    raise exception 'TEST FAILURE: payments.collected_by accepted an unknown code';
  exception when check_violation then null;
  end;
  begin
    insert into owners (code, full_name) values ('ZZZ', 'Nobody');
    raise exception 'TEST FAILURE: owners accepted an unknown code';
  exception when check_violation then null;
  end;
end $$;

-- 2. Privileges. The two RPCs are admin RPCs; the helpers are not callable by
--    any client role.
do $$
declare
  fn text;
begin
  foreach fn in array array['admin_set_owner_contact(text,text,text,text)', 'admin_remove_prospect(text,text,text)'] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'TEST FAILURE: anon can execute %', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'TEST FAILURE: authenticated cannot execute %', fn;
    end if;
  end loop;
  foreach fn in array array['email_owner_addresses()', 'email_pool_addresses()', 'email_people_for(text)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'TEST FAILURE: internal helper % is callable by a client role', fn;
    end if;
  end loop;

  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_set_owner_contact('TJA', 'email', 'x@tnf.test', 'test');
    raise exception 'TEST FAILURE: a non-admin set an owner address';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_remove_prospect('x@tnf.test', 'r', 'test');
    raise exception 'TEST FAILURE: a non-admin removed a prospect';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
end $$;

-- 3. admin_set_owner_contact: sets and clears one column, audited without the
--    address, and never stores a second copy of an address.
do $$
declare
  v_n int;
  v_a audit_log;
begin
  perform admin_set_owner_contact('TJA', 'email', '  TJ-New@TNF.test ', 'test');
  if (select email from owners where code = 'TJA') is distinct from 'tj-new@tnf.test' then
    raise exception 'TEST FAILURE: TJA email was not set, lowercased and trimmed';
  end if;
  select * into v_a from audit_log where action = 'set_owner_contact' and target_id = 'TJA' order by id desc limit 1;
  if v_a.id is null then raise exception 'TEST FAILURE: setting an owner address wrote no audit row'; end if;
  if (v_a.after ->> 'set') is distinct from 'true' or (v_a.after ->> 'field') is distinct from 'email' then
    raise exception 'TEST FAILURE: audit after reads %', v_a.after;
  end if;
  if coalesce(v_a.before::text, '') || coalesce(v_a.after::text, '') || coalesce(v_a.note, '') like '%@%' then
    raise exception 'TEST FAILURE: the owner contact audit row carries an address';
  end if;

  -- Clearing Anthony's alt address: the one A2 write on the owners table.
  perform admin_set_owner_contact('AVD', 'alt_email', null, 'test');
  if (select alt_email from owners where code = 'AVD') is not null then
    raise exception 'TEST FAILURE: AVD alt_email was not cleared';
  end if;
  if (select email from owners where code = 'AVD') is distinct from 'avd-primary@tnf.test' then
    raise exception 'TEST FAILURE: clearing alt_email touched email';
  end if;
  select * into v_a from audit_log where action = 'set_owner_contact' and target_id = 'AVD' order by id desc limit 1;
  if v_a.id is null then raise exception 'TEST FAILURE: clearing wrote no audit row'; end if;
  if (v_a.before ->> 'set') is distinct from 'true' or (v_a.after ->> 'set') is distinct from 'false' then
    raise exception 'TEST FAILURE: clear audit reads % -> %', v_a.before, v_a.after;
  end if;

  -- A second copy of one address is refused: the owner's own primary as alt,
  -- and another owner's address in either column.
  begin
    perform admin_set_owner_contact('AVD', 'alt_email', 'avd-primary@tnf.test', 'test');
    raise exception 'TEST FAILURE: alt_email duplicated the owner''s own email';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%duplicate this owner''s own email%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_set_owner_contact('DN', 'email', 'RM@tnf.test', 'test');
    raise exception 'TEST FAILURE: an owner took another owner''s address';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%another owner already has that address%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_set_owner_contact('DN', 'email', 'not an address', 'test');
    raise exception 'TEST FAILURE: a malformed address was stored';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%malformed address%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_set_owner_contact('DN', 'phone', 'x@tnf.test', 'test');
    raise exception 'TEST FAILURE: an unknown field was written';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%field must be%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;

  -- No change, no audit row.
  select count(*) into v_n from audit_log where action = 'set_owner_contact';
  perform admin_set_owner_contact('TJA', 'email', 'tj-new@tnf.test', 'test');
  if (select count(*) from audit_log where action = 'set_owner_contact') <> v_n then
    raise exception 'TEST FAILURE: a no-op contact write was audited as a change';
  end if;
  if (select email from owners where code = 'DN') is not null then
    raise exception 'TEST FAILURE: a refused write changed DN';
  end if;
end $$;

-- 4. admin_remove_prospect: the row goes, the audit row keeps everything but
--    the address.
do $$
declare
  v_id uuid;
  v_a audit_log;
begin
  perform admin_import_prospects(array['gone@tnf.test', 'stays@tnf.test'], 'msg-fixture-rm', 'test');
  v_id := admin_remove_prospect(' Gone@TNF.test ', 'an owner is never a prospect', 'test');
  if v_id is null then raise exception 'TEST FAILURE: remove returned NULL'; end if;
  if exists (select 1 from prospects where email = 'gone@tnf.test') then
    raise exception 'TEST FAILURE: the prospect row is still there';
  end if;
  if not exists (select 1 from prospects where email = 'stays@tnf.test') then
    raise exception 'TEST FAILURE: removing one prospect removed another';
  end if;
  select * into v_a from audit_log where action = 'remove_prospect' and target_id = v_id::text;
  if v_a.id is null then raise exception 'TEST FAILURE: removal wrote no audit row'; end if;
  if (v_a.before ->> 'source_ref') is distinct from 'msg-fixture-rm' then
    raise exception 'TEST FAILURE: the removal audit lost the source, reads %', v_a.before;
  end if;
  if v_a.note is distinct from 'an owner is never a prospect' then
    raise exception 'TEST FAILURE: the removal audit lost the reason';
  end if;
  if coalesce(v_a.before::text, '') || coalesce(v_a.after::text, '') || coalesce(v_a.note, '') || coalesce(v_a.target_id, '') like '%@%' then
    raise exception 'TEST FAILURE: the removal audit row carries an address';
  end if;

  begin
    perform admin_remove_prospect('gone@tnf.test', 'again', 'test');
    raise exception 'TEST FAILURE: removed a prospect that does not exist';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a prospect%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_remove_prospect('stays@tnf.test', '  ', 'test');
    raise exception 'TEST FAILURE: removed a prospect with no reason';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%reason is required%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 5. An owner is never a prospect: recruit excludes every owner address,
--    primary and alt, not only Anthony's.
do $$
declare
  v_n int;
begin
  perform admin_set_owner_contact('GD', 'alt_email', 'gd-alt@tnf.test', 'test');
  perform admin_import_prospects(array['rm@tnf.test', 'gd-alt@tnf.test', 'avd-primary@tnf.test', 'fresh@tnf.test'],
                                 'msg-fixture-owners', 'test');
  select count(*) into v_n from admin_email_recipients('recruit_t') where recipient = 'fresh@tnf.test';
  if v_n is null or v_n <> 1 then raise exception 'TEST FAILURE: an ordinary prospect is missing from recruit'; end if;
  select count(*) into v_n from admin_email_recipients('recruit_t') where recipient = 'rm@tnf.test';
  if v_n is null then raise exception 'TEST FAILURE: count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: an owner''s primary address is a recruit recipient'; end if;
  select count(*) into v_n from admin_email_recipients('recruit_t') where recipient = 'gd-alt@tnf.test';
  if v_n <> 0 then raise exception 'TEST FAILURE: an owner''s alt address is a recruit recipient'; end if;
  select count(*) into v_n from admin_email_recipients('recruit_t') where recipient = 'avd-primary@tnf.test';
  if v_n <> 0 then raise exception 'TEST FAILURE: Anthony is a recruit recipient'; end if;
end $$;

-- 6. game_list_<id> and answer_<id>: who a reply to one inbound message may go
--    to, the greeting facts, and one reply per message.
do $$
declare
  v_pid uuid;
  v_ctx jsonb;
  v_n int;
begin
  insert into participants (full_name, display_alias, email, cc_email, owner_group, source, blocks_requested)
  values ('Dana Asker', 'DA', 'dana@tnf.test', 'dana-cc@tnf.test', 'RM', 'email', 0) returning id into v_pid;

  foreach v_ctx in array array['"dana@tnf.test"', '"dana-cc@tnf.test"', '"fresh@tnf.test"', '"jpod@tnf.test"']::jsonb[] loop
    select count(*) into v_n from admin_email_recipients('game_list_1a2b') where recipient = v_ctx #>> '{}';
    if v_n is null or v_n <> 1 then
      raise exception 'TEST FAILURE: % (participant, cc, prospect or owner) cannot get a game_list reply', v_ctx #>> '{}';
    end if;
  end loop;
  foreach v_ctx in array array['"avd-primary@tnf.test"', '"gd-alt@tnf.test"', '"stranger@tnf.test"']::jsonb[] loop
    select count(*) into v_n from admin_email_recipients('answer_1a2b') where recipient = v_ctx #>> '{}';
    if v_n is null then raise exception 'TEST FAILURE: count came back NULL'; end if;
    if v_n <> 0 then raise exception 'TEST FAILURE: % may get an answer reply', v_ctx #>> '{}'; end if;
  end loop;
  select count(*) into v_n from admin_email_recipients('answer_1a2b') where recipient = 'tj-new@tnf.test';
  if v_n <> 1 then raise exception 'TEST FAILURE: an owner''s primary address cannot get an answer'; end if;

  begin
    perform admin_email_recipients('game_list_NOT-HEX');
    raise exception 'TEST FAILURE: a malformed game_list key derived recipients';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%no recipient rule%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;

  v_ctx := admin_email_context('game_list_1a2b', 'dana@tnf.test');
  if v_ctx is null then raise exception 'TEST FAILURE: context came back NULL'; end if;
  if (v_ctx -> 'people' -> 0 ->> 'full_name') is distinct from 'Dana Asker'
     or (v_ctx -> 'people' -> 0 ->> 'via') is distinct from 'primary' then
    raise exception 'TEST FAILURE: game_list people reads %', v_ctx -> 'people';
  end if;
  if jsonb_array_length(v_ctx -> 'common' -> 'games') is distinct from (select count(*)::int from games where status <> 'void') then
    raise exception 'TEST FAILURE: game_list context does not carry every game';
  end if;
  v_ctx := admin_email_context('answer_1a2b', 'dana-cc@tnf.test');
  if (v_ctx -> 'people' -> 0 ->> 'via') is distinct from 'cc' then
    raise exception 'TEST FAILURE: a cc address is not marked as reaching via cc';
  end if;
  v_ctx := admin_email_context('answer_1a2b', 'tj-new@tnf.test');
  if (v_ctx -> 'people' -> 0 ->> 'full_name') is distinct from 'TJ Auletto' then
    raise exception 'TEST FAILURE: an owner address does not reach the owner, reads %', v_ctx -> 'people';
  end if;
  begin
    perform admin_email_context('game_list_1a2b', 'stranger@tnf.test');
    raise exception 'TEST FAILURE: a game_list context was built for a stranger';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a participant, prospect or owner%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;

  perform admin_email_claim('game_list_1a2b', 'dana@tnf.test', repeat('a', 64), 'test');
  begin
    perform admin_email_claim('answer_1a2b', 'dana-cc@tnf.test', repeat('b', 64), 'test');
    raise exception 'TEST FAILURE: two replies were claimed for one inbound message';
  exception when unique_violation then
    if sqlerrm not like '%email_sends_one_reply_per_message%' then raise exception 'TEST FAILURE: wrong unique refusal: %', sqlerrm; end if;
  end;
  perform admin_email_claim('answer_9f9f', 'dana-cc@tnf.test', repeat('b', 64), 'test');
end $$;

-- 7. The digest lists every owner with no address, and only those.
do $$
declare
  v_d jsonb;
begin
  v_d := admin_email_context('digest_t', 'avd-primary@tnf.test') -> 'digest' -> 'owners_missing_email';
  if v_d is null then raise exception 'TEST FAILURE: owners_missing_email came back NULL'; end if;
  if v_d is distinct from '[{"code": "DN", "full_name": "Dom Novelli"}]'::jsonb then
    raise exception 'TEST FAILURE: owners_missing_email reads %', v_d;
  end if;
  perform admin_set_owner_contact('DN', 'email', 'dn@tnf.test', 'test');
  v_d := admin_email_context('digest_t', 'avd-primary@tnf.test') -> 'digest' -> 'owners_missing_email';
  if v_d is distinct from '[]'::jsonb then
    raise exception 'TEST FAILURE: with every address set, owners_missing_email reads %', v_d;
  end if;
end $$;

rollback;
