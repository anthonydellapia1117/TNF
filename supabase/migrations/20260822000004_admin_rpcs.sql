-- Admin write RPCs. Every function runs as the signed-in admin (security
-- invoker — RLS still applies underneath) and writes its data AND its audit
-- row in one transaction. Each starts with the is_admin() gate so a
-- non-admin caller gets a clear refusal instead of a silent zero-row update.

create or replace function assert_admin() returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------

create or replace function admin_upsert_participant(
  p_id uuid,                       -- null = create
  p_full_name text,
  p_display_alias text,
  p_email text,
  p_phone text,
  p_owner_group text,
  p_shared_group_id text,
  p_source text,
  p_source_ref text,
  p_blocks_requested int,
  p_notes text,
  p_actor text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_before jsonb;
begin
  perform assert_admin();
  if v_id is null then
    insert into participants (full_name, display_alias, email, phone, owner_group,
                              shared_group_id, source, source_ref, blocks_requested, notes)
    values (p_full_name, nullif(p_display_alias, ''), nullif(p_email, ''), nullif(p_phone, ''),
            coalesce(nullif(p_owner_group, ''), 'DIRECT'), nullif(p_shared_group_id, ''),
            coalesce(nullif(p_source, ''), 'email'), nullif(p_source_ref, ''),
            coalesce(p_blocks_requested, 0), nullif(p_notes, ''))
    returning id into v_id;
    insert into audit_log (actor, action, target_table, target_id, after)
    values (p_actor, 'create_participant', 'participants', v_id::text,
            jsonb_build_object('full_name', p_full_name, 'alias', p_display_alias));
  else
    select to_jsonb(p) into v_before from participants p where p.id = v_id;
    if v_before is null then
      raise exception 'participant % not found', v_id;
    end if;
    update participants set
      full_name = p_full_name,
      display_alias = nullif(p_display_alias, ''),
      email = nullif(p_email, ''),
      phone = nullif(p_phone, ''),
      owner_group = coalesce(nullif(p_owner_group, ''), 'DIRECT'),
      shared_group_id = nullif(p_shared_group_id, ''),
      source = coalesce(nullif(p_source, ''), 'email'),
      source_ref = nullif(p_source_ref, ''),
      blocks_requested = coalesce(p_blocks_requested, 0),
      notes = nullif(p_notes, '')
    where id = v_id;
    insert into audit_log (actor, action, target_table, target_id, before, after)
    values (p_actor, 'update_participant', 'participants', v_id::text, v_before,
            (select to_jsonb(p) from participants p where p.id = v_id));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Blocks: reserve / assign / hold / release. The 100-row set only mutates.
-- ---------------------------------------------------------------------------

create or replace function admin_reserve_blocks(
  p_block_numbers int[],
  p_participant_id uuid,
  p_method text,                   -- 'requested' | 'carryover' | 'random' | 'admin'
  p_ref text,
  p_actor text
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n int;
  v_status text;
begin
  perform assert_admin();
  if p_block_numbers is null or array_length(p_block_numbers, 1) is null then
    raise exception 'no block numbers given';
  end if;
  foreach v_n in array p_block_numbers loop
    select status into v_status from blocks where block_number = v_n for update;
    if v_status is null then
      raise exception 'block % does not exist', v_n;
    end if;
    if v_status <> 'available' then
      raise exception 'block % is % — only an available block can be reserved', v_n, v_status;
    end if;
    update blocks
       set participant_id = p_participant_id,
           status = 'reserved',
           assignment_method = coalesce(nullif(p_method, ''), 'admin'),
           requested_ref = nullif(p_ref, '')
     where block_number = v_n;
  end loop;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'reserve_blocks', 'blocks', array_to_string(p_block_numbers, ','),
          jsonb_build_object('participant_id', p_participant_id, 'method', p_method));
  return array_length(p_block_numbers, 1);
end $$;

create or replace function admin_release_block(p_block_number int, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
begin
  perform assert_admin();
  select to_jsonb(b) into v_before from blocks b where b.block_number = p_block_number for update;
  if v_before is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  update blocks
     set participant_id = null, status = 'available', assignment_method = null,
         requested_ref = null, assigned_at = null
   where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'release_block', 'blocks', p_block_number::text, v_before);
end $$;

create or replace function admin_hold_block(p_block_number int, p_note text, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from blocks where block_number = p_block_number for update;
  if v_status is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  if v_status <> 'available' then
    raise exception 'block % is % — only an available block can be held', p_block_number, v_status;
  end if;
  update blocks set status = 'held', participant_id = null, notes = nullif(p_note, '')
   where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, note)
  values (p_actor, 'hold_block', 'blocks', p_block_number::text, p_note);
end $$;

-- Full payment promotes ALL of a participant's Reserved blocks to Assigned in
-- one transaction. Partial payment promotes nothing (spec section 3).
create or replace function admin_promote_if_paid(p_participant_id uuid, p_actor text) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_due bigint;
  v_paid bigint;
  v_count int := 0;
begin
  perform assert_admin();
  select amount_due_cents, amount_paid_cents into v_due, v_paid
    from v_participant_finance where participant_id = p_participant_id;
  if v_due is null then
    raise exception 'participant % not found', p_participant_id;
  end if;
  if v_due > 0 and v_paid >= v_due then
    update blocks
       set status = 'assigned', assigned_at = coalesce(assigned_at, now())
     where participant_id = p_participant_id and status = 'reserved';
    get diagnostics v_count = row_count;
    if v_count > 0 then
      insert into audit_log (actor, action, target_table, target_id, after)
      values (p_actor, 'promote_blocks', 'blocks', p_participant_id::text,
              jsonb_build_object('promoted', v_count, 'due_cents', v_due, 'paid_cents', v_paid));
    end if;
  end if;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Payments: append-only ledger. Recording a payment auto-runs the promotion
-- check so a full payment promotes in the same transaction.
-- ---------------------------------------------------------------------------

create or replace function admin_record_payment(
  p_participant_id uuid,
  p_amount_cents int,
  p_method text,
  p_paid_on date,
  p_venmo_txn_id text,
  p_source_ref text,
  p_note text,
  p_corrects_payment_id uuid,
  p_actor text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform assert_admin();
  insert into payments (participant_id, amount_cents, method, paid_on,
                        venmo_txn_id, source_ref, note, corrects_payment_id)
  values (p_participant_id, p_amount_cents, p_method, p_paid_on,
          nullif(p_venmo_txn_id, ''), nullif(p_source_ref, ''), nullif(p_note, ''),
          p_corrects_payment_id)
  returning id into v_id;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'record_payment', 'payments', v_id::text,
          jsonb_build_object('participant_id', p_participant_id,
                             'amount_cents', p_amount_cents, 'method', p_method));
  if p_participant_id is not null then
    perform admin_promote_if_paid(p_participant_id, p_actor);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Games: schedule editing.
-- ---------------------------------------------------------------------------

create or replace function admin_update_game(
  p_game_id uuid,
  p_week int,
  p_kickoff_at timestamptz,
  p_date_confirmed boolean,
  p_game_type text,
  p_holiday_label text,
  p_home_team text,
  p_away_team text,
  p_network text,
  p_notes text,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
begin
  perform assert_admin();
  select to_jsonb(g) into v_before from games g where g.id = p_game_id;
  if v_before is null then
    raise exception 'game not found';
  end if;
  update games set
    week = p_week,
    kickoff_at = p_kickoff_at,
    date_confirmed = p_date_confirmed,
    game_type = p_game_type,
    holiday_label = nullif(p_holiday_label, ''),
    home_team = p_home_team,
    away_team = p_away_team,
    network = nullif(p_network, ''),
    notes = nullif(p_notes, '')
  where id = p_game_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_game', 'games', p_game_id::text, v_before,
          (select to_jsonb(g) from games g where g.id = p_game_id));
end $$;

-- ---------------------------------------------------------------------------
-- Digits. Assignment and publish are separate deliberate steps (spec 4.7).
-- Gates (spec section 3): never on an unconfirmed date, never after kickoff,
-- never twice. Immutability is enforced by the schema trigger regardless.
-- ---------------------------------------------------------------------------

create or replace function admin_assign_digits(p_game_id uuid, p_actor text) returns games
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
  if g.status = 'void' then
    raise exception 'G%: game is void', lpad(g.game_no::text, 2, '0');
  end if;

  v_seed := replace(gen_random_uuid()::text, '-', '');
  select array_agg(d order by random()) into v_rows from generate_series(0, 9) as d;
  select array_agg(d order by random()) into v_cols from generate_series(0, 9) as d;

  update games
     set row_digits = v_rows, col_digits = v_cols, digit_seed = v_seed,
         digits_assigned_at = now(), status = 'digits_assigned'
   where id = p_game_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'assign_digits', 'games', p_game_id::text,
          jsonb_build_object('game_no', g.game_no, 'seed', v_seed,
                             'row_digits', v_rows, 'col_digits', v_cols));
  select * into g from games where id = p_game_id;
  return g;
end $$;

create or replace function admin_publish_digits(p_game_id uuid, p_actor text) returns void
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
  if g.digits_assigned_at is null then
    raise exception 'G%: assign digits before publishing', lpad(g.game_no::text, 2, '0');
  end if;
  if g.digits_published_at is not null then
    raise exception 'G%: digits are already published', lpad(g.game_no::text, 2, '0');
  end if;
  update games set digits_published_at = now(), status = 'published' where id = p_game_id;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'publish_digits', 'games', p_game_id::text,
          jsonb_build_object('game_no', g.game_no));
end $$;

-- ---------------------------------------------------------------------------
-- Scoring. Refuses before publish. A winning block that is not Assigned
-- produces NO payout and raises a review flag (spec section 3).
-- ---------------------------------------------------------------------------

create or replace function admin_score_game(
  p_game_id uuid,
  p_type text,                     -- 'halftime' | 'final'
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
  if g.digits_published_at is null then
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
    -- Never pay an unassigned block: record the score, no payout, review flag.
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

-- Live score: pushes the current score to the public grid as IF IT ENDED NOW.
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
  if g.digits_published_at is null then
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

create or replace function admin_clear_live(p_game_id uuid, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();
  update games
     set live_home = null, live_away = null, live_updated_at = null,
         status = case when status = 'in_progress' then 'published' else status end
   where id = p_game_id;
end $$;

-- ---------------------------------------------------------------------------
-- Payouts: owed → paid. Only Anthony marks paid; the app never moves money.
-- ---------------------------------------------------------------------------

create or replace function admin_settle_payout(
  p_payout_id uuid, p_paid_on date, p_method text, p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
begin
  perform assert_admin();
  select to_jsonb(po) into v_before from payouts po where po.id = p_payout_id for update;
  if v_before is null then
    raise exception 'payout not found';
  end if;
  if v_before ->> 'status' <> 'owed' then
    raise exception 'payout is % — only an owed payout can be marked paid', v_before ->> 'status';
  end if;
  update payouts
     set status = 'paid', paid_on = coalesce(p_paid_on, current_date), method = nullif(p_method, '')
   where id = p_payout_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'settle_payout', 'payouts', p_payout_id::text, v_before,
          (select to_jsonb(po) from payouts po where po.id = p_payout_id));
end $$;

create or replace function admin_reopen_payout(p_payout_id uuid, p_note text, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
begin
  perform assert_admin();
  select to_jsonb(po) into v_before from payouts po where po.id = p_payout_id for update;
  if v_before is null then
    raise exception 'payout not found';
  end if;
  update payouts
     set status = 'owed', paid_on = null, method = null, note = nullif(p_note, '')
   where id = p_payout_id;
  insert into audit_log (actor, action, target_table, target_id, before, note)
  values (p_actor, 'reopen_payout', 'payouts', p_payout_id::text, v_before, p_note);
end $$;

-- Execution rights: signed-in sessions only. The is_admin() gate inside each
-- function is what actually authorizes; anon never gets execute at all.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'assert_admin()',
    'admin_upsert_participant(uuid,text,text,text,text,text,text,text,text,int,text,text)',
    'admin_reserve_blocks(int[],uuid,text,text,text)',
    'admin_release_block(int,text)',
    'admin_hold_block(int,text,text)',
    'admin_promote_if_paid(uuid,text)',
    'admin_record_payment(uuid,int,text,date,text,text,text,uuid,text)',
    'admin_update_game(uuid,int,timestamptz,boolean,text,text,text,text,text,text,text)',
    'admin_assign_digits(uuid,text)',
    'admin_publish_digits(uuid,text)',
    'admin_score_game(uuid,text,int,int,text)',
    'admin_set_live(uuid,int,int,text)',
    'admin_clear_live(uuid,text)',
    'admin_settle_payout(uuid,date,text,text)',
    'admin_reopen_payout(uuid,text,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
