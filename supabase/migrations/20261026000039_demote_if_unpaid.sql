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
--     eligibility is a choice, not arithmetic, so it is Anthony's: release or
--     correct by hand first. There are no partial payments (CLAUDE.md).
--   - A block with a payout row that is not void is refused too: demoting a
--     winner is money going out, which is Anthony's call.
--
-- LOCKING. This function and admin_promote_if_paid take one participant-level
-- advisory lock immediately before they read the balance (review of PR 31).
-- Each later statement reads a fresh snapshot, so a payment and a correction
-- for the same person committing together are judged one after the other,
-- never from a stale balance; scripts/db/race-demote.sh runs that race in two
-- sessions. admin_record_payment reaches the balance only through those two,
-- so it needs no lock of its own. The blocks are row-locked before they are
-- read, so the audit row and the update describe the same rows.
--
-- WHERE IT RUNS. admin_record_payment calls it after every correction (review
-- of PR 31: the /admin/payments form records a correction with that one RPC,
-- so a separate call would never run there). It stays callable on its own.
-- Every other payment method is unchanged: only a correction takes money away.
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
    raise exception 'refused: participant % holds % assigned blocks and the ledger pays for %; which stays assigned is Anthony''s call, so release or correct by hand first',
      p_participant_id, v_assigned, v_covered;
  end if;
  if exists (select 1 from payouts py
              where py.status <> 'void'
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

-- admin_record_payment, derived from migration 32's text programmatically: one
-- insertion, the demote call before the promotion call, and nothing else.
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
    -- A correction can leave him short (migration 39): demote first, so a
    -- reversed payment never leaves a block assigned and eligible to win.
    -- Promotion and demotion judge the same view and never both fire.
    if p_method = 'correction' then
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
