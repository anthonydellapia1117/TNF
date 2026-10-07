-- The email ledger and the facts every TNF email reads (migration 33).
--
-- One transaction, rolled back at the end, so the fixtures never leak into a
-- later suite. Every assertion that reads a value guards for NULL and raises
-- (CLAUDE.md, migrations 15 and 16): a NULL compared with <> is a silent pass.
-- Every expected refusal checks the error text, so a function that fails for
-- the WRONG reason does not count as the guard working.
--
-- Fixture addresses use the reserved tnf.test domain only: the address ratchet
-- in tests/unit/no-published-emails.test.ts rejects any real one.

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Anthony's own addresses live on his owner row; the derivations read them
-- from there and never from a literal.
update owners set email = 'avd-primary@tnf.test', alt_email = 'avd-work@tnf.test' where code = 'AVD';

do $$
declare
  v_open int[];
  v_jane uuid; v_sam uuid; v_pat uuid; v_self uuid; v_nora uuid;
begin
  select array_agg(block_number) into v_open
    from (select block_number from blocks where status = 'available' order by block_number limit 4) s;
  if v_open is null or cardinality(v_open) < 4 then
    raise exception 'TEST SETUP: need 4 available blocks, found %', coalesce(cardinality(v_open), 0);
  end if;

  insert into participants (full_name, display_alias, email, cc_email, owner_group, source, blocks_requested)
  values ('Jane Holder', 'JH', '  Jane@TNF.test ', 'jane-cc@tnf.test', 'RM', 'email', 1)
  returning id into v_jane;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Sam Share', 'Sam', 'share@tnf.test', 'AVD', 'email', 1) returning id into v_sam;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Pat Share', 'Pat', 'SHARE@tnf.test', 'AVD', 'email', 1) returning id into v_pat;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Anthony Fixture', 'AF', 'avd-primary@tnf.test', 'AVD', 'email', 1) returning id into v_self;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Nora Nobody', 'NN', 'nora@tnf.test', 'AVD', 'email', 0) returning id into v_nora;

  update blocks set participant_id = v_jane, status = 'reserved', assignment_method = 'admin' where block_number = v_open[1];
  update blocks set participant_id = v_sam,  status = 'assigned', assignment_method = 'admin' where block_number = v_open[2];
  update blocks set participant_id = v_pat,  status = 'reserved', assignment_method = 'admin', comped = true where block_number = v_open[3];
  update blocks set participant_id = v_self, status = 'reserved', assignment_method = 'admin' where block_number = v_open[4];
end $$;

-- 1. Privileges. Admin-only on the same footing as owners and pending_actions.
do $$
declare
  t text; p text; fn text;
begin
  foreach t in array array['email_sends', 'prospects'] loop
    if not (select relrowsecurity from pg_class where oid = t::regclass) then
      raise exception 'TEST FAILURE: RLS is off on %', t;
    end if;
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('anon', t, p) then
        raise exception 'TEST FAILURE: anon holds % on %', p, t;
      end if;
    end loop;
    if not has_table_privilege('authenticated', t, 'select') then
      raise exception 'TEST FAILURE: authenticated cannot select % (the admin page reads it under RLS)', t;
    end if;
    foreach p in array array['insert', 'update', 'delete'] loop
      if has_table_privilege('authenticated', t, p) then
        raise exception 'TEST FAILURE: authenticated holds direct % on %; writes go only through the RPCs', p, t;
      end if;
    end loop;
  end loop;

  foreach fn in array array[
    'admin_email_recipients(text)', 'admin_email_context(text,text)', 'admin_email_batch(text)',
    'admin_email_claim(text,text,text,text)', 'admin_email_record_sent(text,text,text,text,text)',
    'admin_email_unsent()', 'admin_import_prospects(text[],text,text)',
    'admin_exclude_prospect(text,text,text)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'TEST FAILURE: anon can execute %', fn;
    end if;
  end loop;

  foreach fn in array array[
    'email_avd_addresses()', 'email_holder_addresses()', 'email_common_facts()',
    'email_holder_facts(text)', 'email_digest_facts()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'TEST FAILURE: internal helper % is callable by a client role', fn;
    end if;
  end loop;
end $$;

-- 2. Every RPC refuses a non-admin caller.
do $$
begin
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_email_recipients('holder_checkin_t');
    raise exception 'TEST FAILURE: a non-admin read the recipient list';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal for non-admin: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim('holder_checkin_t', 'jane@tnf.test', repeat('a', 64), 'test');
    raise exception 'TEST FAILURE: a non-admin claimed a send';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal for non-admin claim: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
end $$;

-- 3. Holder recipients: primary and cc, lowercased and trimmed, one row per
--    address however many participants share it, Anthony's own excluded,
--    non-holders absent.
do $$
declare
  v_n int;
begin
  select count(*) into v_n from admin_email_recipients('holder_checkin_t') where recipient = 'jane@tnf.test';
  if v_n is null then raise exception 'TEST FAILURE: count came back NULL'; end if;
  if v_n <> 1 then raise exception 'TEST FAILURE: the primary address was not lowercased and trimmed into the set (found %)', v_n; end if;

  select count(*) into v_n from admin_email_recipients('holder_checkin_t') where recipient = 'jane-cc@tnf.test';
  if v_n <> 1 then raise exception 'TEST FAILURE: a holder''s cc_email is missing from the holder set'; end if;

  select count(*) into v_n from admin_email_recipients('holder_checkin_t') where recipient = 'share@tnf.test';
  if v_n <> 1 then raise exception 'TEST FAILURE: a shared address appears % times; one email per address', v_n; end if;

  select count(*) into v_n from admin_email_recipients('holder_checkin_t')
   where recipient in ('avd-primary@tnf.test', 'avd-work@tnf.test');
  if v_n <> 0 then raise exception 'TEST FAILURE: Anthony''s own address is in the holder set'; end if;

  select count(*) into v_n from admin_email_recipients('holder_checkin_t') where recipient = 'nora@tnf.test';
  if v_n <> 0 then raise exception 'TEST FAILURE: a participant with no committed block is in the holder set'; end if;
  if exists (select recipient from admin_email_recipients('holder_checkin_t')
             except select recipient from admin_email_recipients('game_day_g01'))
     or exists (select recipient from admin_email_recipients('game_day_g01')
                except select recipient from admin_email_recipients('holder_checkin_t')) then
    raise exception 'TEST FAILURE: the game-day Bcc set is not the holder set';
  end if;

  begin
    perform admin_email_recipients('mystery_event');
    raise exception 'TEST FAILURE: an event with no recipient rule returned recipients';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%no recipient rule%' then raise exception 'TEST FAILURE: wrong refusal for unknown event: %', sqlerrm; end if;
  end;
end $$;

-- 4. Holder context: what is on file for one address, never the comp flag.
do $$
declare
  v_ctx jsonb;
  v_n int;
begin
  v_ctx := admin_email_context('holder_checkin_t', 'share@tnf.test');
  if v_ctx is null then raise exception 'TEST FAILURE: context came back NULL'; end if;
  v_n := jsonb_array_length(v_ctx -> 'holder' -> 'people');
  if v_n is null or v_n <> 2 then raise exception 'TEST FAILURE: a shared address should reach 2 people, found %', v_n; end if;
  v_n := jsonb_array_length(v_ctx -> 'holder' -> 'blocks');
  if v_n is null or v_n <> 2 then raise exception 'TEST FAILURE: a shared address should carry both people''s blocks, found %', v_n; end if;
  if v_ctx::text like '%comped%' then
    raise exception 'TEST FAILURE: the comp flag reached an email context; it is admin-only';
  end if;
  if (v_ctx -> 'holder' -> 'blocks' -> 0 ->> 'owner_full_name') is null then
    raise exception 'TEST FAILURE: a block carries no owner name';
  end if;

  v_ctx := admin_email_context('holder_checkin_t', 'jane-cc@tnf.test');
  if (v_ctx -> 'holder' -> 'people' -> 0 ->> 'via') is distinct from 'cc' then
    raise exception 'TEST FAILURE: a cc address is not marked as reaching via cc; the renderer would greet the cc by the participant''s name';
  end if;

  if (v_ctx -> 'common' ->> 'open_count')::int is distinct from (select count(*)::int from blocks where status = 'available') then
    raise exception 'TEST FAILURE: open_count is not the live count of available blocks';
  end if;
  if jsonb_array_length(v_ctx -> 'common' -> 'games') is distinct from (select count(*)::int from games where status <> 'void') then
    raise exception 'TEST FAILURE: the games list does not equal the non-void games';
  end if;

  begin
    perform admin_email_context('holder_checkin_t', 'nora@tnf.test');
    raise exception 'TEST FAILURE: a holder context was built for a non-holder';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%holds no committed block%' then raise exception 'TEST FAILURE: wrong refusal for non-holder: %', sqlerrm; end if;
  end;
end $$;

-- 5. Prospect import: lowercased, deduplicated, all or nothing, audited with
--    counts and never the addresses.
do $$
declare
  v_n int;
  v_audit jsonb;
begin
  v_n := admin_import_prospects(
    array['A@TNF.test', 'a@tnf.test', '  b@tnf.test ', 'jane@tnf.test', 'avd-work@tnf.test', 'x@tnf.test'],
    'msg-fixture-1', 'test');
  if v_n is null then raise exception 'TEST FAILURE: import count came back NULL'; end if;
  if v_n <> 5 then raise exception 'TEST FAILURE: expected 5 distinct imports, got %', v_n; end if;

  select after into v_audit from audit_log
   where action = 'import_prospects' and target_id = 'msg-fixture-1' order by at desc limit 1;
  if v_audit is null then raise exception 'TEST FAILURE: the import wrote no audit row'; end if;
  if v_audit::text like '%@%' then raise exception 'TEST FAILURE: the import audit row carries an address'; end if;
  if (v_audit ->> 'inserted')::int is distinct from 5 then raise exception 'TEST FAILURE: audit inserted count is %', v_audit ->> 'inserted'; end if;

  begin
    perform admin_import_prospects(array['good@tnf.test', 'not an address'], 'msg-fixture-2', 'test');
    raise exception 'TEST FAILURE: a malformed import was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%malformed address%' then raise exception 'TEST FAILURE: wrong refusal for malformed import: %', sqlerrm; end if;
  end;
  select count(*) into v_n from prospects where email = 'good@tnf.test';
  if v_n <> 0 then raise exception 'TEST FAILURE: a rejected import still inserted a row'; end if;

  begin
    perform admin_import_prospects(array['c@tnf.test'], '  ', 'test');
    raise exception 'TEST FAILURE: an import with no source_ref was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%source_ref required%' then raise exception 'TEST FAILURE: wrong refusal for missing source: %', sqlerrm; end if;
  end;
end $$;

-- 6. Recruit recipients: prospects minus holders minus Anthony minus excluded.
do $$
declare
  v_set text;
begin
  select string_agg(recipient, ',' order by recipient) into v_set
    from admin_email_recipients('recruit_t') where recipient like '%@tnf.test';
  if v_set is null then raise exception 'TEST FAILURE: recruit set came back NULL'; end if;
  if v_set <> 'a@tnf.test,b@tnf.test,x@tnf.test' then
    raise exception 'TEST FAILURE: recruit set is [%]; a holder or Anthony leaked in, or a prospect dropped out', v_set;
  end if;

  perform admin_exclude_prospect('X@tnf.test', 'asked not to be contacted', 'test');
  select string_agg(recipient, ',' order by recipient) into v_set
    from admin_email_recipients('recruit_t') where recipient like '%@tnf.test';
  if v_set is distinct from 'a@tnf.test,b@tnf.test' then
    raise exception 'TEST FAILURE: an excluded prospect is still a recipient: [%]', v_set;
  end if;

  begin
    perform admin_exclude_prospect('nobody@tnf.test', 'reason', 'test');
    raise exception 'TEST FAILURE: excluded an address that is not a prospect';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a prospect%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_exclude_prospect('a@tnf.test', '   ', 'test');
    raise exception 'TEST FAILURE: excluded a prospect with no reason';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%reason is required%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 7. Claim: once per (event, recipient), only for a derived recipient, audited
--    in the same transaction.
do $$
declare
  v_id uuid;
  v_n int;
begin
  v_id := admin_email_claim('recruit_t', 'A@TNF.test', repeat('a', 64), 'test');
  if v_id is null then raise exception 'TEST FAILURE: claim returned NULL'; end if;
  select count(*) into v_n from audit_log where action = 'email_claim' and target_id = v_id::text;
  if v_n <> 1 then raise exception 'TEST FAILURE: the claim wrote % audit rows, expected 1', v_n; end if;
  if (select after from audit_log where action = 'email_claim' and target_id = v_id::text) is null then
    raise exception 'TEST FAILURE: the claim audit row has no after payload';
  end if;
  if (select after::text from audit_log where action = 'email_claim' and target_id = v_id::text) like '%@%' then
    raise exception 'TEST FAILURE: the claim audit row carries an address; audit_log is never rewritten';
  end if;

  begin
    perform admin_email_claim('recruit_t', 'a@tnf.test', repeat('b', 64), 'test');
    raise exception 'TEST FAILURE: a second claim for the same send was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already claimed%' then raise exception 'TEST FAILURE: wrong refusal for a double claim: %', sqlerrm; end if;
  end;

  begin
    perform admin_email_claim('recruit_t', 'nora@tnf.test', repeat('a', 64), 'test');
    raise exception 'TEST FAILURE: claimed an address the event does not derive';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a derived recipient%' then raise exception 'TEST FAILURE: wrong refusal for an underived address: %', sqlerrm; end if;
  end;

  begin
    perform admin_email_claim('recruit_t', 'x@tnf.test', repeat('a', 64), 'test');
    raise exception 'TEST FAILURE: claimed an excluded prospect';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a derived recipient%' then raise exception 'TEST FAILURE: wrong refusal for an excluded prospect: %', sqlerrm; end if;
  end;

  begin
    perform admin_email_claim('recruit_t', 'b@tnf.test', 'not-a-sha', 'test');
    raise exception 'TEST FAILURE: claimed with a malformed sha';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%rendered_sha%' then raise exception 'TEST FAILURE: wrong refusal for a bad sha: %', sqlerrm; end if;
  end;
end $$;

-- 8. Record: needs a claim, records the message id, idempotent on the same id,
--    refuses a different one, and records-but-flags a sha that differs.
do $$
declare
  v_s text;
  v_row email_sends;
begin
  begin
    perform admin_email_record_sent('recruit_t', 'b@tnf.test', 'msg-x', repeat('a', 64), 'test');
    raise exception 'TEST FAILURE: recorded a send that was never claimed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%no claim%' then raise exception 'TEST FAILURE: wrong refusal for an unclaimed record: %', sqlerrm; end if;
  end;

  v_s := admin_email_record_sent('recruit_t', 'a@tnf.test', 'msg-1', repeat('a', 64), 'test');
  if v_s is distinct from 'recorded' then raise exception 'TEST FAILURE: record returned %', v_s; end if;
  select * into v_row from email_sends where event_key = 'recruit_t' and recipient = 'a@tnf.test';
  if v_row.gmail_message_id is distinct from 'msg-1' or v_row.sent_at is null then
    raise exception 'TEST FAILURE: the message id or sent_at was not recorded';
  end if;

  v_s := admin_email_record_sent('recruit_t', 'a@tnf.test', 'msg-1', repeat('a', 64), 'test');
  if v_s is distinct from 'already_recorded' then raise exception 'TEST FAILURE: re-recording the same id returned %', v_s; end if;

  begin
    perform admin_email_record_sent('recruit_t', 'a@tnf.test', 'msg-2', repeat('a', 64), 'test');
    raise exception 'TEST FAILURE: overwrote a recorded message id';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already recorded%' then raise exception 'TEST FAILURE: wrong refusal for an overwrite: %', sqlerrm; end if;
  end;

  perform admin_email_claim('recruit_t', 'b@tnf.test', repeat('c', 64), 'test');
  v_s := admin_email_record_sent('recruit_t', 'b@tnf.test', 'msg-3', repeat('d', 64), 'test');
  if v_s is distinct from 'sha_mismatch' then raise exception 'TEST FAILURE: a differing sha returned %', v_s; end if;
  select * into v_row from email_sends where event_key = 'recruit_t' and recipient = 'b@tnf.test';
  if v_row.gmail_message_id is distinct from 'msg-3' then
    raise exception 'TEST FAILURE: a sha mismatch lost the message id; what left the building must be recorded';
  end if;
  if not exists (select 1 from audit_log where action = 'email_sent_sha_mismatch' and target_id = v_row.id::text) then
    raise exception 'TEST FAILURE: a sha mismatch wrote no audit row of its own';
  end if;
end $$;

-- 9. A claimed, unconfirmed send is reported and never claimable again.
do $$
declare
  v_n int;
begin
  perform admin_email_claim('holder_checkin_t', 'jane@tnf.test', repeat('e', 64), 'test');
  select count(*) into v_n from admin_email_unsent() where event_key = 'holder_checkin_t' and recipient = 'jane@tnf.test';
  if v_n is null or v_n <> 1 then raise exception 'TEST FAILURE: a claimed, unrecorded send is not reported'; end if;
  begin
    perform admin_email_claim('holder_checkin_t', 'jane@tnf.test', repeat('e', 64), 'test');
    raise exception 'TEST FAILURE: a claimed, unrecorded send could be claimed again, which is a double send';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%NOT confirmed sent%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 10. The batch: one snapshot, one item per derived recipient, in byte order.
do $$
declare
  v_b jsonb;
  v_n int;
  v_first text; v_second text;
begin
  v_b := admin_email_batch('holder_checkin_t');
  if v_b is null then raise exception 'TEST FAILURE: batch came back NULL'; end if;
  v_n := jsonb_array_length(v_b -> 'items');
  if v_n is distinct from (select count(*)::int from admin_email_recipients('holder_checkin_t')) then
    raise exception 'TEST FAILURE: the holder batch has % items, the recipient rule derives %', v_n,
      (select count(*) from admin_email_recipients('holder_checkin_t'));
  end if;
  if (v_b -> 'items' -> 0 -> 'holder') is null then raise exception 'TEST FAILURE: a holder batch item has no holder facts'; end if;
  v_first := v_b -> 'items' -> 0 ->> 'recipient';
  v_second := v_b -> 'items' -> 1 ->> 'recipient';
  if v_first is null or v_second is null or not (v_first collate "C" < v_second collate "C") then
    raise exception 'TEST FAILURE: batch items are not in byte order';
  end if;

  v_b := admin_email_batch('recruit_t');
  if (v_b -> 'items' -> 0 -> 'holder') is not null then
    raise exception 'TEST FAILURE: a recruit batch item carries holder facts';
  end if;
end $$;

-- 11. Replies: to an address on a participant row, holder or not, never to
--     Anthony, never to a stranger; the context carries every block's status.
do $$
declare
  v_n int;
  v_ctx jsonb;
begin
  select count(*) into v_n from admin_email_recipients('reply_t1_abc123') where recipient = 'nora@tnf.test';
  if v_n is null then raise exception 'TEST FAILURE: reply count came back NULL'; end if;
  if v_n <> 1 then raise exception 'TEST FAILURE: a participant with no block cannot be replied to (found %)', v_n; end if;
  select count(*) into v_n from admin_email_recipients('reply_t1_abc123') where recipient = 'jane-cc@tnf.test';
  if v_n <> 1 then raise exception 'TEST FAILURE: a cc address cannot be replied to'; end if;
  select count(*) into v_n from admin_email_recipients('reply_t1_abc123')
   where recipient in ('avd-primary@tnf.test', 'avd-work@tnf.test');
  if v_n <> 0 then raise exception 'TEST FAILURE: Anthony is in the reply set'; end if;
  select count(*) into v_n from admin_email_recipients('reply_t1_abc123') where recipient = 'stranger@tnf.test';
  if v_n <> 0 then raise exception 'TEST FAILURE: a stranger is in the reply set'; end if;

  v_ctx := admin_email_context('reply_t1_abc123', ' Nora@TNF.test ');
  if v_ctx is null then raise exception 'TEST FAILURE: reply context came back NULL'; end if;
  v_n := jsonb_array_length(v_ctx -> 'blocks');
  if v_n is null or v_n <> (select count(*)::int from blocks) then
    raise exception 'TEST FAILURE: the reply context carries % block statuses, not every block', v_n;
  end if;
  if (select count(*) from jsonb_array_elements(v_ctx -> 'blocks') e
       join blocks b on b.block_number = (e ->> 'block_number')::int and b.status = e ->> 'status') <> v_n then
    raise exception 'TEST FAILURE: a reply context block status disagrees with the blocks table';
  end if;
  if v_ctx::text like '%comped%' then raise exception 'TEST FAILURE: the comp flag reached a reply context'; end if;

  begin
    perform admin_email_context('reply_t1_abc123', 'stranger@tnf.test');
    raise exception 'TEST FAILURE: a reply context was built for a stranger';
  exception when others then
    if sqlerrm not like '%not on a participant row%' then raise exception 'TEST FAILURE: wrong refusal for stranger reply: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim('reply_t1_abc123', 'stranger@tnf.test', repeat('c', 64), 'test');
    raise exception 'TEST FAILURE: a reply to a stranger was claimed';
  exception when others then
    if sqlerrm not like '%not a derived recipient%' then raise exception 'TEST FAILURE: wrong refusal for stranger claim: %', sqlerrm; end if;
  end;
  perform admin_email_claim('reply_t1_abc123', 'nora@tnf.test', repeat('c', 64), 'test');
  begin
    perform admin_email_claim('reply_t1_abc123', 'nora@tnf.test', repeat('c', 64), 'test');
    raise exception 'TEST FAILURE: a second reply on the same thread was claimed';
  exception when others then
    if sqlerrm not like '%already claimed%' then raise exception 'TEST FAILURE: wrong refusal for second reply: %', sqlerrm; end if;
  end;
  -- A DIFFERENT template on the same thread, to the same or another address,
  -- is still a second reply on that thread.
  begin
    perform admin_email_claim('reply_t2_abc123', 'nora@tnf.test', repeat('c', 64), 'test');
    raise exception 'TEST FAILURE: T2 was claimed on a thread that already had T1';
  exception when others then
    if sqlerrm not like '%already replied on this thread%' then raise exception 'TEST FAILURE: wrong refusal for T2 after T1: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim('reply_t5_abc123', 'jane-cc@tnf.test', repeat('c', 64), 'test');
    raise exception 'TEST FAILURE: a second reply on the thread was claimed for another address';
  exception when others then
    if sqlerrm not like '%already replied on this thread%' then raise exception 'TEST FAILURE: wrong refusal for another address on the thread: %', sqlerrm; end if;
  end;
  -- The index holds even if the function's own check is bypassed.
  begin
    insert into email_sends (event_key, recipient, rendered_sha) values ('reply_t3_abc123', 'nora@tnf.test', repeat('c', 64));
    raise exception 'TEST FAILURE: the table accepted a second reply row for the thread';
  exception when unique_violation then null;
  end;
  -- Another thread is a new reply.
  if admin_email_claim('reply_t1_def456', 'nora@tnf.test', repeat('c', 64), 'test') is null then
    raise exception 'TEST FAILURE: a reply on a different thread was refused';
  end if;
end $$;

-- 12. No email address in any audit row the send ledger writes. audit_log is
--     never rewritten, so an address written there is there for good; the
--     email_sends row (admin-only, RLS) is where the address lives.
do $$
declare
  v_claim int; v_sent int; v_mismatch int; v_leak int;
begin
  select count(*) filter (where action = 'email_claim'),
         count(*) filter (where action = 'email_sent'),
         count(*) filter (where action = 'email_sent_sha_mismatch'),
         count(*) filter (where after::text like '%@%' or coalesce(before::text, '') like '%@%')
    into v_claim, v_sent, v_mismatch, v_leak
    from audit_log where action in ('email_claim', 'email_sent', 'email_sent_sha_mismatch');
  if v_claim is null or v_claim = 0 or v_sent = 0 or v_mismatch = 0 then
    raise exception 'TEST FAILURE: the suite did not exercise every ledger audit action (claim %, sent %, mismatch %)', v_claim, v_sent, v_mismatch;
  end if;
  if v_leak <> 0 then raise exception 'TEST FAILURE: % ledger audit rows carry an address', v_leak; end if;
end $$;

rollback;
