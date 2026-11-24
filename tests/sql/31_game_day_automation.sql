-- Migration 43: Thanksgiving game-day automation (Anthony, 2026-11-23, Part N).
-- Draw per day with fresh randomness and publish at once; a drawn game is
-- never redrawn; the digits hash rides on every draw row and is re-checked;
-- the lock refuses every change but Anthony's audited override; the three
-- game-day emails are To Anthony, Cc RM and MAP, Bcc holders, and refuse to
-- go when their content is not ready.
--
-- Kickoffs are placed relative to this transaction's now(): "later today" is
-- halfway between now and the next ET midnight, "earlier today" halfway
-- between the last ET midnight and now, "tomorrow" noon ET the next day.
--
-- Mutation checks, each verified to raise: draw tomorrow's game too (2);
-- redraw a drawn game (3); drop the hash from the draw row (2); let the
-- guard pass without the override's audit row (5); let anyone but Anthony
-- override (6); drop the claim's ready check (9); put DN or GD on Cc (8);
-- let the claim take an omitted owner (9).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

update owners set email = lower(code) || '@tnf.test', alt_email = null;
update owners set email = 'avd-primary@tnf.test' where code = 'AVD';
update owners set alt_email = 'map-alt@tnf.test' where code = 'MAP';
update owners set email = null where code = 'DN';

create temp table t_when as
with z as (select 'America/New_York'::text as tz),
d as (select (now() at time zone z.tz)::date as today, z.tz from z)
select today,
       (((today + 1)::timestamp at time zone tz) - now()) / 2 + now() as later_today,
       now() - (now() - (today::timestamp at time zone tz)) / 2 as earlier_today,
       ((today + 1)::timestamp + interval '12 hours') at time zone tz as tomorrow
  from d;

-- Fixture games: G01 later today, G02 later today, G03 tomorrow, G04 earlier
-- today (past kickoff), G05 later today but its date unconfirmed. Every
-- other game is void, so nothing else is on today's slate.
update games set status = 'void' where game_no > 5;
update games set date_confirmed = true, kickoff_at = (select later_today from t_when) + interval '1 minute' where game_no = 1;
update games set date_confirmed = true, kickoff_at = (select later_today from t_when) + interval '2 minutes' where game_no = 2;
update games set date_confirmed = true, kickoff_at = (select tomorrow from t_when) where game_no = 3;
update games set date_confirmed = true, kickoff_at = (select earlier_today from t_when) where game_no = 4;
update games set date_confirmed = false, kickoff_at = (select later_today from t_when) + interval '3 minutes' where game_no = 5;

-- Holders for the day emails: every seed holder released, then
--   h1 (with a cc, never on the envelope), GD's primary holding a block (Bcc,
--   as a holder), MAP's alt holding a block (out), Anthony holding a block
--   (To), RM's primary holding a block (on Cc, not twice).
do $$
declare
  r record;
  v_p uuid;
  v_open int;
begin
  for r in select block_number from blocks where participant_id is not null loop
    perform admin_release_block(r.block_number, 'fx');
  end loop;
  for r in select * from (values ('H1', 'h1@tnf.test', 'h1cc@tnf.test'), ('Owner GD', 'gd@tnf.test', null),
                                 ('Alt Holder', 'map-alt@tnf.test', null), ('Anthony', 'avd-primary@tnf.test', null),
                                 ('Owner RM', 'rm@tnf.test', null), ('H6', 'h6@tnf.test', null)) t(n, e, cc) loop
    insert into participants (full_name, email, cc_email, owner_group, blocks_requested)
    values (r.n, r.e, r.cc, 'AVD', 1) returning id into v_p;
    select min(block_number) into v_open from blocks where status = 'available';
    perform admin_reserve_blocks(array[v_open], v_p, 'admin', 'fx', 'fx');
  end loop;
end $$;

-- 1. Admin-only, none of it open to anon; the hash is deterministic and the
--    permutation fresh.
do $$
declare
  f text;
  a int[];
  b int[];
  same int := 0;
  i int;
begin
  foreach f in array array['admin_draw_day(text)', 'admin_verify_digits()', 'admin_audit_note(text,text,text,jsonb,text)',
                           'admin_override_digits(uuid,int[],int[],text,text)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'TEST FAILURE: anon can execute %', f;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_draw_day('x');
    raise exception 'TEST FAILURE: a non-admin drew';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
  if digits_sha256(array[0,1,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0])
     <> encode(sha256(convert_to('0,1,2,3,4,5,6,7,8,9|9,8,7,6,5,4,3,2,1,0', 'UTF8')), 'hex') then
    raise exception 'TEST FAILURE: digits_sha256 is not sha256 of rows|cols';
  end if;
  for i in 1..20 loop
    a := digit_permutation();
    b := digit_permutation();
    if (select array_agg(x order by x) from unnest(a) x) <> array[0,1,2,3,4,5,6,7,8,9] then
      raise exception 'TEST FAILURE: digit_permutation is not a permutation: %', a;
    end if;
    if a = b then same := same + 1; end if;
  end loop;
  if same > 2 then
    raise exception 'TEST FAILURE: digit_permutation repeats itself (% of 20)', same;
  end if;
end $$;

-- 2. admin_draw_day draws today's confirmed, future games only, each its own
--    permutation, publishes them at once, and puts the hash on the draw row.
do $$
declare
  v jsonb;
  g1 games;
  g2 games;
  n int;
begin
  v := admin_draw_day('tnf-game-day');
  if (select array_agg((x ->> 'game_no')::int order by (x ->> 'game_no')::int) from jsonb_array_elements(v -> 'games') x)
     is distinct from array[1, 2] then
    raise exception 'TEST FAILURE: drew %, expected G01 and G02 only', v -> 'games';
  end if;
  if (select array_agg((x ->> 'game_no')::int order by (x ->> 'game_no')::int) from jsonb_array_elements(v -> 'problems') x)
     is distinct from array[4, 5] then
    raise exception 'TEST FAILURE: problems %, expected G04 past kickoff and G05 unconfirmed', v -> 'problems';
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'games') x where x ->> 'state' <> 'drawn_and_published') then
    raise exception 'TEST FAILURE: states %', v -> 'games';
  end if;
  if exists (select 1 from games where game_no in (3, 4, 5) and digits_assigned_at is not null) then
    raise exception 'TEST FAILURE: a game not on today''s slate was drawn';
  end if;
  select * into g1 from games where game_no = 1;
  select * into g2 from games where game_no = 2;
  if g1.digits_published_at is null or g1.digits_published_at > now() or g1.status <> 'published' then
    raise exception 'TEST FAILURE: G01 not published at once (%, %)', g1.digits_published_at, g1.status;
  end if;
  if g1.row_digits = g2.row_digits and g1.col_digits = g2.col_digits then
    raise exception 'TEST FAILURE: G01 and G02 share a permutation';
  end if;
  select count(*) into n from audit_log
   where action = 'assign_digits' and target_id in (g1.id::text, g2.id::text)
     and after ->> 'digits_sha256' = digits_sha256((select row_digits from games where id::text = target_id),
                                                   (select col_digits from games where id::text = target_id))
     and after ->> 'via' = 'admin_draw_day';
  if n <> 2 then
    raise exception 'TEST FAILURE: % draw rows carry the right hash, expected 2', n;
  end if;
  if not (v -> 'verify' ->> 'all_ok')::boolean then
    raise exception 'TEST FAILURE: verify after the draw: %', v -> 'verify';
  end if;
end $$;

-- 3. Idempotent: a second run draws nothing, publishes nothing, writes no row,
--    and the hashes stand.
do $$
declare
  v jsonb;
  n0 int;
  h0 text;
begin
  select count(*) into n0 from audit_log;
  select digits_sha256(row_digits, col_digits) into h0 from games where game_no = 1;
  v := admin_draw_day('tnf-game-day');
  if (select count(*) from audit_log) <> n0 then
    raise exception 'TEST FAILURE: the re-run wrote % audit rows', (select count(*) from audit_log) - n0;
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'games') x where x ->> 'state' <> 'already_drawn') then
    raise exception 'TEST FAILURE: re-run states %', v -> 'games';
  end if;
  if (select digits_sha256(row_digits, col_digits) from games where game_no = 1) <> h0 then
    raise exception 'TEST FAILURE: G01 changed on the re-run';
  end if;
end $$;

-- 4. The manual fallback: a game drawn by hand and not published is published,
--    never redrawn.
do $$
declare
  v jsonb;
  h0 text;
begin
  update games set kickoff_at = (select later_today from t_when) + interval '4 minutes' where game_no = 3;
  perform admin_assign_digits((select id from games where game_no = 3), 'anthony');
  select digits_sha256(row_digits, col_digits) into h0 from games where game_no = 3;
  if (select after ->> 'digits_sha256' from audit_log where action = 'assign_digits'
        and target_id = (select id::text from games where game_no = 3) order by id desc limit 1) <> h0 then
    raise exception 'TEST FAILURE: the manual draw row has no hash, or the wrong one';
  end if;
  v := admin_draw_day('tnf-game-day');
  if (select x ->> 'state' from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 3) <> 'already_drawn_and_published' then
    raise exception 'TEST FAILURE: G03 state %', v -> 'games';
  end if;
  if (select digits_sha256(row_digits, col_digits) from games where game_no = 3) <> h0 then
    raise exception 'TEST FAILURE: G03 was redrawn';
  end if;
end $$;

-- 5. The lock: rows, columns, seed and assigned-at are fixed from every path,
--    a raw UPDATE included; so is a revealed reveal time.
do $$
declare
  g uuid := (select id from games where game_no = 1);
  stmt text;
begin
  foreach stmt in array array[
    'update games set row_digits = array[0,1,2,3,4,5,6,7,8,9] where game_no = 1',
    'update games set col_digits = array[9,8,7,6,5,4,3,2,1,0] where game_no = 1',
    'update games set digit_seed = ''x'' where game_no = 1',
    'update games set digits_assigned_at = now() - interval ''1 day'' where game_no = 1',
    'update games set digits_published_at = null where game_no = 1',
    'update games set digits_published_at = now() + interval ''1 day'' where game_no = 1'] loop
    begin
      execute stmt;
      raise exception 'TEST FAILURE: allowed: %', stmt;
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%immutable once assigned%' and sqlerrm not like '%stay published%' then
        raise exception 'TEST FAILURE: wrong refusal for %: %', stmt, sqlerrm;
      end if;
    end;
  end loop;
  -- The override's GUC alone, with no audit row in this transaction, opens nothing.
  perform set_config('tnf.digits_override', g::text, true);
  begin
    update games set row_digits = array[0,1,2,3,4,5,6,7,8,9] where game_no = 1;
    raise exception 'TEST FAILURE: the GUC alone let the digits change';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
  end;
  perform set_config('tnf.digits_override', '', true);
  begin
    perform admin_assign_digits(g, 'anthony');
    raise exception 'TEST FAILURE: a drawn game was drawn again';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already assigned%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 6. The one exception: Anthony's override, with a reason, its own audit row,
--    before any score; verify follows the new digits.
do $$
declare
  g uuid := (select id from games where game_no = 2);
  v jsonb;
begin
  begin
    perform admin_override_digits(g, array[0,1,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0], 'a reason that is long enough', 'tnf-sweep');
    raise exception 'TEST FAILURE: the sweep overrode digits';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%Anthony''s alone%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_override_digits(g, array[0,1,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0], 'short', 'anthony');
    raise exception 'TEST FAILURE: an override with no real reason';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%needs a reason%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_override_digits(g, array[0,0,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0], 'a reason that is long enough', 'anthony');
    raise exception 'TEST FAILURE: an override that is not a permutation';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%permutation%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  v := admin_override_digits(g, array[0,1,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0], 'draw row typo, fixed with Anthony', 'anthony');
  if (select row_digits from games where id = g) <> array[0,1,2,3,4,5,6,7,8,9] then
    raise exception 'TEST FAILURE: the override did not change the digits';
  end if;
  if not exists (select 1 from audit_log where action = 'digits_override' and target_id = g::text
                   and note = 'draw row typo, fixed with Anthony'
                   and before ->> 'digits_sha256' = v ->> 'before_sha256'
                   and after ->> 'digits_sha256' = v ->> 'after_sha256') then
    raise exception 'TEST FAILURE: no override audit row with both hashes and the reason';
  end if;
  if not (admin_verify_digits() ->> 'all_ok')::boolean then
    raise exception 'TEST FAILURE: verify does not follow the override';
  end if;
end $$;

-- 7. Verify catches digits that do not match their draw row.
do $$
declare
  v jsonb;
begin
  insert into audit_log (actor, action, target_table, target_id, after)
  values ('fx', 'assign_digits', 'games', (select id::text from games where game_no = 1),
          jsonb_build_object('game_no', 1, 'row_digits', array[1,0,2,3,4,5,6,7,8,9], 'col_digits', array[0,1,2,3,4,5,6,7,8,9]));
  v := admin_verify_digits();
  if (v ->> 'all_ok')::boolean
     or (select (x ->> 'ok')::boolean from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 1) then
    raise exception 'TEST FAILURE: verify missed a mismatch: %', v;
  end if;
  delete from audit_log where actor = 'fx' and action = 'assign_digits';
  if not (admin_verify_digits() ->> 'all_ok')::boolean then
    raise exception 'TEST FAILURE: verify after the fixture row was removed';
  end if;
end $$;

-- The two games section 2 could not draw (past kickoff, unconfirmed) would
-- keep any game-day email from going, as they should; take them off the slate.
do $$
begin
  if email_day_not_ready('gameday_' || (select today from t_when)) not like '%G04 digits are not published%' then
    raise exception 'TEST FAILURE: an undrawn game of today did not stop the game-day email';
  end if;
  update games set status = 'void' where game_no in (4, 5);
end $$;

-- 8. The day emails' plan: To Anthony, Cc RM and MAP, Bcc holders' own
--    addresses minus those; GD as a holder in Bcc; MAP's alt out; DN blank
--    is no matter.
do $$
declare
  v jsonb := admin_email_broadcast_plan('gameday_' || (select today from t_when));
begin
  if array(select jsonb_array_elements_text(v -> 'to')) is distinct from array['avd-primary@tnf.test'] then
    raise exception 'TEST FAILURE: To %', v -> 'to';
  end if;
  if array(select jsonb_array_elements_text(v -> 'cc')) is distinct from array['map@tnf.test', 'rm@tnf.test'] then
    raise exception 'TEST FAILURE: Cc %', v -> 'cc';
  end if;
  if array(select jsonb_array_elements_text(v -> 'bcc')) is distinct from array['gd@tnf.test', 'h1@tnf.test', 'h6@tnf.test'] then
    raise exception 'TEST FAILURE: Bcc %', v -> 'bcc';
  end if;
  if (v ->> 'h')::int <> 6 or (v ->> 't')::int <> 2 or (v ->> 'x')::int <> 1 or (v ->> 'bcc_count')::int <> 3 then
    raise exception 'TEST FAILURE: arithmetic %', v - 'bcc' - 'cc' - 'to';
  end if;
end $$;

-- 9. The claim: approval required, no override, refused until its content is
--    ready, To 1 Cc 2 Bcc 3 when it is, and once only.
do $$
declare
  k text := 'gameday_' || (select today from t_when);
  w text := 'winners_' || (select today from t_when);
  c jsonb;
  sha text := repeat('a', 64);
  appr text := 'Anthony approved the flow and templates 2026-11-23 2:53 PM ET (Part N)';
begin
  begin
    perform admin_email_claim_broadcast(k, sha, '{}', 0, 10, 'tnf-game-day', null);
    raise exception 'TEST FAILURE: a day email claimed with no approval';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%needs the approval%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast(k, sha, array['DN'], 0, 10, 'tnf-game-day', appr);
    raise exception 'TEST FAILURE: a day email left an owner off';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%leaves no owner off%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast('kickoff_' || ((select today from t_when) + 1), sha, '{}', 0, 10, 'tnf-game-day', appr);
    raise exception 'TEST FAILURE: tomorrow''s kickoff email claimed today';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%goes out on its own date%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_email_claim_broadcast(w, sha, '{}', 0, 10, 'tnf-results', appr);
    raise exception 'TEST FAILURE: a winners email claimed before any score';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%is not scored%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  if exists (select 1 from email_sends where event_key in (k, w)) then
    raise exception 'TEST FAILURE: a refused claim left rows';
  end if;
  c := admin_email_claim_broadcast(k, sha, '{}', 3, 3, 'tnf-game-day', appr);
  if (c ->> 'to')::int <> 1 or (c ->> 'cc')::int <> 2 or (c ->> 'bcc')::int <> 3 or (c ->> 'claimed')::int <> 6 then
    raise exception 'TEST FAILURE: claim %', c;
  end if;
  if not exists (select 1 from audit_log where action = 'email_claim_broadcast' and target_id = k and note = appr) then
    raise exception 'TEST FAILURE: the approval is not on the claim row';
  end if;
  begin
    perform admin_email_claim_broadcast(k, sha, '{}', 3, 3, 'tnf-game-day', appr);
    raise exception 'TEST FAILURE: claimed twice';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already claimed%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform admin_email_record_sent_broadcast(k, 'msg-gameday-1', sha, 'tnf-game-day');
  if exists (select 1 from email_sends where event_key = k and (gmail_message_id is distinct from 'msg-gameday-1' or sent_at is null)) then
    raise exception 'TEST FAILURE: the day send was not recorded';
  end if;
end $$;

-- 10. Winners: a winning block with no payout behind it refuses the email;
--     a scored day with every winner assigned is ready.
do $$
declare
  w text := 'winners_' || (select today from t_when);
  g games;
  r record;
begin
  -- Score every drawn game of today so both winners land on assigned blocks:
  -- make every block assigned to H1 first (fixture only).
  update blocks set status = 'assigned', participant_id = (select id from participants where full_name = 'H1') where true;
  for r in select * from games where (kickoff_at at time zone 'America/New_York')::date = (select today from t_when)
             and digits_assigned_at is not null loop
    perform admin_score_game(r.id, 'halftime', 0, 0, 'tnf-results');
    perform admin_score_game(r.id, 'final', 13, 16, 'tnf-results');
  end loop;
  if email_day_not_ready(w) is not null then
    raise exception 'TEST FAILURE: a scored day with every winner assigned is not ready: %', email_day_not_ready(w);
  end if;
  -- One payout voided: the email is Anthony's call.
  update payouts set status = 'void' where id = (select id from payouts order by created_at limit 1);
  if email_day_not_ready(w) not like '%no payout behind it%' then
    raise exception 'TEST FAILURE: a winner with no payout did not stop the email: %', email_day_not_ready(w);
  end if;
end $$;

-- 11. Public history: as anon, today's published grids show their digits and
--     scores; the undrawn game shows none.
do $$
declare
  r record;
begin
  set local role anon;
  for r in select * from v_public_games where game_no in (1, 2, 3) loop
    if r.row_digits is null or r.col_digits is null or r.final_block is null then
      raise exception 'TEST FAILURE: anon cannot see G% digits or score', r.game_no;
    end if;
  end loop;
  if (select row_digits from v_public_games where game_no = 5) is not null then
    raise exception 'TEST FAILURE: anon sees undrawn digits';
  end if;
  reset role;
end $$;

-- 12. The audit note: a closed list.
do $$
declare
  n bigint;
begin
  n := admin_audit_note('approval_recorded', 'part-n', 'Anthony approved the flow and templates', '{"at":"2026-11-23T14:53:00-05:00"}', 'claude:part-n');
  if not exists (select 1 from audit_log where id = n and action = 'approval_recorded' and target_table = 'ops') then
    raise exception 'TEST FAILURE: no approval row';
  end if;
  begin
    perform admin_audit_note('assign_digits', 'x', 'y', '{}', 'claude');
    raise exception 'TEST FAILURE: the note took an action outside its list';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%audit note action must be%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

rollback;
