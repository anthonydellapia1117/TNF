-- Migration 42: the game-day pack leaves an owner with no address off To, on
-- the record (Anthony, 2026-11-20, Part M). admin_email_omit_owners makes the
-- claim's check (the override names exactly the owners with no address, never
-- AVD) and writes the claim's broadcast_owner_omitted row, once per owner per
-- game, and nothing else: no email_sends row, no other audit row.
--
-- Mutation checks, each verified to raise: accept a non-game-day key (1);
-- accept a game that does not exist (1); accept an empty override (2);
-- drop the exact-match check (2); let AVD be named (2); drop the per-game
-- idempotency (3); write the row with no event_key (3); write an email_sends
-- row (4).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Owners as the live table on 2026-11-20: every code but DN has an address.
update owners set email = lower(code) || '@tnf.test', alt_email = null;
update owners set email = null where code = 'DN';

create temp table t_before as
select (select count(*) from audit_log) as audit_n, (select count(*) from email_sends) as sends_n;

-- 1. Admin-only, not open to anon, and only for a game-day draft of a real game.
do $$
begin
  if has_function_privilege('anon', 'admin_email_omit_owners(text,text[],text)', 'execute') then
    raise exception 'TEST FAILURE: anon can execute admin_email_omit_owners';
  end if;
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_email_omit_owners('game_day_g01', array['DN'], 'test');
    raise exception 'TEST FAILURE: a non-admin wrote an omission';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
  begin
    perform admin_email_omit_owners('recruit_broadcast_2026-11-20', array['DN'], 'test');
    raise exception 'TEST FAILURE: a sent broadcast key was accepted without its claim';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a game-day draft%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_omit_owners('format_change_2026-11-10', array['DN'], 'test');
    raise exception 'TEST FAILURE: the format key was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not a game-day draft%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_omit_owners('game_day_g99', array['DN'], 'test');
    raise exception 'TEST FAILURE: a game that does not exist was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%no game 99%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_omit_owners('game_day_g01', array['DN'], '  ');
    raise exception 'TEST FAILURE: a blank actor was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%actor required%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 2. The override names exactly the owners with no address, never AVD, never
--    nobody.
do $$
begin
  begin
    perform admin_email_omit_owners('game_day_g01', '{}', 'test');
    raise exception 'TEST FAILURE: an empty override was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%nothing to omit%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_omit_owners('game_day_g01', array['DN', 'RM'], 'test');
    raise exception 'TEST FAILURE: an owner with an address was left off';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%owners with no address are {DN}; the override names {DN,RM}%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_omit_owners('game_day_g01', array['AVD', 'DN'], 'test');
    raise exception 'TEST FAILURE: AVD was left off';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%Anthony is never left off%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  -- Two owners blank, one named: refused, and naming both is what passes.
  update owners set email = null where code = 'TJA';
  begin
    perform admin_email_omit_owners('game_day_g01', array['DN'], 'test');
    raise exception 'TEST FAILURE: a second blank owner went unnamed';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%owners with no address are {DN,TJA}; the override names {DN}%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  update owners set email = 'tja@tnf.test' where code = 'TJA';
  -- DN with an address: naming him is refused.
  update owners set email = 'dn@tnf.test' where code = 'DN';
  begin
    perform admin_email_omit_owners('game_day_g01', array['DN'], 'test');
    raise exception 'TEST FAILURE: an owner with an address was named';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%owners with no address are {}; the override names {DN}%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  update owners set email = null where code = 'DN';
  if (select count(*) from audit_log) <> (select audit_n from t_before) then
    raise exception 'TEST FAILURE: a refusal wrote an audit row';
  end if;
end $$;

-- 3. One row per owner per game: the first call writes it, a retry writes
--    nothing, another game gets its own. Case and spacing normalise.
do $$
declare
  v jsonb;
  n int;
begin
  v := admin_email_omit_owners('game_day_g01', array[' dn '], 'tnf-game-day');
  if v -> 'omitted_owners' is distinct from '["DN"]'::jsonb or v -> 'written' is distinct from '["DN"]'::jsonb then
    raise exception 'TEST FAILURE: first call returned %', v;
  end if;
  select count(*) into n from audit_log
   where action = 'broadcast_owner_omitted' and target_table = 'owners' and target_id = 'DN'
     and actor = 'tnf-game-day' and after ->> 'event_key' = 'game_day_g01'
     and (after ->> 'draft')::boolean and note like '%left off To on this game-day draft%';
  if n <> 1 then raise exception 'TEST FAILURE: % rows for g01 after one call', n; end if;

  v := admin_email_omit_owners('game_day_g01', array['DN'], 'tnf-game-day');
  if v -> 'written' is distinct from '[]'::jsonb then
    raise exception 'TEST FAILURE: the retry wrote %', v -> 'written';
  end if;
  select count(*) into n from audit_log
   where action = 'broadcast_owner_omitted' and after ->> 'event_key' = 'game_day_g01';
  if n <> 1 then raise exception 'TEST FAILURE: % rows for g01 after a retry', n; end if;

  v := admin_email_omit_owners('game_day_g02', array['DN'], 'tnf-game-day');
  if v -> 'written' is distinct from '["DN"]'::jsonb then
    raise exception 'TEST FAILURE: g02 got no row of its own: %', v;
  end if;
end $$;

-- 4. Nothing else moved: two audit rows in all, no email_sends row.
do $$
begin
  if (select count(*) from audit_log) - (select audit_n from t_before) <> 2 then
    raise exception 'TEST FAILURE: % audit rows written, expected 2',
      (select count(*) from audit_log) - (select audit_n from t_before);
  end if;
  if (select count(*) from email_sends) <> (select sends_n from t_before) then
    raise exception 'TEST FAILURE: an omission wrote to email_sends';
  end if;
  if exists (select 1 from audit_log where action = 'broadcast_owner_omitted'
               and after ->> 'event_key' like 'game_day_%' and target_id <> 'DN') then
    raise exception 'TEST FAILURE: an owner other than DN was recorded';
  end if;
end $$;

rollback;
