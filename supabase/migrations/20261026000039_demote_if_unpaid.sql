-- Demotion: an assigned block the ledger no longer pays for goes back to
-- reserved (Anthony, 2026-10-26, Part H2: blocks 11, 63 and 70).
--
-- A payment row that turns out to be wrong is reversed with a correction row
-- (admin_record_payment, method 'correction'; it inherits the original's
-- collector, migration 32). The correction leaves the participant short, but
-- nothing moved his blocks back: admin_record_payment only ever promoted, and
-- no RPC took an assigned block back to reserved with its holder kept.
--
-- The paths that existed were each wrong for it:
--   admin_reserve_blocks   refuses anything that is not available.
--   admin_release_block    clears the holder, and writes "Released from <name>"
--                          into the block's notes: a false line once the block
--                          is reserved straight back to the same person.
--   admin_set_comped(false) on a block that was never comped: it would demote,
--                          but audit as uncomp_block.
--
-- WHAT IS JUDGED. Only his assigned, non-comped blocks, against the whole
-- blocks his payment rows (corrections included) pay for: floor(paid / price).
-- NOT v_participant_finance's due, which also counts his reserved blocks and
-- any requested block with no number: a holder with a paid assigned block and
-- a later unpaid reserved one reads short against due, and judging him by it
-- would strip a block he paid for (design review of PR 31; two such holders
-- were live on 2026-10-26).
--   - The ledger pays for all of them: nothing moves, nothing is written.
--   - It pays for none of them: every one goes back to reserved. Holder,
--     display name, comp flag, notes, method and ref are untouched;
--     assigned_at is cleared (/block/[n] prints it, and a later promotion
--     stamps it again) and kept in the audit row.
--   - It pays for some but not all: refused. Which block keeps its payout
--     eligibility is a choice, not arithmetic, so it is Anthony's: release the
--     block that goes, then record the correction again. A path that keeps
--     both blocks with the holder is open as issue 35. There are no partial
--     payments (CLAUDE.md).
--   - A block with a payout to him that is not void is refused too: demoting
--     a winner is money going out, which is Anthony's call. A payout won by a
--     former holder of the block does not block the current one (Codex,
--     review of PR 31).
--
-- LOCKING. This function and admin_promote_if_paid take one participant-level
-- advisory lock immediately before they read the balance (review of PR 31).
-- Each later statement reads a fresh snapshot, so a payment and a correction
-- for the same person committing together are judged one after the other,
-- never from a stale balance; scripts/db/race-demote.sh runs that race in two
-- sessions. admin_record_payment reaches the balance only through those two,
-- so it needs no lock of its own. admin_set_comped still judges and moves
-- blocks outside this lock, on its own due-based rule (issue 33). The blocks
-- are row-locked before they are
-- read, so the audit row and the update describe the same rows, and
-- admin_score_game now reads the winning block FOR UPDATE, so a payout and a
-- demotion of the same block are never decided from each other's snapshot.
--
-- WHERE IT RUNS. admin_record_payment calls it after every row that takes
-- money away, a correction or any negative amount (review of PR 31: the
-- /admin/payments form records those with that one RPC, so a separate call
-- would never run there, and the schema allows a negative amount on every
-- method). It stays callable on its own. A positive payment that is not a
-- correction never calls it; a positive correction does, and at a fixed block
-- price adding money never leaves anyone short.
-- admin_record_payment also refuses a correction booked on a participant
-- other than the one whose row it corrects.
-- The audit row's target_id is the block list, the shape getBlockHistory
-- matches, with the participant in the payload.

create or replace function admin_demote_if_unpaid(p_participant_id uuid, p_actor text) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_price bigint;
  v_paid bigint;
  v_assigned int;
  v_covered bigint;
  v_before jsonb;
  v_targets text;
  v_count int := 0;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  -- The participant lock admin_promote_if_paid also takes, so a payment
  -- committing alongside cannot be judged from a stale balance (PR 31).
  perform pg_advisory_xact_lock(hashtext('participant_finance'), hashtext(p_participant_id::text));
  select amount_paid_cents into v_paid
    from v_participant_finance where participant_id = p_participant_id;
  if v_paid is null then
    raise exception 'participant % not found', p_participant_id;
  end if;
  select price_per_block_cents into v_price from config;
  if coalesce(v_price, 0) <= 0 then
    raise exception 'config.price_per_block_cents is not set';
  end if;

  perform 1 from blocks
   where participant_id = p_participant_id and status = 'assigned' and not comped
     for update;
  select count(*),
         jsonb_agg(jsonb_build_object('block_number', b.block_number,
                                      'status', b.status,
                                      'assigned_at', b.assigned_at)
                   order by b.block_number),
         string_agg(b.block_number::text, ',' order by b.block_number)
    into v_assigned, v_before, v_targets
    from blocks b
   where b.participant_id = p_participant_id
     and b.status = 'assigned' and not b.comped;

  v_covered := greatest(v_paid, 0) / v_price;
  if v_assigned = 0 or v_covered >= v_assigned then
    return 0;
  end if;
  if v_covered > 0 then
    raise exception 'refused: participant % holds % assigned blocks and the ledger pays for %; which block stays assigned is Anthony''s call. Release the block that goes, then record this again (issue 35)',
      p_participant_id, v_assigned, v_covered;
  end if;
  if exists (select 1 from payouts py
              where py.status <> 'void'
                and py.participant_id = p_participant_id
                and py.block_number in (select b.block_number from blocks b
                                         where b.participant_id = p_participant_id
                                           and b.status = 'assigned' and not b.comped)) then
    raise exception 'refused: a block of participant % has a payout that is not void; demoting a winner is Anthony''s call',
      p_participant_id;
  end if;

  update blocks
     set status = 'reserved', assigned_at = null
   where participant_id = p_participant_id
     and status = 'assigned' and not comped;
  get diagnostics v_count = row_count;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'demote_blocks', 'blocks', v_targets,
          jsonb_build_object('blocks', v_before),
          jsonb_build_object('participant_id', p_participant_id, 'demoted', v_count,
                             'owed_cents', v_assigned * v_price, 'paid_cents', v_paid),
          'the ledger pays for none of his assigned blocks: back to reserved, holder and name kept');
  return v_count;
end $$;

revoke execute on function admin_demote_if_unpaid(uuid, text) from public, anon;
grant execute on function admin_demote_if_unpaid(uuid, text) to authenticated;

-- admin_record_payment, derived from migration 32's text programmatically: two
-- insertions, the corrected row's participant check after the collector read
-- and the demote call before the promotion call, and nothing else.
-- create or replace on an unchanged signature keeps the ACL; the grants are
-- re-applied anyway.

create or replace function admin_record_payment(
  p_participant_id uuid,
  p_amount_cents int,
  p_method text,
  p_paid_on date,
  p_venmo_txn_id text,
  p_source_ref text,
  p_note text,
  p_corrects_payment_id uuid,
  p_actor text,
  p_collected_by text default null
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_collected text := nullif(btrim(coalesce(p_collected_by, '')), '');
  v_before text;
begin
  perform assert_admin();

  -- A CORRECTION INHERITS THE COLLECTOR OF THE ROW IT CORRECTS, whatever the
  -- caller passed. The two rows are the same money in the same book, so the
  -- correction's collector is not an independent fact about it. The CHECK
  -- correction_references_original guarantees there is always a row to read,
  -- and the foreign key guarantees it exists, so this cannot silently write
  -- NULL for a correction that named a real payment.
  if p_method = 'correction' then
    select collected_by into v_collected
      from payments where id = p_corrects_payment_id;
  end if;

  -- A row that names the payment it corrects belongs to that payment's
  -- participant (migration 39, review of PR 31). The /admin/payments form
  -- picks the participant and the corrected row separately; a mismatch would
  -- book the reversal, and the demotion that follows it, on the wrong person.
  -- An id that names no payment is left to the foreign key, and a correction
  -- with no id to correction_references_original, which name the real cause.
  if p_corrects_payment_id is not null
     and exists (select 1 from payments where id = p_corrects_payment_id)
     and p_participant_id is distinct from
         (select participant_id from payments where id = p_corrects_payment_id) then
    raise exception 'refused: payment % belongs to a different participant; a correction goes on the participant of the row it corrects',
      p_corrects_payment_id;
  end if;

  insert into payments (participant_id, amount_cents, method, paid_on,
                        venmo_txn_id, source_ref, note, corrects_payment_id,
                        collected_by)
  values (p_participant_id, p_amount_cents, p_method, p_paid_on,
          nullif(p_venmo_txn_id, ''), nullif(p_source_ref, ''), nullif(p_note, ''),
          p_corrects_payment_id, v_collected)
  returning id into v_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'record_payment', 'payments', v_id::text,
          jsonb_build_object('participant_id', p_participant_id,
                             'amount_cents', p_amount_cents, 'method', p_method,
                             'collected_by', v_collected));

  if p_participant_id is not null then
    if (v_collected is null or v_collected = 'AVD')
       and p_method = any (array['venmo','cash','check'])
       and coalesce(p_amount_cents, 0) > 0 then
      select owner_group into v_before
        from participants where id = p_participant_id for update;
      if v_before is not null and v_before <> 'AVD' then
        update participants set owner_group = 'AVD' where id = p_participant_id;
        insert into audit_log (actor, action, target_table, target_id,
                               before, after, note)
        values (p_actor, 'owner_group_moved_to_avd', 'participants',
                p_participant_id::text,
                jsonb_build_object('owner_group', v_before),
                jsonb_build_object('owner_group', 'AVD'),
                'money reached Anthony, payment ' || v_id::text ||
                ', so the block is in his book');
      end if;
    end if;
    -- A row that takes money away can leave him short (migration 39): a
    -- correction, or any negative amount, which the schema allows on every
    -- method. Demote first, so a reversed payment never leaves a block
    -- assigned and eligible to win. Promotion and demotion judge different
    -- things and only one of them can move a block.
    if p_method = 'correction' or coalesce(p_amount_cents, 0) < 0 then
      perform admin_demote_if_unpaid(p_participant_id, p_actor);
    end if;
    perform admin_promote_if_paid(p_participant_id, p_actor);
  end if;

  return v_id;
end $$;

revoke execute on function
  admin_record_payment(uuid,int,text,date,text,text,text,uuid,text,text)
  from public, anon;
grant execute on function
  admin_record_payment(uuid,int,text,date,text,text,text,uuid,text,text)
  to authenticated;

-- admin_promote_if_paid, migration 4's text with one insertion: the same
-- participant lock, taken before it reads the balance. create or replace on an
-- unchanged signature keeps its ACL (migration 4's revoke and grant loop).

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
  perform pg_advisory_xact_lock(hashtext('participant_finance'), hashtext(p_participant_id::text));
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

-- admin_score_game, migration 7's text with one change: the winning block is
-- read FOR UPDATE. admin_demote_if_unpaid row-locks a block before it checks
-- for a payout and moves it; without this lock, scoring could read the block
-- as assigned from its snapshot while a correction was demoting it, and write
-- an owed payout for a reserved block (Codex, review of PR 31). With it,
-- whichever commits first wins: scoring after a demotion sees reserved and
-- creates no payout; a correction after scoring sees the payout and is
-- refused. create or replace on an unchanged signature keeps its ACL.

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

  -- Row-locked (migration 39, review of PR 31): a correction that demotes this
  -- block holds the same row lock, so the two are judged one after the other
  -- and a payout is never written for a block a concurrent correction just
  -- moved back to reserved.
  select * into b from blocks where block_number = v_block for update;

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
