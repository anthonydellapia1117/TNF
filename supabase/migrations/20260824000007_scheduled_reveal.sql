-- Scheduled digit reveal: publishing can set digits_published_at in the
-- FUTURE. The public projection compares it to now() on every read, so the
-- reveal fires at the chosen moment with no admin action and no cron —
-- and a scheduled-but-unrevealed digit set never appears in the public
-- payload at all (devtools included). Admin reads the raw table and always
-- sees assigned digits. Block numbers and owners are never gated — only
-- the digits are the reveal.

-- The publish RPC gains an optional publish-at. Drop the old signature
-- first so PostgREST never sees an ambiguous overload.
drop function if exists admin_publish_digits(uuid, text);

create or replace function admin_publish_digits(
  p_game_id uuid,
  p_actor text,
  p_publish_at timestamptz default null
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  g games;
  v_at timestamptz;
begin
  perform assert_admin();
  select * into g from games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game not found';
  end if;
  if g.digits_assigned_at is null then
    raise exception 'G%: assign digits before publishing', lpad(g.game_no::text, 2, '0');
  end if;
  -- A future schedule may be overridden (publish now, or re-schedule);
  -- once revealed, digits are out and publishing again is meaningless.
  if g.digits_published_at is not null and g.digits_published_at <= now() then
    raise exception 'G%: digits are already published', lpad(g.game_no::text, 2, '0');
  end if;
  v_at := coalesce(p_publish_at, now());
  update games set digits_published_at = v_at, status = 'published' where id = p_game_id;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'publish_digits', 'games', p_game_id::text,
          jsonb_build_object('game_no', g.game_no, 'reveal_at', v_at,
                             'scheduled', v_at > now()));
end $$;

do $$
begin
  execute 'revoke execute on function admin_publish_digits(uuid,text,timestamptz) from public, anon';
  execute 'grant execute on function admin_publish_digits(uuid,text,timestamptz) to authenticated';
end $$;

-- Scoring and live mode wait for the REVEAL, not just the publish click.
create or replace function admin_score_game(
  p_game_id uuid,
  p_type text,
  p_away int,
  p_home int,
  p_actor text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  g games;
  b blocks;
  v_block int;
  v_amount int;
  v_existing payouts;
  v_payout_created boolean := false;
  v_review boolean := false;
begin
  perform assert_admin();
  if p_type not in ('halftime', 'final') then
    raise exception 'score type must be halftime or final';
  end if;
  if p_away is null or p_home is null or p_away < 0 or p_home < 0 then
    raise exception 'scores must be non-negative numbers';
  end if;
  select * into g from games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game not found';
  end if;
  if g.digits_published_at is null or g.digits_published_at > now() then
    raise exception 'G%: cannot score before digits are published', lpad(g.game_no::text, 2, '0');
  end if;

  select * into v_existing from payouts where game_id = p_game_id and payout_type = p_type;
  if v_existing.id is not null and v_existing.status = 'paid' then
    raise exception 'G% %: payout already settled — cannot re-score', lpad(g.game_no::text, 2, '0'), p_type;
  end if;

  v_block := winning_block(g.row_digits, g.col_digits, p_home, p_away);
  select case
           when g.game_type = 'holiday' and p_type = 'halftime' then c.holiday_halftime_cents
           when g.game_type = 'holiday' then c.holiday_final_cents
           when p_type = 'halftime' then c.regular_halftime_cents
           else c.regular_final_cents
         end
    into v_amount
    from config c;

  if p_type = 'halftime' then
    update games
       set halftime_home = p_home, halftime_away = p_away, halftime_block = v_block,
           halftime_scored_at = now(),
           status = case when status in ('final', 'void') then status else 'halftime' end
     where id = p_game_id;
  else
    update games
       set final_home = p_home, final_away = p_away, final_block = v_block,
           final_scored_at = now(), status = 'final'
     where id = p_game_id;
  end if;

  select * into b from blocks where block_number = v_block;

  if b.status = 'assigned' then
    insert into payouts (game_id, payout_type, block_number, participant_id, amount_cents)
    values (p_game_id, p_type, v_block, b.participant_id, v_amount)
    on conflict (game_id, payout_type) do update
      set block_number = excluded.block_number,
          participant_id = excluded.participant_id,
          amount_cents = excluded.amount_cents,
          status = 'owed',
          note = 'corrected by re-score';
    v_payout_created := true;
  else
    if v_existing.id is not null and v_existing.status = 'owed' then
      update payouts set status = 'void', note = 'voided on re-score: winning block not assigned'
       where id = v_existing.id;
    end if;
    v_review := true;
    update games
       set notes = trim(both E'\n' from coalesce(notes, '') || E'\n'
             || 'REVIEW ' || upper(p_type) || ': winning block ' || v_block
             || ' is ' || b.status || ' — no payout created')
     where id = p_game_id;
    insert into audit_log (actor, action, target_table, target_id, after, note)
    values (p_actor, 'review_flag', 'games', p_game_id::text,
            jsonb_build_object('game_no', g.game_no, 'type', p_type,
                               'block', v_block, 'block_status', b.status),
            'winning block not assigned — no payout');
  end if;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'score_' || p_type, 'games', p_game_id::text,
          jsonb_build_object('game_no', g.game_no, 'away', p_away, 'home', p_home,
                             'block', v_block, 'payout_created', v_payout_created));

  return jsonb_build_object(
    'block', v_block, 'amount_cents', v_amount,
    'payout_created', v_payout_created, 'review', v_review,
    'winner_status', b.status,
    'winner_name', (select coalesce(p.display_alias, p.full_name)
                      from participants p where p.id = b.participant_id));
end $$;

create or replace function admin_set_live(p_game_id uuid, p_away int, p_home int, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  g games;
begin
  perform assert_admin();
  select * into g from games where id = p_game_id for update;
  if g.id is null then
    raise exception 'game not found';
  end if;
  if g.digits_published_at is null or g.digits_published_at > now() then
    raise exception 'G%: publish digits before going live', lpad(g.game_no::text, 2, '0');
  end if;
  if g.status = 'final' then
    raise exception 'G%: game is already final', lpad(g.game_no::text, 2, '0');
  end if;
  update games
     set live_home = p_home, live_away = p_away, live_updated_at = now(),
         status = case when status = 'published' then 'in_progress' else status end
   where id = p_game_id;
end $$;

-- Public projection: digits, the publish timestamp, and the published
-- status all stay invisible until the reveal instant passes.
create or replace view v_public_games as
select
  g.id, g.game_no, g.week, g.kickoff_at, g.date_confirmed, g.game_type,
  g.holiday_label, g.home_team, g.away_team, g.network,
  case when g.digits_published_at is not null and g.digits_published_at <= now()
       then g.row_digits end as row_digits,
  case when g.digits_published_at is not null and g.digits_published_at <= now()
       then g.col_digits end as col_digits,
  (g.digits_assigned_at is not null) as digits_assigned,
  case when g.digits_published_at is not null and g.digits_published_at <= now()
       then g.digits_published_at end as digits_published_at,
  g.live_home, g.live_away, g.live_updated_at,
  g.halftime_home, g.halftime_away, g.halftime_block, g.halftime_scored_at,
  g.final_home, g.final_away, g.final_block, g.final_scored_at,
  case when g.status = 'published'
        and g.digits_published_at is not null
        and g.digits_published_at > now()
       then 'digits_assigned' else g.status end as status
from games g;
