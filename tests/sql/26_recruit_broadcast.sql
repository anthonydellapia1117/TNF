-- Migration 37: the recruit broadcast (Anthony, 2026-10-13, G4).
--
-- Every expected number here is computed from the tables directly, never
-- through email_recruit_broadcast_addresses(), so a broken classifier fails
-- this suite instead of agreeing with itself.
--
-- Mutation checks (CLAUDE.md: re-verify, not just re-run): make the plan count
-- an excluded holder in Bcc, stop classifying a blocklisted address, drop the
-- exact-override check, drop the blocklist check on To, or stop minting a
-- claim_id, and sections 2, 2b, 4, 6 and 7 raise. Make the classifier drop
-- an owner's alt only when it is a holder's, and section 2 raises on the
-- prospect alt. If any still passes, its assertion is dead.

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Fixtures. Owners as the live table on 2026-10-13: every code but DN has an
-- address. Prospects: six plain, Anthony's own (his row is kept on the live
-- table too), one that is also a holder, and one excluded that is a holder's
-- cc. A holder whose cc is an owner's alt address. An active prospect that is
-- an owner's alt address: MAP's second address, as on the live table since
-- 2026-10-14 (Anthony), gets no Bcc copy.
update owners set email = lower(code) || '@tnf.test', alt_email = null;
update owners set email = 'avd-primary@tnf.test', alt_email = 'avd-alt@tnf.test' where code = 'AVD';
update owners set alt_email = 'rm-alt@tnf.test' where code = 'RM';
update owners set alt_email = 'map-alt@tnf.test' where code = 'MAP';
update owners set email = null where code = 'DN';

do $$
declare
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  perform admin_import_prospects(
    array['p1@tnf.test', 'p2@tnf.test', 'p3@tnf.test', 'p4@tnf.test', 'p5@tnf.test', 'p6@tnf.test',
          'avd-primary@tnf.test', 'both@tnf.test', 'excluded-cc@tnf.test', 'map-alt@tnf.test'],
    'msg-fixture-broadcast', 'test');
  perform admin_exclude_prospect('excluded-cc@tnf.test', 'fixture: excluded from the recruit send', 'test');

  insert into participants (full_name, email, owner_group, blocks_requested) values ('Both Holder', 'both@tnf.test', 'AVD', 1) returning id into v_a;
  insert into participants (full_name, email, cc_email, owner_group, blocks_requested) values ('Cc Excluded', 'own-cc@tnf.test', 'excluded-cc@tnf.test', 'AVD', 1) returning id into v_b;
  insert into participants (full_name, email, cc_email, owner_group, blocks_requested) values ('Alt Cc', 'alt-holder@tnf.test', 'rm-alt@tnf.test', 'RM', 1) returning id into v_c;
  update blocks set participant_id = v_a, status = 'reserved' where block_number = (select min(block_number) from blocks where status = 'available');
  update blocks set participant_id = v_b, status = 'reserved' where block_number = (select min(block_number) from blocks where status = 'available');
  update blocks set participant_id = v_c, status = 'reserved' where block_number = (select min(block_number) from blocks where status = 'available');
end $$;

-- 1. Admin-only, and only for a broadcast key.
do $$
begin
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_email_broadcast_plan('recruit_broadcast_2026-10-13');
    raise exception 'TEST FAILURE: a non-admin read the plan';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', repeat('a', 64), array['DN'], 1, 1000, 'test');
    raise exception 'TEST FAILURE: a non-admin claimed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
  if has_function_privilege('anon', 'admin_email_claim_broadcast(text,text,text[],int,int,text)', 'execute') then
    raise exception 'TEST FAILURE: anon can execute admin_email_claim_broadcast';
  end if;
  if has_function_privilege('authenticated', 'email_recruit_broadcast_addresses()', 'execute') then
    raise exception 'TEST FAILURE: a client role can call the internal classifier';
  end if;
  begin
    perform admin_email_broadcast_plan('recruit_2026-10-13');
    raise exception 'TEST FAILURE: a per-recipient key got a broadcast plan';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
  end;
end $$;

-- 2. The arithmetic, against first principles: P + H - O - T - X = Bcc.
do $$
declare
  v jsonb := admin_email_broadcast_plan('recruit_broadcast_2026-10-13');
  e_p int; e_h int; e_o int; e_t int; e_x int; e_bcc int;
begin
  with p as (select email a from prospects where excluded_at is null),
       h as (select distinct lower(btrim(x)) a
               from participants pp join blocks b on b.participant_id = pp.id and b.status in ('reserved', 'assigned'),
                    unnest(array[pp.email, pp.cc_email]) x
              where nullif(btrim(x), '') is not null),
       u as (select a from p union select a from h),
       t as (select lower(btrim(email)) a from owners where email is not null),
       never as (select lower(btrim(alt_email)) a from owners where alt_email is not null
                 union select email from prospects where excluded_at is not null)
  select (select count(*) from p), (select count(*) from h),
         (select count(*) from p where a in (select a from h)),
         (select count(*) from u where a in (select a from t)),
         (select count(*) from u where a not in (select a from t) and a in (select a from never)),
         (select count(*) from u where a not in (select a from t) and a not in (select a from never))
    into e_p, e_h, e_o, e_t, e_x, e_bcc;

  if v is null or (v ->> 'bcc_count') is null then raise exception 'TEST FAILURE: the plan came back NULL'; end if;
  if (v->>'p')::int <> e_p or (v->>'h')::int <> e_h or (v->>'o')::int <> e_o
     or (v->>'t')::int <> e_t or (v->>'x')::int <> e_x or (v->>'bcc_count')::int <> e_bcc then
    raise exception 'TEST FAILURE: plan % differs from first principles p % h % o % t % x % bcc %', v, e_p, e_h, e_o, e_t, e_x, e_bcc;
  end if;
  if e_p + e_h - e_o - e_t - e_x <> e_bcc then raise exception 'TEST FAILURE: the identity does not hold in the fixture'; end if;
  if e_t < 1 or e_x < 3 then raise exception 'TEST FAILURE: the fixture no longer exercises T and X (t %, x %)', e_t, e_x; end if;
  if not exists (select 1 from prospects where email = 'map-alt@tnf.test' and excluded_at is null) then
    raise exception 'TEST FAILURE: the fixture lost the active prospect that is an owner''s alt';
  end if;
  if jsonb_array_length(v -> 'bcc') <> e_bcc then raise exception 'TEST FAILURE: the Bcc list is not its count'; end if;
  if jsonb_array_length(v -> 'to') <> 9 then raise exception 'TEST FAILURE: To is % addresses, not 9', jsonb_array_length(v -> 'to'); end if;
  if v -> 'omitted_owners' <> '["DN"]'::jsonb then raise exception 'TEST FAILURE: omitted owners %', v -> 'omitted_owners'; end if;
  if (v -> 'bcc') ?| array['avd-primary@tnf.test', 'avd-alt@tnf.test', 'rm-alt@tnf.test', 'map-alt@tnf.test', 'excluded-cc@tnf.test', 'rm@tnf.test'] then
    raise exception 'TEST FAILURE: Bcc carries Anthony, an owner, an alt or an excluded address';
  end if;
  if not ((v -> 'bcc') ?& array['p1@tnf.test', 'both@tnf.test', 'own-cc@tnf.test', 'alt-holder@tnf.test']) then
    raise exception 'TEST FAILURE: Bcc is missing a prospect or a holder';
  end if;
end $$;

-- 2b. A blocklisted address in P or H counts in X and never reaches Bcc. The
--     hash is inserted directly, past admin_block_address_hash's clean-first
--     rule, to stand for a row that went wrong some other way; the block is
--     undone by raising to the end of the DO.
do $$
declare
  before_plan jsonb := admin_email_broadcast_plan('recruit_broadcast_2026-10-13');
  after_plan jsonb;
begin
  insert into blocked_address_hashes (hash, reason) values (encode(sha256(convert_to('p6@tnf.test', 'UTF8')), 'hex'), 'fixture');
  after_plan := admin_email_broadcast_plan('recruit_broadcast_2026-10-13');
  if (after_plan ->> 'x')::int <> (before_plan ->> 'x')::int + 1
     or (after_plan ->> 'bcc_count')::int <> (before_plan ->> 'bcc_count')::int - 1 then
    raise exception 'TEST FAILURE: a blocklisted prospect did not move from Bcc to X (before %, after %)', before_plan, after_plan;
  end if;
  if (after_plan -> 'bcc') ? 'p6@tnf.test' then
    raise exception 'TEST FAILURE: a blocklisted prospect is in Bcc';
  end if;
  raise exception 'drop the fixture hash';
exception when others then
  if sqlerrm like 'TEST FAILURE%' then raise; end if;
  if sqlerrm <> 'drop the fixture hash' then raise; end if;
end $$;

-- 3. The per-recipient ledger rule knows the broadcast: To plus Bcc, nothing else.
do $$
declare
  v jsonb := admin_email_broadcast_plan('recruit_broadcast_2026-10-13');
  n int;
begin
  select count(*) into n from admin_email_recipients('recruit_broadcast_2026-10-13');
  if n <> 9 + (v ->> 'bcc_count')::int then raise exception 'TEST FAILURE: recipients % for To 9 plus Bcc %', n, v ->> 'bcc_count'; end if;
  if exists (select 1 from admin_email_recipients('recruit_broadcast_2026-10-13') r where r.recipient = 'excluded-cc@tnf.test') then
    raise exception 'TEST FAILURE: an excluded address is a derived recipient';
  end if;
  -- The per-recipient recruit rule is untouched: holders are still out of it.
  if exists (select 1 from admin_email_recipients('recruit_2026-10-13') r where r.recipient = 'both@tnf.test') then
    raise exception 'TEST FAILURE: the per-recipient recruit now reaches a holder';
  end if;
end $$;

-- 4. The claim refuses rather than sending short or wide.
do $$
declare
  sha text := repeat('b', 64);
begin
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', sha, '{}', 1, 1000, 'test');
    raise exception 'TEST FAILURE: claimed with an owner unnamed and no address';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%owners with no address are {DN}%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', sha, array['DN', 'RM'], 1, 1000, 'test');
    raise exception 'TEST FAILURE: the override left off an owner with an address';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%override names {DN,RM}%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', sha, array['DN'], 1000, 2000, 'test');
    raise exception 'TEST FAILURE: claimed outside the Bcc range';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%Bcc is %, outside 1000 to 2000%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('recruit_2026-10-13', sha, array['DN'], 1, 1000, 'test');
    raise exception 'TEST FAILURE: a per-recipient key was claimed as a broadcast';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
  end;
  if exists (select 1 from email_sends where event_key = 'recruit_broadcast_2026-10-13') then
    raise exception 'TEST FAILURE: a refused claim left rows behind';
  end if;
end $$;

-- 5. Defence in depth: if the plan ever let an owner's address into Bcc, the
--    claim refuses. Simulated by breaking the classifier inside this
--    transaction; the rollback puts it back.
do $$
begin
  execute $f$
    create or replace function email_recruit_broadcast_addresses()
    returns table (address text, active_prospect boolean, holder boolean, on_to boolean, excluded text)
    language sql stable set search_path = public, pg_temp
    as $b$ select 'rm-alt@tnf.test'::text, true, false, false, null::text $b$
  $f$;
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', repeat('c', 64), array['DN'], 1, 1000, 'test');
    raise exception 'TEST FAILURE: an owner address in Bcc was claimed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%owner address is in Bcc%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  raise exception 'restore the classifier';
exception when others then
  if sqlerrm like 'TEST FAILURE%' then raise; end if;
  if sqlerrm <> 'restore the classifier' then raise; end if;
end $$;

-- 6. A To address on the blocklist refuses the claim. The hash is inserted
--    directly, past admin_block_address_hash's clean-first rule, to stand for a
--    row that went wrong some other way.
do $$
begin
  insert into blocked_address_hashes (hash, reason) values (encode(sha256(convert_to('bg@tnf.test', 'UTF8')), 'hex'), 'fixture');
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', repeat('d', 64), array['DN'], 1, 1000, 'test');
    raise exception 'TEST FAILURE: a blocklisted To address was claimed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%blocked_address_hashes%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  raise exception 'drop the fixture hash';
exception when others then
  if sqlerrm like 'TEST FAILURE%' then raise; end if;
  if sqlerrm <> 'drop the fixture hash' then raise; end if;
end $$;

-- 7. The claim: every recipient ledgered once, the envelope md5 the command
--    computes, one summary audit row and one per owner left off, no address in
--    any audit payload; a second claim refuses.
do $$
declare
  sha text := repeat('e', 64);
  v jsonb := admin_email_broadcast_plan('recruit_broadcast_2026-10-13');
  r jsonb;
  e_md5 text;
begin
  r := admin_email_claim_broadcast('recruit_broadcast_2026-10-13', sha, array[' dn '], 1, 1000, 'test');
  select md5(
           (select string_agg(lower(btrim(email)), ',' order by lower(btrim(email)) collate "C") from owners where email is not null)
           || '|' ||
           (select string_agg(x, ',' order by x collate "C") from jsonb_array_elements_text(v -> 'bcc') x))
    into e_md5;
  if r ->> 'envelope_md5' is distinct from e_md5 then raise exception 'TEST FAILURE: envelope md5 % expected %', r ->> 'envelope_md5', e_md5; end if;
  -- The one value the dry run can never print: minted by the claim, kept on its audit row.
  if coalesce(r ->> 'claim_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'TEST FAILURE: the claim returned no claim_id: %', r;
  end if;
  if (select count(*) from audit_log where action = 'email_claim_broadcast' and after ->> 'claim_id' = r ->> 'claim_id') <> 1 then
    raise exception 'TEST FAILURE: the claim_id is not on the claim audit row';
  end if;
  if (r ->> 'claimed')::int <> 9 + (v ->> 'bcc_count')::int then raise exception 'TEST FAILURE: claimed %', r ->> 'claimed'; end if;
  if (select count(*) from email_sends where event_key = 'recruit_broadcast_2026-10-13' and rendered_sha = sha and sent_at is null)
     <> (r ->> 'claimed')::int then
    raise exception 'TEST FAILURE: the ledger does not hold every recipient once';
  end if;
  if (select count(*) from audit_log where action = 'email_claim_broadcast' and target_id = 'recruit_broadcast_2026-10-13') <> 1 then
    raise exception 'TEST FAILURE: no single claim audit row';
  end if;
  if (select count(*) from audit_log where action = 'broadcast_owner_omitted' and target_table = 'owners' and target_id = 'DN'
        and after ->> 'event_key' = 'recruit_broadcast_2026-10-13') <> 1 then
    raise exception 'TEST FAILURE: no audit row for DN left off';
  end if;
  if exists (select 1 from audit_log where action in ('email_claim_broadcast', 'broadcast_owner_omitted')
               and (coalesce(after::text, '') || coalesce(note, '')) like '%@%') then
    raise exception 'TEST FAILURE: an audit row carries an address';
  end if;
  begin
    perform admin_email_claim_broadcast('recruit_broadcast_2026-10-13', sha, array['DN'], 1, 1000, 'test');
    raise exception 'TEST FAILURE: the broadcast was claimed twice';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already claimed%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 8. Recording the one message: every row at once, idempotent for the same
--    id, refused for another.
do $$
declare
  r jsonb;
  n int;
begin
  begin
    perform admin_email_record_sent_broadcast('recruit_broadcast_2026-10-14', 'msg-none', repeat('e', 64), 'test');
    raise exception 'TEST FAILURE: recorded a broadcast that was never claimed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%no claim%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  r := admin_email_record_sent_broadcast('recruit_broadcast_2026-10-13', 'msg-broadcast-1', repeat('e', 64), 'test');
  select count(*) into n from email_sends where event_key = 'recruit_broadcast_2026-10-13';
  if r ->> 'status' <> 'recorded' or (r ->> 'rows')::int <> n then raise exception 'TEST FAILURE: record returned %', r; end if;
  if exists (select 1 from email_sends where event_key = 'recruit_broadcast_2026-10-13'
               and (gmail_message_id is distinct from 'msg-broadcast-1' or sent_at is null)) then
    raise exception 'TEST FAILURE: a row was left unrecorded';
  end if;
  if (select count(*) from audit_log where action = 'email_sent_broadcast' and target_id = 'recruit_broadcast_2026-10-13') <> 1 then
    raise exception 'TEST FAILURE: no single send audit row';
  end if;
  r := admin_email_record_sent_broadcast('recruit_broadcast_2026-10-13', 'msg-broadcast-1', repeat('e', 64), 'test');
  if r ->> 'status' <> 'already_recorded' then raise exception 'TEST FAILURE: a repeat record returned %', r; end if;
  begin
    perform admin_email_record_sent_broadcast('recruit_broadcast_2026-10-13', 'msg-broadcast-2', repeat('e', 64), 'test');
    raise exception 'TEST FAILURE: a second message id was recorded';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already recorded with message msg-broadcast-1%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

rollback;
