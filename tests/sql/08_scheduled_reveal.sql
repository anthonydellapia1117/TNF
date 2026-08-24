-- Time-gated digit publish. Scheduling = digits_published_at in the future;
-- the public projection compares to now() per query, so the reveal fires at
-- the chosen instant with no admin action. Four required behaviors:
--   1. digits scheduled for the future are absent from the public payload
--      but present for admin
--   2. the scheduled time firing reveals them without any admin action
--   3. publishing now overrides a schedule
--   4. a game with no schedule set behaves exactly as it does today
-- Plus: scoring and live mode refuse while a schedule is still pending.
begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Fixture: G03 confirmed, kickoff a week out, digits assigned.
do $$
declare
  g3 uuid;
begin
  select id into g3 from games where game_no = 3;
  update games set date_confirmed = true, kickoff_at = now() + interval '7 days',
                   digits_assigned_at = null, digits_published_at = null,
                   row_digits = null, col_digits = null, status = 'scheduled'
   where id = g3;
  perform admin_assign_digits(g3, 'test');
end $$;

-- 1. Schedule for the future: nothing about the digits or the schedule
--    reaches the public payload, while admin still reads everything.
do $$
declare
  g3 uuid;
  r record;
begin
  select id into g3 from games where game_no = 3;
  perform admin_publish_digits(g3, 'test', now() + interval '2 hours');

  -- Admin (raw table): digits present, schedule visible.
  select * into r from games where id = g3;
  if r.row_digits is null or r.col_digits is null then
    raise exception 'TEST FAILURE: admin lost the assigned digits after scheduling';
  end if;
  if r.digits_published_at is null or r.digits_published_at <= now() then
    raise exception 'TEST FAILURE: schedule was not stored as a future timestamp';
  end if;

  -- Public: no digits, no timestamp, no published status. Block/owner data
  -- is a different view and is never gated.
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select * into r from v_public_games where game_no = 3;
  if r.row_digits is not null or r.col_digits is not null then
    raise exception 'TEST FAILURE: scheduled digits leak into the public payload';
  end if;
  if r.digits_published_at is not null then
    raise exception 'TEST FAILURE: the scheduled timestamp leaks into the public payload';
  end if;
  if r.status = 'published' then
    raise exception 'TEST FAILURE: public status shows published before the reveal';
  end if;
  if r.digits_assigned is not true then
    raise exception 'TEST FAILURE: digits_assigned flag should remain visible';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
end $$;

-- Scoring and live mode refuse while the schedule is pending.
do $$
declare
  g3 uuid;
begin
  select id into g3 from games where game_no = 3;
  begin
    perform admin_score_game(g3, 'halftime', 14, 27, 'test');
    raise exception 'TEST FAILURE: scoring accepted while reveal is scheduled';
  exception
    when others then
      if sqlerrm not like '%published%' then raise; end if;
  end;
  begin
    perform admin_set_live(g3, 0, 0, 'test');
    raise exception 'TEST FAILURE: live mode accepted while reveal is scheduled';
  exception
    when others then
      if sqlerrm not like '%publish%' then raise; end if;
  end;
end $$;

-- 2. The scheduled time firing reveals with no admin action: simulate the
--    clock passing by moving the stored timestamp into the past as the
--    table owner (no RPC, no admin call).
do $$
declare
  g3 uuid;
  r record;
begin
  select id into g3 from games where game_no = 3;
  update games set digits_published_at = now() - interval '1 minute' where id = g3;

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select * into r from v_public_games where game_no = 3;
  if r.row_digits is null or r.col_digits is null then
    raise exception 'TEST FAILURE: reveal time passed but digits are still hidden';
  end if;
  if r.digits_published_at is null then
    raise exception 'TEST FAILURE: reveal time passed but the timestamp is still hidden';
  end if;
  if r.status <> 'published' then
    raise exception 'TEST FAILURE: reveal time passed but status is %', r.status;
  end if;
  reset role;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

  -- Once revealed, scoring works with no further publish action.
  perform admin_score_game(g3, 'halftime', 14, 27, 'test');
end $$;

-- 3. Publish now overrides a schedule (and re-scheduling also works before
--    the reveal); once revealed, publishing again is refused.
do $$
declare
  g4 uuid;
  r record;
begin
  select id into g4 from games where game_no = 4;
  update games set date_confirmed = true, kickoff_at = now() + interval '14 days'
   where id = g4;
  perform admin_assign_digits(g4, 'test');
  perform admin_publish_digits(g4, 'test', now() + interval '3 days');

  -- Re-schedule while still pending: allowed.
  perform admin_publish_digits(g4, 'test', now() + interval '5 days');
  select * into r from games where id = g4;
  if r.digits_published_at < now() + interval '4 days' then
    raise exception 'TEST FAILURE: re-schedule did not replace the pending schedule';
  end if;

  -- Publish now: overrides the pending schedule, digits go public immediately.
  perform admin_publish_digits(g4, 'test');
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select * into r from v_public_games where game_no = 4;
  if r.row_digits is null then
    raise exception 'TEST FAILURE: publish-now after a schedule left digits hidden';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

  -- Already revealed → publishing again (or scheduling) is refused.
  begin
    perform admin_publish_digits(g4, 'test', now() + interval '1 day');
    raise exception 'TEST FAILURE: re-publish accepted after the reveal';
  exception
    when others then
      if sqlerrm not like '%already published%' then raise; end if;
  end;
end $$;

-- 4. No schedule set = today's behavior: assign → publish → immediately
--    public, scorable, and refuses a second publish.
do $$
declare
  g5 uuid;
  r record;
begin
  select id into g5 from games where game_no = 5;
  update games set date_confirmed = true, kickoff_at = now() + interval '21 days'
   where id = g5;
  perform admin_assign_digits(g5, 'test');

  -- Before publish: hidden from public (unchanged v1 behavior).
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select * into r from v_public_games where game_no = 5;
  if r.row_digits is not null then
    raise exception 'TEST FAILURE: unpublished digits visible to anon';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

  perform admin_publish_digits(g5, 'test');

  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select * into r from v_public_games where game_no = 5;
  if r.row_digits is null or r.col_digits is null or r.digits_published_at is null then
    raise exception 'TEST FAILURE: plain publish did not reveal immediately';
  end if;
  if r.status <> 'published' then
    raise exception 'TEST FAILURE: plain publish left public status at %', r.status;
  end if;
  reset role;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

  perform admin_score_game(g5, 'halftime', 3, 7, 'test');

  begin
    perform admin_publish_digits(g5, 'test');
    raise exception 'TEST FAILURE: double publish accepted';
  exception
    when others then
      if sqlerrm not like '%already published%' then raise; end if;
  end;
end $$;

rollback;
