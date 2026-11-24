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
-- let the claim take an omitted owner (9). Review of PR 42, each verified to
-- raise: lock only drawn games, not digits written with no draw (7b); let a
-- hand-written override row through for the sweep's name, a short reason
-- (5) or a scored game (10b); drop the delete or the truncate trigger (5);
-- leave raw digits out of verify, or call them ok with a matching row (7b);
-- let the morning run draw over them (7b); let the per-recipient claim take
-- a broadcast key (8b). Review round two, each verified to raise: check the
-- date before kickoff (2b); drop the id or the game-number lock, or keep it
-- to drawn games only (5b); refuse every NULL clear, take one NULL side as a
-- clear, clear a drawn game or one with no digits, drop the score check, the
-- cleared mark or the old digits from the clear row (7c); drop the lock's
-- clear path or any one of its conditions: the GUC, the name, the reason, the
-- txid, the cleared mark, rows or columns null, the seed, assigned-at before
-- or after, the halftime or final score (7c); let digits_ok pass digits with
-- no draw (7d).
--
-- Every assertion that reads a value is NULL-safe (CLAUDE.md, migrations 15
-- and 16): IS DISTINCT FROM, IS NOT TRUE, or coalesce, never a bare <> or
-- NOT LIKE that a NULL turns into a silent pass.

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
     is distinct from encode(sha256(convert_to('0,1,2,3,4,5,6,7,8,9|9,8,7,6,5,4,3,2,1,0', 'UTF8')), 'hex') then
    raise exception 'TEST FAILURE: digits_sha256 is not sha256 of rows|cols';
  end if;
  for i in 1..20 loop
    a := digit_permutation();
    b := digit_permutation();
    if (select array_agg(x order by x) from unnest(a) x) is distinct from array[0,1,2,3,4,5,6,7,8,9] then
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
  if exists (select 1 from jsonb_array_elements(v -> 'games') x where x ->> 'state' is distinct from 'drawn_and_published') then
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
  if g1.row_digits is not distinct from g2.row_digits and g1.col_digits is not distinct from g2.col_digits then
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
  if (v -> 'verify' ->> 'all_ok')::boolean is not true then
    raise exception 'TEST FAILURE: verify after the draw: %', v -> 'verify';
  end if;
end $$;

-- 2b. Past kickoff is checked before the date, so 'date unconfirmed, not
--     drawn' always means kickoff is still ahead: G04, past kickoff, with its
--     date unconfirmed for this block, reports past kickoff; G05, ahead,
--     still reports its date. Rolled back.
do $$
declare
  v jsonb;
begin
  begin
    update games set date_confirmed = false where game_no = 4;
    v := admin_draw_day('tnf-game-day');
    if (select x ->> 'problem' from jsonb_array_elements(v -> 'problems') x where (x ->> 'game_no')::int = 4)
       is distinct from 'past kickoff, not drawn' then
      raise exception 'TEST FAILURE: an unconfirmed game past kickoff was not reported past kickoff: %', v -> 'problems';
    end if;
    if (select x ->> 'problem' from jsonb_array_elements(v -> 'problems') x where (x ->> 'game_no')::int = 5)
       is distinct from 'date unconfirmed, not drawn' then
      raise exception 'TEST FAILURE: an unconfirmed game before kickoff was not reported unconfirmed: %', v -> 'problems';
    end if;
    raise exception 'ROLLBACK 2b';
  exception when others then
    if sqlerrm <> 'ROLLBACK 2b' then raise; end if;
  end;
  if (select date_confirmed from games where game_no = 4) is not true then
    raise exception 'TEST FAILURE: 2b did not roll back';
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
  if h0 is null then
    raise exception 'TEST FAILURE: fixture: G01 has no digits before the re-run';
  end if;
  v := admin_draw_day('tnf-game-day');
  if (select count(*) from audit_log) <> n0 then
    raise exception 'TEST FAILURE: the re-run wrote % audit rows', (select count(*) from audit_log) - n0;
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'games') x where x ->> 'state' is distinct from 'already_drawn') then
    raise exception 'TEST FAILURE: re-run states %', v -> 'games';
  end if;
  if (select digits_sha256(row_digits, col_digits) from games where game_no = 1) is distinct from h0 then
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
  if h0 is null then
    raise exception 'TEST FAILURE: G03 has no digits after the manual draw';
  end if;
  if (select after ->> 'digits_sha256' from audit_log where action = 'assign_digits'
        and target_id = (select id::text from games where game_no = 3) order by id desc limit 1) is distinct from h0 then
    raise exception 'TEST FAILURE: the manual draw row has no hash, or the wrong one';
  end if;
  v := admin_draw_day('tnf-game-day');
  if (select x ->> 'state' from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 3) is distinct from 'already_drawn_and_published' then
    raise exception 'TEST FAILURE: G03 state %', v -> 'games';
  end if;
  if (select digits_sha256(row_digits, col_digits) from games where game_no = 3) is distinct from h0 then
    raise exception 'TEST FAILURE: G03 was redrawn';
  end if;
end $$;

-- 5. The lock: rows, columns, seed and assigned-at are fixed from every path,
--    a raw UPDATE included; so is a revealed reveal time. An override row
--    written by hand opens nothing unless it is one admin_override_digits
--    itself would write. A drawn game is never deleted or truncated.
do $$
declare
  g uuid := (select id from games where game_no = 1);
  stmt text;
  v_new int[];
  v_forged text[];
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
    if sqlerrm not like '%immutable once assigned%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('tnf.digits_override', '', true);

  -- A hand-written override row, right game, right txid, right hash, the GUC
  -- set: refused under the sweep's name, and with a reason under 10
  -- characters. The new rows are G01's reversed, so they always differ.
  select array(select x from unnest(row_digits) with ordinality t(x, i) order by i desc) into v_new from games where id = g;
  foreach v_forged slice 1 in array array[array['tnf-sweep', 'a reason that is long enough'],
                                          array['anthony', 'short'],
                                          array['anthony', '   short   ']] loop
    begin
      insert into audit_log (actor, action, target_table, target_id, after)
      values (v_forged[1], 'digits_override', 'games', g::text,
              jsonb_build_object('digits_sha256', digits_sha256(v_new, (select col_digits from games where id = g)),
                                 'txid', txid_current()::text, 'reason', v_forged[2]));
      perform set_config('tnf.digits_override', g::text, true);
      update games set row_digits = v_new where id = g;
      raise exception 'TEST FAILURE: a hand-written override row (%) let the digits change', array_to_string(v_forged, ' / ');
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%immutable once assigned%' then
        raise exception 'TEST FAILURE: wrong refusal for the override row (%): %', array_to_string(v_forged, ' / '), sqlerrm;
      end if;
    end;
  end loop;
  -- Control: the same row under Anthony's name with a real reason is the row
  -- admin_override_digits writes, and opens the lock, so the refusals above
  -- are the name and the reason, not the fixture. Rolled back.
  begin
    insert into audit_log (actor, action, target_table, target_id, after)
    values ('anthony', 'digits_override', 'games', g::text,
            jsonb_build_object('digits_sha256', digits_sha256(v_new, (select col_digits from games where id = g)),
                               'txid', txid_current()::text, 'reason', 'a reason that is long enough'));
    perform set_config('tnf.digits_override', g::text, true);
    update games set row_digits = v_new where id = g;
    if (select row_digits from games where id = g) is distinct from v_new then
      raise exception 'TEST FAILURE: control: the override row did not open the lock';
    end if;
    raise exception 'ROLLBACK 5 control';
  exception when others then
    if sqlerrm <> 'ROLLBACK 5 control' then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      raise exception 'TEST FAILURE: control: Anthony''s override row was refused: %', sqlerrm;
    end if;
  end;
  if (select row_digits from games where id = g) is not distinct from v_new
     or coalesce(current_setting('tnf.digits_override', true), '') <> '' then
    raise exception 'TEST FAILURE: the control did not roll back';
  end if;

  -- A drawn game is never deleted (delete and insert would redraw it under a
  -- new id) or truncated; an undrawn one still can be, rolled back here.
  begin
    delete from games where id = g;
    raise exception 'TEST FAILURE: a drawn game was deleted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%G01: a drawn game is never deleted%' then raise exception 'TEST FAILURE: wrong refusal for the delete: %', sqlerrm; end if;
  end;
  begin
    perform set_config('client_min_messages', 'warning', true);  -- the cascade notice; reverted with this block
    truncate games cascade;
    raise exception 'TEST FAILURE: games were truncated with a drawn game in them';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%a drawn game is never deleted, truncate included%' then
      raise exception 'TEST FAILURE: wrong refusal for the truncate: %', sqlerrm;
    end if;
  end;
  begin
    delete from games where game_no = 6 and row_digits is null and col_digits is null and digits_assigned_at is null;
    if exists (select 1 from games where game_no = 6) then
      raise exception 'TEST FAILURE: control: an undrawn game could not be deleted';
    end if;
    raise exception 'ROLLBACK 5 delete';
  exception when others then
    if sqlerrm <> 'ROLLBACK 5 delete' then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      raise exception 'TEST FAILURE: control: deleting an undrawn game raised: %', sqlerrm;
    end if;
  end;
  if not exists (select 1 from games where game_no = 6) then
    raise exception 'TEST FAILURE: the delete control did not roll back';
  end if;
  begin
    perform admin_assign_digits(g, 'anthony');
    raise exception 'TEST FAILURE: a drawn game was drawn again';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%already assigned%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
end $$;

-- 5b. Once any digits exist the id and game number are fixed too:
--     renumbering would redraw a published grid without a delete. Refused on
--     a drawn game (G01) and on digits written with no draw (G05, rolled
--     back); an undrawn game (G06) can still be renumbered, rolled back.
do $$
declare
  stmt text;
  v_id uuid := (select id from games where game_no = 6);
begin
  foreach stmt in array array[
    'update games set game_no = 99 where game_no = 1',
    'update games set id = gen_random_uuid() where game_no = 1'] loop
    begin
      execute stmt;
      raise exception 'TEST FAILURE: allowed on a drawn game: %', stmt;
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%G01: a game with digits keeps its id and game number%' then
        raise exception 'TEST FAILURE: wrong refusal for %: %', stmt, sqlerrm;
      end if;
    end;
  end loop;
  begin
    update games set row_digits = array[0,1,2,3,4,5,6,7,8,9], col_digits = array[9,8,7,6,5,4,3,2,1,0]
     where game_no = 5 and digits_assigned_at is null and row_digits is null and col_digits is null;
    if (select row_digits from games where game_no = 5) is null then
      raise exception 'TEST FAILURE: fixture: G05 raw digits not written';
    end if;
    foreach stmt in array array[
      'update games set game_no = 98 where game_no = 5',
      'update games set id = gen_random_uuid() where game_no = 5'] loop
      begin
        execute stmt;
        raise exception 'TEST FAILURE: allowed on digits with no draw: %', stmt;
      exception when others then
        if sqlerrm like 'TEST FAILURE%' then raise; end if;
        if sqlerrm not like '%G05: a game with digits keeps its id and game number%' then
          raise exception 'TEST FAILURE: wrong refusal for %: %', stmt, sqlerrm;
        end if;
      end;
    end loop;
    raise exception 'ROLLBACK 5b raw';
  exception when others then
    if sqlerrm <> 'ROLLBACK 5b raw' then raise; end if;
  end;
  begin
    update games set game_no = 99 where game_no = 6;
    update games set id = gen_random_uuid() where game_no = 99;
    if (select id from games where game_no = 99) is not distinct from v_id then
      raise exception 'TEST FAILURE: control: an undrawn game was not renumbered';
    end if;
    raise exception 'ROLLBACK 5b control';
  exception when others then
    if sqlerrm <> 'ROLLBACK 5b control' then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      raise exception 'TEST FAILURE: control: renumbering an undrawn game raised: %', sqlerrm;
    end if;
  end;
  if (select id from games where game_no = 6) is distinct from v_id
     or (select row_digits from games where game_no = 5) is not null then
    raise exception 'TEST FAILURE: 5b did not roll back';
  end if;
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
  if (select row_digits from games where id = g) is distinct from array[0,1,2,3,4,5,6,7,8,9] then
    raise exception 'TEST FAILURE: the override did not change the digits';
  end if;
  if not exists (select 1 from audit_log where action = 'digits_override' and target_id = g::text
                   and note = 'draw row typo, fixed with Anthony'
                   and before ->> 'digits_sha256' = v ->> 'before_sha256'
                   and after ->> 'digits_sha256' = v ->> 'after_sha256') then
    raise exception 'TEST FAILURE: no override audit row with both hashes and the reason';
  end if;
  if (admin_verify_digits() ->> 'all_ok')::boolean is not true then
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
  if (v ->> 'all_ok')::boolean is distinct from false
     or (select (x ->> 'ok')::boolean from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 1) is distinct from false then
    raise exception 'TEST FAILURE: verify missed a mismatch: %', v;
  end if;
  delete from audit_log where actor = 'fx' and action = 'assign_digits';
  if (admin_verify_digits() ->> 'all_ok')::boolean is not true then
    raise exception 'TEST FAILURE: verify after the fixture row was removed';
  end if;
end $$;

-- 7b. Digits written straight to a game, assigned-at left null (G05, today,
--     confirmed for this block): locked as if drawn, in verify and never ok,
--     even beside a matching draw row; reported by the morning run and never
--     drawn over or published; refused by the manual draw; never deleted.
--     Rolled back at the end of the block.
do $$
declare
  g uuid := (select id from games where game_no = 5);
  v jsonb;
  stmt text;
begin
  begin
    update games set date_confirmed = true,
                     row_digits = array[0,1,2,3,4,5,6,7,8,9], col_digits = array[9,8,7,6,5,4,3,2,1,0]
     where id = g and digits_assigned_at is null and row_digits is null and col_digits is null;
    if (select row_digits from games where id = g) is null then
      raise exception 'TEST FAILURE: fixture: G05 raw digits not written';
    end if;
    foreach stmt in array array[
      'update games set row_digits = array[1,0,2,3,4,5,6,7,8,9] where game_no = 5',
      'update games set col_digits = null where game_no = 5',
      'update games set digit_seed = ''x'' where game_no = 5',
      'update games set digits_assigned_at = now() where game_no = 5'] loop
      begin
        execute stmt;
        raise exception 'TEST FAILURE: digits with no draw were changed: %', stmt;
      exception when others then
        if sqlerrm like 'TEST FAILURE%' then raise; end if;
        if sqlerrm not like '%immutable once assigned%' then
          raise exception 'TEST FAILURE: wrong refusal for %: %', stmt, sqlerrm;
        end if;
      end;
    end loop;

    v := admin_verify_digits();
    if (select (x ->> 'ok')::boolean from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 5) is distinct from false
       or (v ->> 'all_ok')::boolean is distinct from false then
      raise exception 'TEST FAILURE: verify did not see digits with no draw: %', v;
    end if;
    -- A draw row matching them does not make them a draw.
    insert into audit_log (actor, action, target_table, target_id, after)
    values ('fx', 'assign_digits', 'games', g::text,
            jsonb_build_object('game_no', 5, 'row_digits', array[0,1,2,3,4,5,6,7,8,9], 'col_digits', array[9,8,7,6,5,4,3,2,1,0],
                               'digits_sha256', digits_sha256(array[0,1,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0])));
    v := admin_verify_digits();
    if (select (x ->> 'ok')::boolean from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 5) is distinct from false then
      raise exception 'TEST FAILURE: verify called digits with no draw ok beside a matching row: %', v;
    end if;

    begin
      v := admin_draw_day('tnf-game-day');
    exception when others then
      raise exception 'TEST FAILURE: the morning run failed on digits with no draw instead of reporting them: %', sqlerrm;
    end;
    if not exists (select 1 from jsonb_array_elements(v -> 'problems') x
                    where (x ->> 'game_no')::int = 5
                      and x ->> 'problem' = 'digits present with no draw; Anthony''s call') then
      raise exception 'TEST FAILURE: the morning run did not report G05''s digits with no draw: %', v -> 'problems';
    end if;
    if exists (select 1 from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 5) then
      raise exception 'TEST FAILURE: the morning run took G05: %', v -> 'games';
    end if;
    if (select row_digits from games where id = g) is distinct from array[0,1,2,3,4,5,6,7,8,9]
       or (select col_digits from games where id = g) is distinct from array[9,8,7,6,5,4,3,2,1,0]
       or (select digits_assigned_at from games where id = g) is not null
       or (select digits_published_at from games where id = g) is not null then
      raise exception 'TEST FAILURE: the morning run drew over or published G05';
    end if;

    -- An override row in the shape admin_override_digits writes opens nothing
    -- here either: the function overrides a draw, and this is none.
    begin
      insert into audit_log (actor, action, target_table, target_id, after)
      values ('anthony', 'digits_override', 'games', g::text,
              jsonb_build_object('digits_sha256', digits_sha256(array[1,0,2,3,4,5,6,7,8,9], array[9,8,7,6,5,4,3,2,1,0]),
                                 'txid', txid_current()::text, 'reason', 'a reason that is long enough'));
      perform set_config('tnf.digits_override', g::text, true);
      update games set row_digits = array[1,0,2,3,4,5,6,7,8,9] where id = g;
      raise exception 'TEST FAILURE: an override row changed digits with no draw';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%immutable once assigned%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;

    begin
      perform admin_assign_digits(g, 'anthony');
      raise exception 'TEST FAILURE: the manual draw drew over digits with no draw';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%G05: digits present with no draw%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;

    begin
      delete from games where id = g;
      raise exception 'TEST FAILURE: a game with digits and no draw was deleted';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%G05: a drawn game is never deleted%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;
    raise exception 'ROLLBACK 7b';
  exception when others then
    if sqlerrm <> 'ROLLBACK 7b' then raise; end if;
  end;
  if (select row_digits from games where id = g) is not null
     or (admin_verify_digits() ->> 'all_ok')::boolean is not true then
    raise exception 'TEST FAILURE: 7b did not roll back';
  end if;
end $$;

-- 7c. The one exit for digits written with no draw: admin_override_digits
--     with NULL rows and NULL columns clears them back to none, Anthony's
--     alone, with a reason, before any score, on its own audit row; verify
--     then passes and the morning run draws the game on its day. The lock
--     admits a clear only on a row in the shape the function writes; any
--     other NULL is refused, and a drawn game is never cleared. G05, today,
--     confirmed for this block; rolled back.
do $$
declare
  g uuid := (select id from games where game_no = 5);
  r0 int[] := array[0,1,2,3,4,5,6,7,8,9];
  c0 int[] := array[9,8,7,6,5,4,3,2,1,0];
  good text := 'a reason that is long enough';
  v jsonb;
  v_case text;
  c record;
begin
  begin
    update games set date_confirmed = true, row_digits = r0, col_digits = c0
     where id = g and digits_assigned_at is null and digit_seed is null and row_digits is null and col_digits is null;
    if (select row_digits from games where id = g) is distinct from r0 then
      raise exception 'TEST FAILURE: fixture: G05 raw digits not written';
    end if;
    v := admin_verify_digits();
    if (select (x ->> 'ok')::boolean from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 5) is distinct from false
       or (v ->> 'all_ok')::boolean is distinct from false then
      raise exception 'TEST FAILURE: fixture: verify passed digits with no draw: %', v;
    end if;

    -- The function refuses: the sweep's name, a short reason, a scored game.
    begin
      perform admin_override_digits(g, null, null, good, 'tnf-sweep');
      raise exception 'TEST FAILURE: the sweep cleared digits';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%Anthony''s alone%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;
    begin
      perform admin_override_digits(g, null, null, 'short', 'anthony');
      raise exception 'TEST FAILURE: a clear with no real reason';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%needs a reason%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;
    foreach v_case in array array['halftime_scored_at', 'final_scored_at'] loop
      begin
        execute format('update games set %I = now() where id = %L', v_case, g);
        perform admin_override_digits(g, null, null, good, 'anthony');
        raise exception 'TEST FAILURE: a scored game was cleared (%)', v_case;
      exception when others then
        if sqlerrm like 'TEST FAILURE%' then raise; end if;
        if sqlerrm not like '%G05: scored; digits behind a score never change%' then
          raise exception 'TEST FAILURE: wrong refusal for the scored clear (%): %', v_case, sqlerrm;
        end if;
      end;
    end loop;
    -- Any other NULL stays refused: one side only, a drawn game, no digits.
    begin
      perform admin_override_digits(g, null, c0, good, 'anthony');
      raise exception 'TEST FAILURE: NULL rows with columns were taken';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%permutation of 0-9%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;
    begin
      perform admin_override_digits(g, r0, null, good, 'anthony');
      raise exception 'TEST FAILURE: rows with NULL columns were taken';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%permutation of 0-9%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;
    begin
      perform admin_override_digits((select id from games where game_no = 2), null, null, good, 'anthony');
      raise exception 'TEST FAILURE: a drawn game was cleared';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%G02: drawn; only digits written with no draw are cleared%' then
        raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm;
      end if;
    end;
    begin
      perform admin_override_digits((select id from games where game_no = 4), null, null, good, 'anthony');
      raise exception 'TEST FAILURE: a game with no digits was cleared';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%G04: no digits to clear%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
    end;
    if (select row_digits from games where id = g) is distinct from r0
       or (select col_digits from games where id = g) is distinct from c0
       or exists (select 1 from audit_log where action = 'digits_override'
                     and target_id in (g::text, (select id::text from games where game_no = 2))
                     and after ? 'cleared') then
      raise exception 'TEST FAILURE: a refused clear changed the digits or left a row';
    end if;

    -- The lock without the function: a hand-written clear row, the GUC set,
    -- refused unless it is the row the function writes, for a clear the
    -- function would make.
    for c in select * from (values
        ('the sweep''s name',         'tnf-sweep', good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, null),
        ('a short reason',            'anthony',   'short', '{"cleared": true}',  'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, null),
        ('no cleared mark',           'anthony',   good,    '{}',                 'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, null),
        ('cleared false',             'anthony',   good,    '{"cleared": false}', 'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, null),
        ('another txid',              'anthony',   good,    '{"cleared": true, "txid": "1"}', 'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, null),
        ('the GUC alone',             null,        null,    null,                 'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, null),
        ('the GUC for another game',  'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null where game_no = 5', 5, 2, null),
        ('rows only',                 'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null where game_no = 5', 5, 5, null),
        ('columns only',              'anthony',   good,    '{"cleared": true}',  'update games set col_digits = null where game_no = 5', 5, 5, null),
        ('the seed changed',          'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null, digit_seed = ''x'' where game_no = 5', 5, 5, null),
        ('assigned-at set',           'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null, digits_assigned_at = now() where game_no = 5', 5, 5, null),
        ('a halftime-scored game',    'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, 'halftime_scored_at'),
        ('a final-scored game',       'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null where game_no = 5', 5, 5, 'final_scored_at'),
        ('a drawn game',              'anthony',   good,    '{"cleared": true}',  'update games set row_digits = null, col_digits = null, digits_assigned_at = null where game_no = 2', 2, 2, null)
      ) t(label, actor, reason, extra, stmt, game_no, guc_game_no, scored)
    loop
      begin
        if c.scored is not null then
          execute format('update games set %I = now() where game_no = %s', c.scored, c.game_no);
        end if;
        if c.actor is not null then
          insert into audit_log (actor, action, target_table, target_id, after)
          values (c.actor, 'digits_override', 'games', (select id::text from games where game_no = c.game_no),
                  jsonb_build_object('txid', txid_current()::text, 'reason', c.reason) || c.extra::jsonb);
        end if;
        perform set_config('tnf.digits_override', (select id::text from games where game_no = c.guc_game_no), true);
        execute c.stmt;
        raise exception 'TEST FAILURE: a hand-written clear (%) changed the digits', c.label;
      exception when others then
        if sqlerrm like 'TEST FAILURE%' then raise; end if;
        if sqlerrm not like '%immutable once assigned%' then
          raise exception 'TEST FAILURE: wrong refusal for the hand-written clear (%): %', c.label, sqlerrm;
        end if;
      end;
    end loop;
    -- Control: the row the function writes opens the lock, so the refusals
    -- above are their cases, not the fixture. Rolled back.
    begin
      insert into audit_log (actor, action, target_table, target_id, after)
      values ('anthony', 'digits_override', 'games', g::text,
              jsonb_build_object('game_no', 5, 'cleared', true, 'txid', txid_current()::text, 'reason', good));
      perform set_config('tnf.digits_override', g::text, true);
      update games set row_digits = null, col_digits = null where id = g;
      if (select row_digits is null and col_digits is null from games where id = g) is not true then
        raise exception 'TEST FAILURE: control: the clear row did not open the lock';
      end if;
      raise exception 'ROLLBACK 7c control';
    exception when others then
      if sqlerrm <> 'ROLLBACK 7c control' then
        if sqlerrm like 'TEST FAILURE%' then raise; end if;
        raise exception 'TEST FAILURE: control: a clear row in the function''s shape was refused: %', sqlerrm;
      end if;
    end;
    if (select row_digits from games where id = g) is distinct from r0
       or coalesce(current_setting('tnf.digits_override', true), '') <> '' then
      raise exception 'TEST FAILURE: the 7c control did not roll back';
    end if;

    -- Anthony's clear, with a reason: no digits, seed and assigned-at still
    -- null, its own audit row with the old digits and their hash.
    v := admin_override_digits(g, null, null, 'hand-written digits, cleared with Anthony', 'anthony');
    if (select row_digits is null and col_digits is null and digit_seed is null and digits_assigned_at is null
          from games where id = g) is not true then
      raise exception 'TEST FAILURE: the clear did not leave G05 with no digits';
    end if;
    if (v ->> 'cleared')::boolean is not true or v ->> 'before_sha256' is distinct from digits_sha256(r0, c0)
       or coalesce(current_setting('tnf.digits_override', true), '') <> '' then
      raise exception 'TEST FAILURE: the clear returned %, or left the GUC set', v;
    end if;
    if not exists (select 1 from audit_log a
                    where a.action = 'digits_override' and a.target_table = 'games' and a.target_id = g::text
                      and a.actor = 'anthony'
                      and a.note = 'hand-written digits, cleared with Anthony'
                      and a.after = jsonb_build_object('game_no', 5, 'cleared', true, 'txid', txid_current()::text,
                                                       'reason', 'hand-written digits, cleared with Anthony')
                      and a.before = jsonb_build_object('game_no', 5, 'row_digits', r0, 'col_digits', c0,
                                                        'digits_sha256', digits_sha256(r0, c0))) then
      raise exception 'TEST FAILURE: no clear audit row with the old digits, their hash, cleared, txid and reason';
    end if;
    v := admin_verify_digits();
    if (v ->> 'all_ok')::boolean is not true
       or exists (select 1 from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 5) then
      raise exception 'TEST FAILURE: verify after the clear: %', v;
    end if;
    -- The morning run draws it on its day, and verify follows the draw.
    v := admin_draw_day('tnf-game-day');
    if (select x ->> 'state' from jsonb_array_elements(v -> 'games') x where (x ->> 'game_no')::int = 5)
       is distinct from 'drawn_and_published' then
      raise exception 'TEST FAILURE: the morning run did not draw G05 after the clear: games %, problems %', v -> 'games', v -> 'problems';
    end if;
    if (select digits_assigned_at is not null and row_digits is not null and col_digits is not null
               and digits_published_at <= now() from games where id = g) is not true
       or (v -> 'verify' ->> 'all_ok')::boolean is not true then
      raise exception 'TEST FAILURE: G05 after the draw: %', v -> 'verify';
    end if;
    raise exception 'ROLLBACK 7c';
  exception when others then
    if sqlerrm <> 'ROLLBACK 7c' then raise; end if;
  end;
  if (select row_digits is not null or digits_assigned_at is not null or date_confirmed from games where id = g) is not false
     or exists (select 1 from audit_log where action = 'digits_override' and target_id = g::text)
     or (admin_verify_digits() ->> 'all_ok')::boolean is not true then
    raise exception 'TEST FAILURE: 7c did not roll back';
  end if;
end $$;

-- 7d. A day email's digits_ok needs a draw: digits written by hand and
--     published (G05), beside a draw row that matches them, are not ok, and
--     the game-day email does not go. G04 voided for this block so G05 is the
--     first game the check reaches; rolled back.
do $$
declare
  g uuid := (select id from games where game_no = 5);
  r0 int[] := array[0,1,2,3,4,5,6,7,8,9];
  c0 int[] := array[9,8,7,6,5,4,3,2,1,0];
  d jsonb;
begin
  begin
    update games set row_digits = r0, col_digits = c0, digits_published_at = now() - interval '1 minute'
     where id = g and digits_assigned_at is null and row_digits is null and col_digits is null;
    insert into audit_log (actor, action, target_table, target_id, after)
    values ('fx', 'assign_digits', 'games', g::text,
            jsonb_build_object('game_no', 5, 'row_digits', r0, 'col_digits', c0, 'digits_sha256', digits_sha256(r0, c0)));
    if digits_expected_sha256(g) is distinct from digits_sha256(r0, c0) then
      raise exception 'TEST FAILURE: fixture: G05''s draw row does not match its digits';
    end if;
    d := email_day_facts((select today from t_when));
    if (select x -> 'digits_ok' from jsonb_array_elements(d -> 'games') x where (x ->> 'game_no')::int = 5)
       is distinct from 'false'::jsonb then
      raise exception 'TEST FAILURE: digits with no draw read digits_ok: %', d -> 'games';
    end if;
    if exists (select 1 from jsonb_array_elements(d -> 'games') x
                where (x ->> 'game_no')::int in (1, 2, 3) and x -> 'digits_ok' is distinct from 'true'::jsonb) then
      raise exception 'TEST FAILURE: control: a drawn game read not ok: %', d -> 'games';
    end if;
    update games set status = 'void' where game_no = 4;
    if email_day_not_ready('gameday_' || (select today from t_when)) is distinct from 'G05 digits do not match their draw row' then
      raise exception 'TEST FAILURE: the game-day email was not stopped by digits with no draw: %',
        email_day_not_ready('gameday_' || (select today from t_when));
    end if;
    raise exception 'ROLLBACK 7d';
  exception when others then
    if sqlerrm <> 'ROLLBACK 7d' then raise; end if;
  end;
  if (select row_digits is not null or digits_published_at is not null from games where id = g) is not false
     or (select status from games where game_no = 4) = 'void' then
    raise exception 'TEST FAILURE: 7d did not roll back';
  end if;
end $$;

-- 7e. After a clear nothing is expected: digits written by hand again show
--     expected none and drawn false in verify (so the routines give the clear
--     instruction, not the override one), and a game whose digits were
--     cleared after being published is never scored. G05; rolled back.
do $$
declare
  g uuid := (select id from games where game_no = 5);
  r0 int[] := array[0,1,2,3,4,5,6,7,8,9];
  c0 int[] := array[9,8,7,6,5,4,3,2,1,0];
  v jsonb;
  x jsonb;
begin
  begin
    update games set date_confirmed = true, row_digits = r0, col_digits = c0,
                     digits_published_at = now() - interval '1 minute'
     where id = g and digits_assigned_at is null and row_digits is null and col_digits is null;
    perform admin_override_digits(g, null, null, 'hand-written digits, cleared with Anthony', 'anthony');
    if digits_expected_sha256(g) is not null then
      raise exception 'TEST FAILURE: a clear left an expected hash: %', digits_expected_sha256(g);
    end if;
    -- a cleared game, still published, is never scored
    begin
      perform admin_score_game(g, 'halftime', 7, 3, 'tnf-results');
      raise exception 'TEST FAILURE: a game with no digits was scored';
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%G05: no digits; a game is never scored without them%' then
        raise exception 'TEST FAILURE: wrong refusal for scoring a cleared game: %', sqlerrm;
      end if;
    end;
    if (select halftime_scored_at is not null from games where id = g) then
      raise exception 'TEST FAILURE: the refused score left a mark';
    end if;
    -- the same mistake again: expected none, drawn false
    update games set row_digits = r0, col_digits = c0 where id = g;
    v := admin_verify_digits();
    select y into x from jsonb_array_elements(v -> 'games') y where (y ->> 'game_no')::int = 5;
    if x is null or x -> 'expected' is distinct from 'null'::jsonb or x -> 'drawn' is distinct from 'false'::jsonb
       or x -> 'ok' is distinct from 'false'::jsonb then
      raise exception 'TEST FAILURE: verify after a re-written clear: %', x;
    end if;
    -- control: a drawn game reads drawn true
    if exists (select 1 from jsonb_array_elements(v -> 'games') y
                where (y ->> 'game_no')::int in (1, 2, 3) and y -> 'drawn' is distinct from 'true'::jsonb) then
      raise exception 'TEST FAILURE: a drawn game read drawn false: %', v;
    end if;
    raise exception 'ROLLBACK 7e';
  exception when others then
    if sqlerrm <> 'ROLLBACK 7e' then raise; end if;
  end;
  if (select row_digits is not null or digits_published_at is not null or date_confirmed from games where id = g) is not false
     or exists (select 1 from audit_log where action = 'digits_override' and target_id = g::text) then
    raise exception 'TEST FAILURE: 7e did not roll back';
  end if;
end $$;

-- The two games section 2 could not draw (past kickoff, unconfirmed) would
-- keep any game-day email from going, as they should; take them off the slate.
do $$
begin
  if coalesce(email_day_not_ready('gameday_' || (select today from t_when)), '') not like '%G04 digits are not published%' then
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
  if (v ->> 'h')::int is distinct from 6 or (v ->> 't')::int is distinct from 2 or (v ->> 'x')::int is distinct from 1
     or (v ->> 'bcc_count')::int is distinct from 3 then
    raise exception 'TEST FAILURE: arithmetic %', v - 'bcc' - 'cc' - 'to';
  end if;
end $$;

-- 8b. The per-recipient claim takes no broadcast key: a winners row claimed
--     for Anthony would skip the approval and the readiness check and then
--     refuse the real claim as already claimed. Each key is one
--     admin_email_recipients answers for Anthony's address.
do $$
declare
  d text := (select today from t_when)::text;
  k text;
begin
  foreach k in array array['recruit_broadcast_' || d, 'format_change_' || d,
                           'kickoff_' || d, 'gameday_' || d, 'winners_' || d] loop
    if not exists (select 1 from admin_email_recipients(k) r where r.recipient = 'avd-primary@tnf.test') then
      raise exception 'TEST FAILURE: fixture: % does not derive Anthony''s address', k;
    end if;
    begin
      perform admin_email_claim(k, 'avd-primary@tnf.test', repeat('a', 64), 'tnf-results');
      raise exception 'TEST FAILURE: the per-recipient claim took %', k;
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm is distinct from k || ' is a broadcast: use admin_email_claim_broadcast' then
        raise exception 'TEST FAILURE: wrong refusal for %: %', k, sqlerrm;
      end if;
    end;
  end loop;
  if exists (select 1 from email_sends where event_key like '%' || d) then
    raise exception 'TEST FAILURE: a refused per-recipient claim left rows';
  end if;
  -- Per-recipient keys still claim.
  if admin_email_claim('answer_8b8b', 'h1@tnf.test', repeat('a', 64), 'tnf-sweep') is null then
    raise exception 'TEST FAILURE: an answer claim returned no id';
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
  if (c ->> 'to')::int is distinct from 1 or (c ->> 'cc')::int is distinct from 2 or (c ->> 'bcc')::int is distinct from 3
     or (c ->> 'claimed')::int is distinct from 6 then
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
  if coalesce(email_day_not_ready(w), '') not like '%no payout behind it%' then
    raise exception 'TEST FAILURE: a winner with no payout did not stop the email: %', email_day_not_ready(w);
  end if;
end $$;

-- 10b. Digits behind a score never change: an override row in the shape
--      admin_override_digits writes, Anthony's with a real reason, opens
--      nothing once a half is scored, the halftime alone or the final alone
--      (each half cleared by hand for its case, rolled back), and the
--      function refuses too.
do $$
declare
  g uuid := (select id from games where game_no = 1);
  v_new int[];
  v_case text;
begin
  if (select halftime_scored_at is null or final_scored_at is null from games where id = g) is distinct from false then
    raise exception 'TEST FAILURE: fixture: G01 is not scored at both halves';
  end if;
  select array(select x from unnest(row_digits) with ordinality t(x, i) order by i desc) into v_new from games where id = g;
  foreach v_case in array array['halftime only', 'final only', 'both'] loop
    begin
      if v_case = 'halftime only' then
        update games set final_home = null, final_away = null, final_block = null, final_scored_at = null where id = g;
      elsif v_case = 'final only' then
        update games set halftime_home = null, halftime_away = null, halftime_block = null, halftime_scored_at = null where id = g;
      end if;
      insert into audit_log (actor, action, target_table, target_id, after)
      values ('anthony', 'digits_override', 'games', g::text,
              jsonb_build_object('digits_sha256', digits_sha256(v_new, (select col_digits from games where id = g)),
                                 'txid', txid_current()::text, 'reason', 'a reason that is long enough'));
      perform set_config('tnf.digits_override', g::text, true);
      update games set row_digits = v_new where id = g;
      raise exception 'TEST FAILURE: an override row changed a scored game''s digits (%)', v_case;
    exception when others then
      if sqlerrm like 'TEST FAILURE%' then raise; end if;
      if sqlerrm not like '%immutable once assigned%' then
        raise exception 'TEST FAILURE: wrong refusal for the scored game (%): %', v_case, sqlerrm;
      end if;
    end;
  end loop;
  if (select halftime_scored_at is null or final_scored_at is null from games where id = g) is distinct from false then
    raise exception 'TEST FAILURE: 10b did not roll back its fixture';
  end if;
  begin
    perform admin_override_digits(g, v_new, (select col_digits from games where id = g), 'a reason that is long enough', 'anthony');
    raise exception 'TEST FAILURE: admin_override_digits changed a scored game';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%scored; digits behind a score never change%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
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
