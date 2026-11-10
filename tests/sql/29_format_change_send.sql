-- Migration 41: the format email through the broadcast path (Anthony,
-- 2026-11-10, Part L). To Anthony alone, Cc every other owner with an
-- address, Bcc every holder address minus To, Cc, owners' alts and the
-- blocklist. No prospect, no participant without a block. The claim needs the
-- approval and keeps it on its audit row.
--
-- Every expected number is computed from the tables directly, never through
-- email_format_change_addresses(), so a broken classifier fails here instead
-- of agreeing with itself.
--
-- Mutation checks, each verified to raise: let a prospect into the holder set
-- (section 2); stop dropping owners' alts (2); put the owners on To instead of
-- Cc (2); drop the approval requirement (3); drop the non-holder Bcc guard
-- (5); hash the envelope without the Cc (6); drop the format key from the
-- record (7).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Fixtures. Owners as the live table on 2026-11-10: every code but DN has an
-- address, MAP has an alt. Every seed holder released, so the holder set is:
--   h1, with a cc address;
--   an owner's primary holding a block (RM): on Cc, never Bcc;
--   an owner's alt holding a block (MAP's): out;
--   Anthony's own holding: on To;
--   a holder whose address was excluded from recruiting: still a holder.
-- Not holders: a prospect, and a participant with no block.
update owners set email = lower(code) || '@tnf.test', alt_email = null;
update owners set email = 'avd-primary@tnf.test' where code = 'AVD';
update owners set alt_email = 'map-alt@tnf.test' where code = 'MAP';
update owners set email = null where code = 'DN';

do $$
declare
  r record;
  v_p uuid;
  v_open int;
begin
  for r in select block_number from blocks where participant_id is not null loop
    perform admin_release_block(r.block_number, 'fx');
  end loop;
  perform admin_import_prospects(array['p1@tnf.test', 'h5@tnf.test'], 'msg-fixture-format', 'test');
  perform admin_exclude_prospect('h5@tnf.test', 'fixture: excluded from recruiting', 'test');
  insert into participants (full_name, email, owner_group, blocks_requested) values ('No Block', 'np@tnf.test', 'AVD', 0);
  for r in select * from (values ('H1', 'h1@tnf.test', 'h1cc@tnf.test'), ('Owner RM', 'rm@tnf.test', null),
                                 ('Alt Holder', 'map-alt@tnf.test', null), ('Anthony', 'avd-primary@tnf.test', null),
                                 ('Excluded Prospect', 'h5@tnf.test', null)) t(n, e, cc) loop
    insert into participants (full_name, email, cc_email, owner_group, blocks_requested)
    values (r.n, r.e, r.cc, 'AVD', 1) returning id into v_p;
    select min(block_number) into v_open from blocks where status = 'available';
    perform admin_reserve_blocks(array[v_open], v_p, 'admin', 'fx', 'fx');
  end loop;
end $$;

-- 1. Admin-only; the seven-argument claim is not open to anon; the
--    classifier is internal.
do $$
begin
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_email_broadcast_plan('format_change_2026-11-10');
    raise exception 'TEST FAILURE: a non-admin read the plan';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
  if has_function_privilege('anon', 'admin_email_claim_broadcast(text,text,text[],int,int,text,text)', 'execute') then
    raise exception 'TEST FAILURE: anon can execute the seven-argument claim';
  end if;
  if has_function_privilege('authenticated', 'email_format_change_addresses()', 'execute') then
    raise exception 'TEST FAILURE: a client role can call the internal classifier';
  end if;
  begin
    perform admin_email_broadcast_plan('format_change_soon');
    raise exception 'TEST FAILURE: an undated key got a plan';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%no broadcast plan%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 2. The plan, against first principles: H - T - X = Bcc, P and O zero.
do $$
declare
  v jsonb := admin_email_broadcast_plan('format_change_2026-11-10');
  e_h int;
  e_bcc text[];
  e_cc text[];
begin
  select count(distinct a) into e_h
    from (select lower(btrim(p.email)) a from participants p where exists (select 1 from blocks b where b.participant_id = p.id) and p.email is not null
          union all
          select lower(btrim(p.cc_email)) from participants p where exists (select 1 from blocks b where b.participant_id = p.id) and p.cc_email is not null) x;
  e_bcc := array['h1@tnf.test', 'h1cc@tnf.test', 'h5@tnf.test'];
  e_cc := array['bg@tnf.test', 'ejd@tnf.test', 'gd@tnf.test', 'jpod@tnf.test', 'map@tnf.test', 'nl@tnf.test', 'rm@tnf.test', 'tja@tnf.test'];
  if v is null then raise exception 'TEST FAILURE: no plan'; end if;
  if (v ->> 'p')::int is distinct from 0 or (v ->> 'o')::int is distinct from 0
     or (v ->> 'h')::int is distinct from e_h or e_h <> 6
     or (v ->> 't')::int is distinct from 2 or (v ->> 'x')::int is distinct from 1
     or (v ->> 'bcc_count')::int is distinct from 3 then
    raise exception 'TEST FAILURE: arithmetic %', v - 'bcc' - 'cc' - 'to';
  end if;
  if array(select jsonb_array_elements_text(v -> 'bcc')) is distinct from e_bcc then
    raise exception 'TEST FAILURE: Bcc %', v -> 'bcc';
  end if;
  if array(select jsonb_array_elements_text(v -> 'to')) is distinct from array['avd-primary@tnf.test'] then
    raise exception 'TEST FAILURE: To %', v -> 'to';
  end if;
  if array(select jsonb_array_elements_text(v -> 'cc')) is distinct from e_cc then
    raise exception 'TEST FAILURE: Cc %', v -> 'cc';
  end if;
  if v -> 'omitted_owners' is distinct from '["DN"]'::jsonb then
    raise exception 'TEST FAILURE: omitted %', v -> 'omitted_owners';
  end if;
end $$;

-- 3. The claim refuses without the approval, through either signature, and on
--    a wrong override; a refused claim leaves no row.
do $$
declare
  sha text := repeat('a', 64);
begin
  begin
    perform admin_email_claim_broadcast('format_change_2026-11-10', sha, array['DN'], 1, 100, 'test');
    raise exception 'TEST FAILURE: claimed with no approval (six arguments)';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%needs the approval%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('format_change_2026-11-10', sha, array['DN'], 1, 100, 'test', '  ');
    raise exception 'TEST FAILURE: claimed with a blank approval';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%needs the approval%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('format_change_2026-11-10', sha, '{}', 1, 100, 'test', 'fixture approval');
    raise exception 'TEST FAILURE: claimed with DN unnamed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%owners with no address are {DN}%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  if exists (select 1 from email_sends where event_key = 'format_change_2026-11-10') then
    raise exception 'TEST FAILURE: a refused claim left rows behind';
  end if;
end $$;

-- 5. Defence in depth: if the classifier ever let a non-holder into Bcc, the
--    claim refuses. Simulated inside a block that rolls back.
do $$
begin
  execute $f$
    create or replace function email_format_change_addresses()
    returns table (address text, active_prospect boolean, holder boolean, on_to boolean, excluded text)
    language sql stable set search_path = public, pg_temp
    as $b$ select 'p1@tnf.test'::text, false, true, false, null::text $b$
  $f$;
  begin
    perform admin_email_claim_broadcast('format_change_2026-11-10', repeat('b', 64), array['DN'], 1, 100, 'test', 'fixture approval');
    raise exception 'TEST FAILURE: a non-holder in Bcc was claimed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a holder%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  raise exception 'restore the classifier';
exception when others then
  if sqlerrm like 'TEST FAILURE%' then raise; end if;
  if sqlerrm <> 'restore the classifier' then raise; end if;
end $$;

-- 6. The claim: To 1, Cc 8, Bcc 3, every one ledgered once; the md5 is
--    to | cc | bcc; the approval on the audit row; no address in any audit
--    payload; a second claim refuses.
do $$
declare
  sha text := repeat('c', 64);
  v jsonb := admin_email_broadcast_plan('format_change_2026-11-10');
  r jsonb;
  e_md5 text;
begin
  r := admin_email_claim_broadcast('format_change_2026-11-10', sha, array[' dn '], 3, 3, 'test',
                                   'Anthony approved this send at 12:38 PM ET in the TNF PM chat');
  if (r ->> 'to')::int is distinct from 1 or (r ->> 'cc')::int is distinct from 8
     or (r ->> 'bcc')::int is distinct from 3 or (r ->> 'claimed')::int is distinct from 12 then
    raise exception 'TEST FAILURE: claim returned %', r;
  end if;
  select md5('avd-primary@tnf.test' || '|' ||
             (select string_agg(x, ',' order by x collate "C") from jsonb_array_elements_text(v -> 'cc') x) || '|' ||
             (select string_agg(x, ',' order by x collate "C") from jsonb_array_elements_text(v -> 'bcc') x))
    into e_md5;
  if r ->> 'envelope_md5' is distinct from e_md5 then
    raise exception 'TEST FAILURE: envelope md5 % expected %', r ->> 'envelope_md5', e_md5;
  end if;
  if (select count(*) from email_sends where event_key = 'format_change_2026-11-10' and rendered_sha = sha and sent_at is null) <> 12
     or (select count(distinct recipient) from email_sends where event_key = 'format_change_2026-11-10') <> 12
     or exists (select 1 from email_sends where event_key = 'format_change_2026-11-10'
                  and recipient in ('p1@tnf.test', 'np@tnf.test', 'map-alt@tnf.test')) then
    raise exception 'TEST FAILURE: the ledger is not exactly the twelve';
  end if;
  if (select count(*) from audit_log where action = 'email_claim_broadcast' and target_id = 'format_change_2026-11-10'
        and after ->> 'approval' = 'Anthony approved this send at 12:38 PM ET in the TNF PM chat'
        and note = 'Anthony approved this send at 12:38 PM ET in the TNF PM chat'
        and (after ->> 'cc')::int = 8 and after ->> 'claim_id' = r ->> 'claim_id') <> 1 then
    raise exception 'TEST FAILURE: the claim audit row does not carry the approval';
  end if;
  if (select count(*) from audit_log where action = 'broadcast_owner_omitted' and target_id = 'DN'
        and after ->> 'event_key' = 'format_change_2026-11-10' and note like '%left off Cc%') <> 1 then
    raise exception 'TEST FAILURE: no audit row for DN left off Cc';
  end if;
  if exists (select 1 from audit_log where action in ('email_claim_broadcast', 'broadcast_owner_omitted')
               and (coalesce(after::text, '') || coalesce(note, '')) like '%@%') then
    raise exception 'TEST FAILURE: an audit row carries an address';
  end if;
  begin
    perform admin_email_claim_broadcast('format_change_2026-11-10', sha, array['DN'], 3, 3, 'test', 'again');
    raise exception 'TEST FAILURE: claimed twice';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already claimed%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 7. Recording the one message: all twelve rows at once; refused for another id.
do $$
declare
  r jsonb;
begin
  r := admin_email_record_sent_broadcast('format_change_2026-11-10', 'msg-format-1', repeat('c', 64), 'test');
  if r ->> 'status' is distinct from 'recorded' or (r ->> 'rows')::int is distinct from 12 then
    raise exception 'TEST FAILURE: record returned %', r;
  end if;
  if exists (select 1 from email_sends where event_key = 'format_change_2026-11-10'
               and (gmail_message_id is distinct from 'msg-format-1' or sent_at is null)) then
    raise exception 'TEST FAILURE: a row was left unrecorded';
  end if;
  begin
    perform admin_email_record_sent_broadcast('format_change_2026-11-10', 'msg-format-2', repeat('c', 64), 'test');
    raise exception 'TEST FAILURE: a second message id was recorded';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already recorded with message msg-format-1%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

rollback;
