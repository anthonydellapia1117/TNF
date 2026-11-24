-- Migration 43: Thanksgiving game-day automation (Anthony, 2026-11-23, Part N).
-- Approved in the TNF PM chat on 2026-11-23 at 2:53 PM ET; the approval is on
-- its own audit row (admin_audit_note) and on every send's claim row.
--
-- 1. Draw per day, not per week. admin_draw_day draws only the games whose
--    kickoff falls on today's date in the pool's time zone, each its own
--    independent draw with fresh randomness (gen_random_uuid, a strong
--    source), and publishes it at once. A drawn game is never redrawn; a game
--    Anthony drew by hand and did not publish is published. Idempotent: a
--    second call the same day draws and publishes nothing.
-- 2. Locks. Every draw's audit row carries digits_sha256, and
--    admin_verify_digits re-checks every game with digits against its latest
--    draw or override row, digits written with no draw included (no row: not
--    ok). games_digits_immutable keeps rows, columns and seed fixed once any
--    digits exist, from every path, and now also keeps a revealed reveal time
--    fixed. The single exception is admin_override_digits: Anthony's, with a
--    reason, its own audit row in the same transaction, before any score; the
--    lock re-checks the name, the reason and the scores itself, so an audit
--    row written by hand opens nothing the function would refuse. A game with
--    digits is never deleted (games_never_delete_drawn) or truncated, so a
--    published grid cannot be redrawn by delete and insert.
-- 3. The three game-day emails (kickoff_, gameday_ and winners_<date>): To
--    Anthony, Cc RM and MAP, Bcc every holder's own address minus To and Cc,
--    owners' alts and the blocklist. No other owner unless he holds a block,
--    and then as a holder. Plan, claim, record and recipients take the keys;
--    the claim refuses a game-day email whose games are not drawn and
--    published, and a winners email whose games are not scored with a payout
--    behind every winner, so a failed check sends nothing.
-- 4. admin_audit_note: an audited note for an approval, a migration or a
--    routine edit, the three things Part N asked to have on the record.
-- 5. admin_email_claim, the per-recipient claim, refuses every broadcast key
--    (recruit_broadcast_, format_change_, kickoff_, gameday_, winners_<date>):
--    those go only through admin_email_claim_broadcast, with its approval and
--    readiness checks, and a per-recipient row would block the real claim.

-- ---------------------------------------------------------------------------
-- Digits: hash and fresh permutation.
-- ---------------------------------------------------------------------------

create or replace function digits_sha256(p_rows int[], p_cols int[])
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case when p_rows is null or p_cols is null then null
              else encode(sha256(convert_to(array_to_string(p_rows, ',') || '|' || array_to_string(p_cols, ','), 'UTF8')), 'hex')
         end
$$;

-- A fresh permutation of 0-9, ordered by gen_random_uuid (pg_strong_random).
create or replace function digit_permutation()
returns int[]
language sql volatile
set search_path = public, pg_temp
as $$
  select array_agg(d order by gen_random_uuid()) from generate_series(0, 9) as d
$$;

-- The expected hash of a drawn game: its latest draw or override row.
create or replace function digits_expected_sha256(p_game_id uuid)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(a.after ->> 'digits_sha256',
                  digits_sha256(
                    array(select x::int from jsonb_array_elements_text(a.after -> 'row_digits') with ordinality t(x, i) order by i),
                    array(select x::int from jsonb_array_elements_text(a.after -> 'col_digits') with ordinality t(x, i) order by i)))
    from audit_log a
   where a.target_table = 'games'
     and a.target_id = p_game_id::text
     and a.action in ('assign_digits', 'digits_override')
   order by a.id desc
   limit 1
$$;

-- The admin functions below are invokers, so the admin's role calls these.
revoke execute on function digits_expected_sha256(uuid) from public, anon;
grant execute on function digits_expected_sha256(uuid) to authenticated;
revoke execute on function digit_permutation() from public, anon;
grant execute on function digit_permutation() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_assign_digits: the per-game path the /admin/digits fallback uses.
-- Unchanged in its checks; the permutation is fresh from a strong source and
-- the audit row carries the hash. The per-day rule for this path is the app's
-- (src/lib/week-digits.ts, re-checked in the server action), as the 7-day
-- window was.
-- ---------------------------------------------------------------------------

create or replace function admin_assign_digits(p_game_id uuid, p_actor text)
returns games
language plpgsql
set search_path = public, pg_temp
as $$
declare
  g games;
  v_rows int[];
  v_cols int[];
  v_seed text;
begin
  perform assert_admin();
  select * into g from games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game not found';
  end if;
  if not g.date_confirmed then
    raise exception 'G%: digits cannot be assigned while the date is unconfirmed', lpad(g.game_no::text, 2, '0');
  end if;
  if g.kickoff_at is null or g.kickoff_at <= now() then
    raise exception 'G%: digits cannot be assigned at or after kickoff', lpad(g.game_no::text, 2, '0');
  end if;
  if g.digits_assigned_at is not null then
    raise exception 'G%: digits are already assigned and immutable', lpad(g.game_no::text, 2, '0');
  end if;
  if g.row_digits is not null or g.col_digits is not null then
    raise exception 'G%: digits present with no draw; Anthony''s call', lpad(g.game_no::text, 2, '0');
  end if;
  if g.status = 'void' then
    raise exception 'G%: game is void', lpad(g.game_no::text, 2, '0');
  end if;

  v_seed := replace(gen_random_uuid()::text, '-', '');
  v_rows := digit_permutation();
  v_cols := digit_permutation();

  update games
     set row_digits = v_rows, col_digits = v_cols, digit_seed = v_seed,
         digits_assigned_at = now(), status = 'digits_assigned'
   where id = p_game_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'assign_digits', 'games', p_game_id::text,
          jsonb_build_object('game_no', g.game_no, 'seed', v_seed,
                             'row_digits', v_rows, 'col_digits', v_cols,
                             'digits_sha256', digits_sha256(v_rows, v_cols)));
  select * into g from games where id = p_game_id;
  return g;
end $$;

-- ---------------------------------------------------------------------------
-- The lock. Rows, columns, seed and assigned-at are fixed once any digits
-- exist, drawn or written by hand with assigned-at left null, from every role
-- and every path, raw UPDATE included. A revealed reveal time is fixed too, so
-- a past grid can never be hidden again. The one exception is
-- admin_override_digits, recognised by its own audit row in this transaction
-- naming this game and the new digits' hash. The lock re-checks what the
-- function checks (a drawn game, no score, Anthony's name, a reason of 10 or
-- more characters) on that row, so a row inserted by hand opens nothing the
-- function would refuse.
-- ---------------------------------------------------------------------------

create or replace function games_digits_immutable_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (old.digits_assigned_at is not null or old.row_digits is not null or old.col_digits is not null) and (
       new.row_digits is distinct from old.row_digits
    or new.col_digits is distinct from old.col_digits
    or new.digit_seed is distinct from old.digit_seed
    or new.digits_assigned_at is distinct from old.digits_assigned_at
  ) then
    if not (
         coalesce(current_setting('tnf.digits_override', true), '') = old.id::text
     and old.digits_assigned_at is not null
     and old.halftime_scored_at is null
     and old.final_scored_at is null
     and new.digit_seed is not distinct from old.digit_seed
     and new.digits_assigned_at is not distinct from old.digits_assigned_at
     and exists (select 1 from audit_log a
                  where a.action = 'digits_override'
                    and a.target_table = 'games'
                    and a.target_id = old.id::text
                    and a.actor ~* '^anthony'
                    and length(btrim(coalesce(a.after ->> 'reason', ''))) >= 10
                    and a.after ->> 'txid' = txid_current()::text
                    and a.after ->> 'digits_sha256' = digits_sha256(new.row_digits, new.col_digits))
    ) then
      raise exception 'digits are immutable once assigned (game G%)', lpad(old.game_no::text, 2, '0');
    end if;
  end if;
  if old.digits_published_at is not null and old.digits_published_at <= now()
     and new.digits_published_at is distinct from old.digits_published_at then
    raise exception 'G%: published digits stay published', lpad(old.game_no::text, 2, '0');
  end if;
  return new;
end $$;

-- A game with digits is never deleted: delete and insert would redraw a
-- published grid past the lock, and a draw row written beside the new row
-- would satisfy verify. Migration
-- 24 deleted the September games, digits and all, after archiving each row;
-- that is history, long before this trigger, and anything like it again is
-- Anthony's call and its own migration. No suite, script or seed deletes a
-- game.
create or replace function games_never_delete_drawn_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.digits_assigned_at is not null or old.row_digits is not null or old.col_digits is not null then
    raise exception 'G%: a drawn game is never deleted', lpad(old.game_no::text, 2, '0');
  end if;
  return old;
end $$;

create trigger games_never_delete_drawn before delete on games
  for each row execute function games_never_delete_drawn_guard();

-- TRUNCATE fires no row trigger, so the same rule as a statement trigger. A
-- definer, so the invoker's row security cannot hide a drawn game from it.
create or replace function games_never_truncate_drawn_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from games g
              where g.digits_assigned_at is not null or g.row_digits is not null or g.col_digits is not null) then
    raise exception 'games: a drawn game is never deleted, truncate included';
  end if;
  return null;
end $$;

revoke execute on function games_never_truncate_drawn_guard() from public, anon, authenticated;

create trigger games_never_truncate_drawn before truncate on games
  for each statement execute function games_never_truncate_drawn_guard();

-- The audited override: Anthony's alone, with a reason, before any score.
create or replace function admin_override_digits(
  p_game_id uuid,
  p_row_digits int[],
  p_col_digits int[],
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g games;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before text;
  v_after text;
begin
  perform assert_admin();
  if coalesce(p_actor, '') !~* '^anthony' then
    raise exception 'the digits override is Anthony''s alone: the actor must name him';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'the digits override needs a reason';
  end if;
  if cardinality(p_row_digits) is distinct from 10 or cardinality(p_col_digits) is distinct from 10
     or (select array_agg(x order by x) from unnest(p_row_digits) x) is distinct from array[0,1,2,3,4,5,6,7,8,9]
     or (select array_agg(x order by x) from unnest(p_col_digits) x) is distinct from array[0,1,2,3,4,5,6,7,8,9] then
    raise exception 'rows and columns must each be a permutation of 0-9';
  end if;
  select * into g from games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game not found';
  end if;
  if g.digits_assigned_at is null then
    raise exception 'G%: not drawn; draw it instead', lpad(g.game_no::text, 2, '0');
  end if;
  if g.halftime_scored_at is not null or g.final_scored_at is not null then
    raise exception 'G%: scored; digits behind a score never change', lpad(g.game_no::text, 2, '0');
  end if;
  v_before := digits_sha256(g.row_digits, g.col_digits);
  v_after := digits_sha256(p_row_digits, p_col_digits);
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'digits_override', 'games', g.id::text,
          jsonb_build_object('game_no', g.game_no, 'row_digits', g.row_digits, 'col_digits', g.col_digits,
                             'digits_sha256', v_before),
          jsonb_build_object('game_no', g.game_no, 'row_digits', p_row_digits, 'col_digits', p_col_digits,
                             'digits_sha256', v_after, 'txid', txid_current()::text, 'reason', v_reason),
          v_reason);
  perform set_config('tnf.digits_override', g.id::text, true);
  update games set row_digits = p_row_digits, col_digits = p_col_digits where id = g.id;
  perform set_config('tnf.digits_override', '', true);
  return jsonb_build_object('game_no', g.game_no, 'before_sha256', v_before, 'after_sha256', v_after);
end $$;

revoke execute on function admin_override_digits(uuid, int[], int[], text, text) from public, anon;
grant execute on function admin_override_digits(uuid, int[], int[], text, text) to authenticated;

-- Every game with digits against its latest draw or override row. Digits
-- written with no draw (assigned-at null) are in the list and never ok, draw
-- row or not: no draw made them.
create or replace function admin_verify_digits()
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform assert_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
           'game_no', g.game_no,
           'actual', digits_sha256(g.row_digits, g.col_digits),
           'expected', digits_expected_sha256(g.id),
           'ok', g.digits_assigned_at is not null
                 and digits_expected_sha256(g.id) is not null
                 and digits_expected_sha256(g.id) = digits_sha256(g.row_digits, g.col_digits))
         order by g.game_no), '[]'::jsonb)
    into v
    from games g
   where g.digits_assigned_at is not null or g.row_digits is not null or g.col_digits is not null;
  return jsonb_build_object(
    'games', v,
    'all_ok', not exists (select 1 from jsonb_array_elements(v) x where not (x ->> 'ok')::boolean));
end $$;

-- ---------------------------------------------------------------------------
-- The morning run's one call: draw and publish today's games.
-- ---------------------------------------------------------------------------

create or replace function admin_draw_day(p_actor text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from config where id = 1), 'America/New_York');
  v_today date := (now() at time zone v_tz)::date;
  g games;
  v_rows int[];
  v_cols int[];
  v_seed text;
  v_state text;
  v_games jsonb := '[]'::jsonb;
  v_problems jsonb := '[]'::jsonb;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  perform pg_advisory_xact_lock(hashtext('admin_draw_day'));

  for g in
    select * from games
     where status <> 'void'
       and kickoff_at is not null
       and (kickoff_at at time zone v_tz)::date = v_today
     order by kickoff_at, game_no
       for update
  loop
    if g.digits_assigned_at is null then
      -- Digits with no draw are never drawn over, published or sent.
      if g.row_digits is not null or g.col_digits is not null then
        v_problems := v_problems || jsonb_build_object('game_no', g.game_no, 'problem', 'digits present with no draw; Anthony''s call');
        continue;
      end if;
      if not g.date_confirmed then
        v_problems := v_problems || jsonb_build_object('game_no', g.game_no, 'problem', 'date unconfirmed, not drawn');
        continue;
      end if;
      if g.kickoff_at <= now() then
        v_problems := v_problems || jsonb_build_object('game_no', g.game_no, 'problem', 'past kickoff, not drawn');
        continue;
      end if;
      v_rows := digit_permutation();
      v_cols := digit_permutation();
      v_seed := replace(gen_random_uuid()::text, '-', '');
      update games
         set row_digits = v_rows, col_digits = v_cols, digit_seed = v_seed,
             digits_assigned_at = now(), status = 'digits_assigned'
       where id = g.id;
      insert into audit_log (actor, action, target_table, target_id, after)
      values (p_actor, 'assign_digits', 'games', g.id::text,
              jsonb_build_object('game_no', g.game_no, 'seed', v_seed,
                                 'row_digits', v_rows, 'col_digits', v_cols,
                                 'digits_sha256', digits_sha256(v_rows, v_cols),
                                 'draw_date', v_today, 'via', 'admin_draw_day'));
      v_state := 'drawn';
      select * into g from games where id = g.id;
    else
      v_state := 'already_drawn';
    end if;

    if g.digits_published_at is null or g.digits_published_at > now() then
      update games
         set digits_published_at = now(),
             status = case when status in ('scheduled', 'digits_assigned', 'published') then 'published' else status end
       where id = g.id;
      insert into audit_log (actor, action, target_table, target_id, after)
      values (p_actor, 'publish_digits', 'games', g.id::text,
              jsonb_build_object('game_no', g.game_no, 'reveal_at', now(), 'scheduled', false,
                                 'via', 'admin_draw_day'));
      v_state := v_state || '_and_published';
    end if;

    v_games := v_games || jsonb_build_object(
      'game_no', g.game_no, 'kickoff_at', g.kickoff_at, 'state', v_state,
      'row_digits', g.row_digits, 'col_digits', g.col_digits,
      'digits_sha256', digits_sha256(g.row_digits, g.col_digits));
  end loop;

  return jsonb_build_object('date', to_char(v_today, 'YYYY-MM-DD'), 'games', v_games,
                            'problems', v_problems, 'verify', admin_verify_digits());
end $$;

revoke execute on function admin_draw_day(text) from public, anon;
grant execute on function admin_draw_day(text) to authenticated;
revoke execute on function admin_verify_digits() from public, anon;
grant execute on function admin_verify_digits() to authenticated;

-- ---------------------------------------------------------------------------
-- An audited note: an approval, a migration or a routine edit.
-- ---------------------------------------------------------------------------

create or replace function admin_audit_note(
  p_action text,
  p_target text,
  p_note text,
  p_after jsonb,
  p_actor text
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  perform assert_admin();
  if p_action not in ('approval_recorded', 'migration_applied', 'routine_edited') then
    raise exception 'audit note action must be approval_recorded, migration_applied or routine_edited, got %', p_action;
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null or nullif(btrim(coalesce(p_target, '')), '') is null
     or nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'actor, target and note are required';
  end if;
  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, p_action, 'ops', btrim(p_target), coalesce(p_after, '{}'::jsonb), btrim(p_note))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function admin_audit_note(text, text, text, jsonb, text) from public, anon;
grant execute on function admin_audit_note(text, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The three game-day emails.
-- ---------------------------------------------------------------------------

-- One game date's games, as the emails state them: digits only once
-- published, scores as entered, each winning block's public name (the
-- v_public_blocks rule) and the payout behind it. Internal.
create or replace function email_day_facts(p_date date)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with tz as (select coalesce((select timezone from config where id = 1), 'America/New_York') as z),
  d as (
    select g.*, (g.digits_published_at is not null and g.digits_published_at <= now()) as pub
      from games g, tz
     where g.status <> 'void'
       and g.kickoff_at is not null
       and (g.kickoff_at at time zone tz.z)::date = p_date
  )
  select jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'games', coalesce(jsonb_agg(jsonb_build_object(
      'game_no', d.game_no,
      'week', d.week,
      'kickoff_at', d.kickoff_at,
      'holiday_label', d.holiday_label,
      'away_team', d.away_team,
      'home_team', d.home_team,
      'network', d.network,
      'status', d.status,
      'published', d.pub,
      'row_digits', case when d.pub then to_jsonb(d.row_digits) end,
      'col_digits', case when d.pub then to_jsonb(d.col_digits) end,
      'digits_ok', case when d.pub then digits_expected_sha256(d.id) = digits_sha256(d.row_digits, d.col_digits) end,
      'halftime_away', d.halftime_away,
      'halftime_home', d.halftime_home,
      'halftime_block', d.halftime_block,
      'final_away', d.final_away,
      'final_home', d.final_home,
      'final_block', d.final_block,
      'halftime_name', (select coalesce(b.display_name, p.display_alias, p.full_name)
                          from blocks b left join participants p on p.id = b.participant_id
                         where b.block_number = d.halftime_block),
      'final_name', (select coalesce(b.display_name, p.display_alias, p.full_name)
                       from blocks b left join participants p on p.id = b.participant_id
                      where b.block_number = d.final_block),
      'halftime_paid_out', exists (select 1 from payouts y where y.game_id = d.id and y.payout_type = 'halftime'
                                     and y.block_number = d.halftime_block and y.status in ('owed', 'paid')),
      'final_paid_out', exists (select 1 from payouts y where y.game_id = d.id and y.payout_type = 'final'
                                  and y.block_number = d.final_block and y.status in ('owed', 'paid'))
    ) order by d.kickoff_at, d.game_no), '[]'::jsonb))
  from d
$$;

revoke execute on function email_day_facts(date) from public, anon, authenticated;

-- Every holder's own address, and whether it is on To or Cc (Anthony, RM,
-- MAP) or out. Internal.
create or replace function email_day_addresses()
returns table (address text, on_envelope boolean, excluded text)
language sql stable
set search_path = public, pg_temp
as $$
  with h as (select distinct x.recipient as a from email_holder_addresses() x where x.via = 'primary'),
       e as (select lower(btrim(o.email)) as a from owners o
              where o.code in ('AVD', 'RM', 'MAP') and nullif(btrim(o.email), '') is not null),
       alts as (select lower(btrim(o.alt_email)) as a from owners o where nullif(btrim(o.alt_email), '') is not null)
  select h.a,
         h.a in (select a from e),
         case
           when h.a in (select a from e) then null
           when h.a in (select a from alts) then 'owner alt address'
           when h.a in (select email_avd_addresses()) then 'anthony'
           when exists (select 1 from blocked_address_hashes b where b.hash = address_hash(h.a)) then 'blocked'
         end
    from h
$$;

revoke execute on function email_day_addresses() from public, anon, authenticated;

-- Is a day email's content ready? Null when it is, else the reason. Internal.
create or replace function email_day_not_ready(p_event_key text)
returns text
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from config where id = 1), 'America/New_York');
  v_today date := (now() at time zone v_tz)::date;
  v_kind text := substring(p_event_key from '^(kickoff|gameday|winners)_');
  v_date date := substring(p_event_key from '(\d{4}-\d{2}-\d{2})$')::date;
  v_day jsonb;
  g jsonb;
begin
  if v_kind is null or v_date is null then
    return 'not a game-day email key';
  end if;
  if v_kind in ('kickoff', 'gameday') and v_date <> v_today then
    return format('%s goes out on its own date; today is %s', p_event_key, v_today);
  end if;
  if v_kind = 'winners' and v_date not in (v_today, v_today - 1) then
    return format('%s goes out the night of its games or the morning after; today is %s', p_event_key, v_today);
  end if;
  if v_kind = 'kickoff' then
    return null;
  end if;
  v_day := email_day_facts(v_date);
  if jsonb_array_length(v_day -> 'games') = 0 then
    return format('no games on %s', v_date);
  end if;
  for g in select * from jsonb_array_elements(v_day -> 'games') loop
    if not (g ->> 'published')::boolean then
      return format('G%s digits are not published', lpad(g ->> 'game_no', 2, '0'));
    end if;
    if not coalesce((g ->> 'digits_ok')::boolean, false) then
      return format('G%s digits do not match their draw row', lpad(g ->> 'game_no', 2, '0'));
    end if;
    if v_kind = 'winners' then
      if g ->> 'final_block' is null or g ->> 'halftime_block' is null then
        return format('G%s is not scored', lpad(g ->> 'game_no', 2, '0'));
      end if;
      if not (g ->> 'halftime_paid_out')::boolean or not (g ->> 'final_paid_out')::boolean then
        return format('G%s has a winning block with no payout behind it (not assigned): Anthony''s call', lpad(g ->> 'game_no', 2, '0'));
      end if;
    end if;
  end loop;
  return null;
end $$;

revoke execute on function email_day_not_ready(text) from public, anon, authenticated;

-- admin_email_context, migration 34's, with the day keys.
create or replace function admin_email_context(p_event_key text, p_recipient text)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_r text := lower(btrim(coalesce(p_recipient, '')));
  v_out jsonb;
  v_holder jsonb;
begin
  perform assert_admin();
  v_out := jsonb_build_object('event_key', p_event_key,
                              'recipient', v_r,
                              'common', email_common_facts());

  if p_event_key like 'holder\_checkin\_%' then
    v_holder := email_holder_facts(v_r);
    if jsonb_array_length(v_holder -> 'blocks') = 0 then
      raise exception '% holds no committed block; a holder check-in for it would state something false', v_r;
    end if;
    v_out := v_out || jsonb_build_object('holder', v_holder);
  elsif p_event_key like 'digest\_%' then
    v_out := v_out || jsonb_build_object('digest', email_digest_facts());
  elsif p_event_key like 'reply\_%' then
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not on a participant row; the sweep files the sender before it replies', v_r;
    end if;
    v_out := v_out || jsonb_build_object('blocks', (
      select jsonb_agg(jsonb_build_object('block_number', b.block_number, 'status', b.status)
                       order by b.block_number)
        from blocks b));
  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not a participant, prospect or owner address; file the sender before replying', v_r;
    end if;
    v_out := v_out || jsonb_build_object('people', email_people_for(v_r));
  elsif p_event_key ~ '^(kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    v_out := v_out || jsonb_build_object('day', email_day_facts(substring(p_event_key from '(\d{4}-\d{2}-\d{2})$')::date));
  end if;

  return v_out;
end $$;

-- The plan: migration 41's, with the day keys. Their 'to' is Anthony's
-- primary, their 'cc' RM's and MAP's primaries, byte-sorted, and their Bcc
-- every holder's own address that is not one of those three.
create or replace function admin_email_broadcast_plan(p_event_key text)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform assert_admin();
  if p_event_key ~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' then
    select jsonb_build_object(
             'event_key', p_event_key,
             'p', count(*) filter (where a.active_prospect),
             'h', count(*) filter (where a.holder),
             'o', count(*) filter (where a.active_prospect and a.holder),
             't', count(*) filter (where a.on_to),
             'x', count(*) filter (where a.excluded is not null),
             'bcc_count', count(*) filter (where not a.on_to and a.excluded is null),
             'to', (select coalesce(jsonb_agg(lower(btrim(o.email)) order by lower(btrim(o.email)) collate "C"), '[]'::jsonb)
                      from owners o where nullif(btrim(o.email), '') is not null),
             'bcc', coalesce(jsonb_agg(a.address order by a.address collate "C")
                               filter (where not a.on_to and a.excluded is null), '[]'::jsonb),
             'omitted_owners', (select coalesce(jsonb_agg(o.code order by o.code), '[]'::jsonb)
                                  from owners o where nullif(btrim(o.email), '') is null))
      into v
      from email_recruit_broadcast_addresses() a;
    return v;
  elsif p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$' then
    if not exists (select 1 from owners where code = 'AVD' and nullif(btrim(email), '') is not null) then
      raise exception 'AVD has no address on the owners table; the format email is To Anthony';
    end if;
    select jsonb_build_object(
             'event_key', p_event_key,
             'p', 0,
             'h', count(*),
             'o', 0,
             't', count(*) filter (where a.on_to),
             'x', count(*) filter (where a.excluded is not null),
             'bcc_count', count(*) filter (where not a.on_to and a.excluded is null),
             'to', (select jsonb_build_array(lower(btrim(o.email))) from owners o where o.code = 'AVD'),
             'cc', (select coalesce(jsonb_agg(lower(btrim(o.email)) order by lower(btrim(o.email)) collate "C"), '[]'::jsonb)
                      from owners o where o.code <> 'AVD' and nullif(btrim(o.email), '') is not null),
             'bcc', coalesce(jsonb_agg(a.address order by a.address collate "C")
                               filter (where not a.on_to and a.excluded is null), '[]'::jsonb),
             'omitted_owners', (select coalesce(jsonb_agg(o.code order by o.code), '[]'::jsonb)
                                  from owners o where nullif(btrim(o.email), '') is null))
      into v
      from email_format_change_addresses() a;
    return v;
  elsif p_event_key ~ '^(kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    if (select count(*) from owners o where o.code in ('AVD', 'RM', 'MAP') and nullif(btrim(o.email), '') is not null) <> 3 then
      raise exception 'the game-day emails are To Anthony and Cc RM and MAP; one of the three has no address on the owners table';
    end if;
    select jsonb_build_object(
             'event_key', p_event_key,
             'p', 0,
             'h', count(*),
             'o', 0,
             't', count(*) filter (where a.on_envelope),
             'x', count(*) filter (where a.excluded is not null),
             'bcc_count', count(*) filter (where not a.on_envelope and a.excluded is null),
             'to', (select jsonb_build_array(lower(btrim(o.email))) from owners o where o.code = 'AVD'),
             'cc', (select jsonb_agg(lower(btrim(o.email)) order by lower(btrim(o.email)) collate "C")
                      from owners o where o.code in ('RM', 'MAP')),
             'bcc', coalesce(jsonb_agg(a.address order by a.address collate "C")
                               filter (where not a.on_envelope and a.excluded is null), '[]'::jsonb),
             'omitted_owners', '[]'::jsonb)
      into v
      from email_day_addresses() a;
    return v;
  end if;
  raise exception 'no broadcast plan for event %', p_event_key;
end $$;

-- The claim: migration 41's, with the day keys. A day key needs the
-- approval, names no owner to leave off (only RM and MAP are on it), and is
-- refused unless its content is ready (email_day_not_ready).
create or replace function admin_email_claim_broadcast(
  p_event_key text,
  p_rendered_sha text,
  p_omit_owners text[],
  p_min_bcc int,
  p_max_bcc int,
  p_actor text,
  p_approval text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan jsonb;
  v_omit text[];
  v_missing text[];
  v_to text[];
  v_cc text[];
  v_bcc text[];
  v_all text[];
  v_n int;
  v_md5 text;
  v_code text;
  v_claim uuid := gen_random_uuid();
  v_format boolean := p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$';
  v_day boolean := p_event_key ~ '^(kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$';
  v_approval text := nullif(btrim(coalesce(p_approval, '')), '');
  v_not_ready text;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if p_event_key !~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' and not v_format and not v_day then
    raise exception 'not a broadcast event: %', p_event_key;
  end if;
  if v_format and v_approval is null then
    raise exception 'the format email needs the approval: where and when Anthony approved this send';
  end if;
  if v_day and v_approval is null then
    raise exception 'a game-day email needs the approval: where and when Anthony approved these templates';
  end if;
  if coalesce(p_rendered_sha, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'rendered sha must be 64 hex characters';
  end if;
  if p_min_bcc is null or p_max_bcc is null or p_min_bcc < 0 or p_max_bcc < p_min_bcc then
    raise exception 'a Bcc range is required, min no more than max';
  end if;

  -- One claim per broadcast, whoever races it.
  perform pg_advisory_xact_lock(hashtext('admin_email_claim_broadcast:' || p_event_key));
  if exists (select 1 from email_sends s where s.event_key = p_event_key) then
    raise exception 'already claimed: %. A broadcast goes once; check Gmail Sent and admin_email_unsent first.', p_event_key;
  end if;

  select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}')
    into v_omit
    from unnest(coalesce(p_omit_owners, '{}')) c
   where nullif(btrim(c), '') is not null;
  if v_day then
    -- Only Anthony, RM and MAP are on a day email's envelope; nobody is left off.
    if cardinality(v_omit) > 0 then
      raise exception 'refused: a game-day email leaves no owner off; it names only Anthony, RM and MAP';
    end if;
    v_not_ready := email_day_not_ready(p_event_key);
    if v_not_ready is not null then
      raise exception 'refused: %', v_not_ready;
    end if;
  else
    -- The one-time override names exactly the owners with no address.
    select coalesce(array_agg(o.code order by o.code), '{}')
      into v_missing
      from owners o
     where nullif(btrim(o.email), '') is null;
    if v_omit is distinct from v_missing then
      raise exception 'refused: owners with no address are {%}; the override names {%}. Name exactly the owners left off, or set their addresses.',
        array_to_string(v_missing, ','), array_to_string(v_omit, ',');
    end if;
  end if;

  v_plan := admin_email_broadcast_plan(p_event_key);
  v_n := (v_plan ->> 'bcc_count')::int;
  if v_n < p_min_bcc or v_n > p_max_bcc then
    raise exception 'refused: Bcc is %, outside % to %', v_n, p_min_bcc, p_max_bcc;
  end if;
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_to from jsonb_array_elements_text(v_plan -> 'to') x;
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_cc from jsonb_array_elements_text(coalesce(v_plan -> 'cc', '[]'::jsonb)) x;
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_bcc from jsonb_array_elements_text(v_plan -> 'bcc') x;
  v_all := v_to || v_cc || v_bcc;

  if v_day then
    -- An owner who holds a block is in Bcc as a holder; an owner's alt never is.
    if exists (select 1 from unnest(v_all) a
                where a in (select lower(btrim(o.alt_email)) from owners o where nullif(btrim(o.alt_email), '') is not null)) then
      raise exception 'refused: an owner alt address is on the envelope';
    end if;
  elsif exists (select 1 from unnest(v_bcc) b where b in (select email_owner_addresses())) then
    raise exception 'refused: an owner address is in Bcc';
  end if;
  if exists (select 1 from unnest(v_all) a join blocked_address_hashes h on h.hash = address_hash(a)) then
    raise exception 'refused: an address on the envelope is on blocked_address_hashes';
  end if;
  if (select count(distinct a) from unnest(v_all) a) <> cardinality(v_all) then
    raise exception 'refused: an address is on the envelope twice';
  end if;
  if v_format then
    -- To is Anthony, Cc is owners' primaries, Bcc is holders: nobody else.
    if v_to is distinct from (select array_agg(lower(btrim(o.email))) from owners o where o.code = 'AVD') then
      raise exception 'refused: the format email is To Anthony alone';
    end if;
    if exists (select 1 from unnest(v_cc) c
                where c not in (select lower(btrim(o.email)) from owners o where o.code <> 'AVD' and nullif(btrim(o.email), '') is not null)) then
      raise exception 'refused: a Cc address is not an owner''s primary';
    end if;
    if exists (select 1 from unnest(v_bcc) b
                where b not in (select h.recipient from email_holder_addresses() h where h.via = 'primary')) then
      raise exception 'refused: a Bcc address is not a holder''s own';
    end if;
  end if;
  if v_day then
    -- To is Anthony, Cc is exactly RM and MAP, Bcc is holders: nobody else.
    if v_to is distinct from (select array_agg(lower(btrim(o.email))) from owners o where o.code = 'AVD') then
      raise exception 'refused: a game-day email is To Anthony alone';
    end if;
    if v_cc is distinct from (select array_agg(lower(btrim(o.email)) order by lower(btrim(o.email)) collate "C")
                                from owners o where o.code in ('RM', 'MAP')) then
      raise exception 'refused: a game-day email is Cc RM and MAP, nobody else';
    end if;
    if exists (select 1 from unnest(v_bcc) b
                where b not in (select h.recipient from email_holder_addresses() h where h.via = 'primary')) then
      raise exception 'refused: a Bcc address is not a holder''s own';
    end if;
  end if;

  insert into email_sends (event_key, recipient, rendered_sha)
  select p_event_key, a, p_rendered_sha from unnest(v_all) a;

  v_md5 := case when cardinality(v_cc) = 0
                then md5(array_to_string(v_to, ',') || '|' || array_to_string(v_bcc, ','))
                else md5(array_to_string(v_to, ',') || '|' || array_to_string(v_cc, ',') || '|' || array_to_string(v_bcc, ','))
           end;

  -- No address in either audit row: the rows in email_sends carry them, under RLS.
  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'email_claim_broadcast', 'email_sends', p_event_key,
          jsonb_build_object('event_key', p_event_key, 'rendered_sha', p_rendered_sha,
                             'to', cardinality(v_to), 'cc', cardinality(v_cc), 'bcc', v_n,
                             'p', v_plan -> 'p', 'h', v_plan -> 'h', 'o', v_plan -> 'o',
                             't', v_plan -> 't', 'x', v_plan -> 'x',
                             'envelope_md5', v_md5, 'omitted_owners', to_jsonb(v_omit),
                             'claim_id', v_claim, 'approval', v_approval),
          v_approval);
  foreach v_code in array v_omit loop
    insert into audit_log (actor, action, target_table, target_id, after, note)
    values (p_actor, 'broadcast_owner_omitted', 'owners', v_code,
            jsonb_build_object('event_key', p_event_key),
            case when v_format
                 then 'no address on the owners table: left off Cc for this one send by an explicit override'
                 else 'no address on the owners table: left off To for this one send by an explicit override' end);
  end loop;

  return jsonb_build_object('event_key', p_event_key, 'claimed', cardinality(v_all),
                            'to', cardinality(v_to), 'cc', cardinality(v_cc), 'bcc', v_n,
                            'envelope_md5', v_md5, 'omitted_owners', to_jsonb(v_omit),
                            'claim_id', v_claim);
end $$;

revoke execute on function admin_email_claim_broadcast(text,text,text[],int,int,text,text) from public, anon;
grant execute on function admin_email_claim_broadcast(text,text,text[],int,int,text,text) to authenticated;

-- Record: migration 41's, with the day keys allowed.
create or replace function admin_email_record_sent_broadcast(
  p_event_key text,
  p_gmail_message_id text,
  p_rendered_sha text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mid text := nullif(btrim(coalesce(p_gmail_message_id, '')), '');
  v_rows int;
  v_unsent int;
  v_other text;
  v_mismatch int;
  v_status text;
  v_n int;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if v_mid is null then
    raise exception 'gmail message id required';
  end if;
  if p_event_key !~ '^(recruit_broadcast|format_change|kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    raise exception 'not a broadcast event: %', p_event_key;
  end if;

  perform 1 from email_sends where event_key = p_event_key for update;
  select count(*),
         count(*) filter (where gmail_message_id is null),
         min(gmail_message_id) filter (where gmail_message_id is not null and gmail_message_id <> v_mid),
         count(*) filter (where rendered_sha <> p_rendered_sha)
    into v_rows, v_unsent, v_other, v_mismatch
    from email_sends
   where event_key = p_event_key;
  if v_rows = 0 then
    raise exception 'no claim for %: a send with no claim is what this ledger exists to prevent', p_event_key;
  end if;
  if v_other is not null then
    raise exception 'already recorded with message %, refusing %', v_other, v_mid;
  end if;
  if v_unsent = 0 then
    return jsonb_build_object('status', 'already_recorded', 'rows', v_rows);
  end if;

  v_status := case when v_mismatch = 0 then 'recorded' else 'sha_mismatch' end;
  update email_sends set gmail_message_id = v_mid, sent_at = now()
   where event_key = p_event_key and gmail_message_id is null;
  get diagnostics v_n = row_count;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor,
          case when v_status = 'recorded' then 'email_sent_broadcast' else 'email_sent_broadcast_sha_mismatch' end,
          'email_sends', p_event_key,
          jsonb_build_object('event_key', p_event_key, 'gmail_message_id', v_mid,
                             'rows', v_n, 'sent_sha', p_rendered_sha));
  return jsonb_build_object('status', v_status, 'rows', v_n);
end $$;

-- Recipients: migration 41's, with the day keys first.
create or replace function admin_email_recipients(p_event_key text)
returns table (recipient text)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();

  if p_event_key ~ '^(kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    -- The game-day emails (migration 43): Anthony, RM and MAP, and the
    -- plan's Bcc, each holder's own address.
    return query
      select lower(btrim(o.email)) from owners o
       where o.code in ('AVD', 'RM', 'MAP') and nullif(btrim(o.email), '') is not null
      union
      select a.address from email_day_addresses() a
       where not a.on_envelope and a.excluded is null
      order by 1;

  elsif p_event_key ~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' then
    return query
      select lower(btrim(o.email)) from owners o where nullif(btrim(o.email), '') is not null
      union
      select a.address from email_recruit_broadcast_addresses() a
       where not a.on_to and a.excluded is null
      order by 1;

  elsif p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$' then
    return query
      select lower(btrim(o.email)) from owners o where nullif(btrim(o.email), '') is not null
      union
      select a.address from email_format_change_addresses() a
       where not a.on_to and a.excluded is null
      order by 1;

  elsif p_event_key like 'holder\_checkin\_%' or p_event_key like 'game\_day\_%' then
    return query
      select distinct h.recipient
        from email_holder_addresses() h
       where h.recipient not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'recruit\_%' then
    return query
      select p.email
        from prospects p
       where p.excluded_at is null
         and p.email not in (select h.recipient from email_holder_addresses() h)
         and p.email not in (select email_owner_addresses())
         and p.email not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'reply\_%' then
    return query
      select distinct a.addr
        from participants p,
             unnest(array[lower(btrim(p.email)), lower(btrim(p.cc_email))]) as a(addr)
       where nullif(a.addr, '') is not null
         and a.addr not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    return query
      select a.a from email_pool_addresses() a(a) order by 1;

  else
    raise exception 'no recipient rule for event %', p_event_key;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The per-recipient claim: migration 33's, verbatim, with one guard first. A
-- broadcast key goes only through admin_email_claim_broadcast, which holds the
-- approval and the readiness checks. admin_email_recipients answers for every
-- broadcast key (the day keys since this migration), so without the guard
-- admin_email_claim('winners_<today>', <Anthony>, ...) would claim with
-- neither, and its row would then refuse the real broadcast claim as already
-- claimed. Nothing claims a broadcast key per recipient: no suite, script or
-- prompt does. Same signature, so migration 33's grants stand; restated.
-- ---------------------------------------------------------------------------

create or replace function admin_email_claim(
  p_event_key text,
  p_recipient text,
  p_rendered_sha text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r text := lower(btrim(coalesce(p_recipient, '')));
  v_row email_sends;
  v_id uuid;
begin
  perform assert_admin();
  -- Migration 43: a broadcast key is never claimed per recipient.
  if p_event_key ~ '^(recruit_broadcast|format_change|kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    raise exception '% is a broadcast: use admin_email_claim_broadcast', p_event_key;
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;

  select * into v_row from email_sends where event_key = p_event_key and recipient = v_r;
  if found then
    if v_row.gmail_message_id is null then
      raise exception 'already claimed and NOT confirmed sent: event %, recipient %, claimed %. Never resent automatically: check Gmail Sent first.',
        p_event_key, v_r, v_row.claimed_at;
    end if;
    raise exception 'already sent: event %, recipient %, message %', p_event_key, v_r, v_row.gmail_message_id;
  end if;

  if p_event_key ~ '^reply_t[1-7]_' and exists (
       select 1 from email_sends
        where event_key ~ '^reply_t[1-7]_'
          and substring(event_key from '^reply_t[1-7]_(.+)$') = substring(p_event_key from '^reply_t[1-7]_(.+)$')) then
    raise exception 'already replied on this thread: %. Never twice to the same thread.', p_event_key;
  end if;

  if not exists (select 1 from admin_email_recipients(p_event_key) d where d.recipient = v_r) then
    raise exception 'refused: % is not a derived recipient of %', v_r, p_event_key;
  end if;

  insert into email_sends (event_key, recipient, rendered_sha)
  values (p_event_key, v_r, p_rendered_sha)
  returning id into v_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'email_claim', 'email_sends', v_id::text,
          -- No address: target_id is the email_sends row, which keeps it under RLS.
          jsonb_build_object('event_key', p_event_key, 'rendered_sha', p_rendered_sha));
  return v_id;
end $$;

revoke execute on function admin_email_claim(text, text, text, text) from public, anon;
grant execute on function admin_email_claim(text, text, text, text) to authenticated;
