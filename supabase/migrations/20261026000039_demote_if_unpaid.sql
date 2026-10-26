-- The mirror of admin_promote_if_paid (Anthony, 2026-10-26, Part H2).
--
-- A payment row that turns out to be wrong is reversed with a correction row
-- (admin_record_payment, method 'correction'; it inherits the original's
-- collector, migration 32). The correction leaves the participant short, but
-- nothing moved his blocks back: admin_record_payment only ever promotes, and
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
-- So: one participant at a time, judged from v_participant_finance exactly as
-- promotion is. Short of what he owes (due > 0 and paid < due), every block of
-- his that is assigned and not comped goes back to reserved. Holder, display
-- name, comp flag, notes, method and ref are untouched. assigned_at is cleared,
-- because /block/[n] prints "assigned <date>" from it and a later promotion
-- stamps it again with coalesce; the old value is kept in the audit row.
-- A comped block owes nothing, so it stays assigned. Paid in full: nothing
-- moves and nothing is written. Partial payment demotes every non-comped
-- assigned block, the same all-or-nothing rule promotion uses.
--
-- admin_record_payment calls it after every correction (review of PR 31: the
-- /admin/payments form records a correction with that one RPC, so a separate
-- call would never run there). It stays callable on its own for a block that
-- is already assigned and short. Every other payment method is unchanged:
-- only a correction can take money away, so only a correction demotes.

create or replace function admin_demote_if_unpaid(p_participant_id uuid, p_actor text) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_due bigint;
  v_paid bigint;
  v_before jsonb;
  v_count int := 0;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  select amount_due_cents, amount_paid_cents into v_due, v_paid
    from v_participant_finance where participant_id = p_participant_id;
  if v_due is null then
    raise exception 'participant % not found', p_participant_id;
  end if;
  if v_due > 0 and v_paid < v_due then
    select jsonb_agg(jsonb_build_object('block_number', b.block_number,
                                        'status', b.status,
                                        'assigned_at', b.assigned_at)
                     order by b.block_number)
      into v_before
      from blocks b
     where b.participant_id = p_participant_id
       and b.status = 'assigned' and not b.comped;
    update blocks
       set status = 'reserved', assigned_at = null
     where participant_id = p_participant_id
       and status = 'assigned' and not comped;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      insert into audit_log (actor, action, target_table, target_id, before, after, note)
      values (p_actor, 'demote_blocks', 'blocks', p_participant_id::text,
              jsonb_build_object('blocks', v_before),
              jsonb_build_object('demoted', v_count, 'due_cents', v_due, 'paid_cents', v_paid),
              'paid short of due: assigned back to reserved, holder and name kept');
    end if;
  end if;
  return v_count;
end $$;

revoke execute on function admin_demote_if_unpaid(uuid, text) from public, anon;
grant execute on function admin_demote_if_unpaid(uuid, text) to authenticated;

-- admin_record_payment, derived from migration 32's text programmatically: one
-- insertion before the promotion call and nothing else. create or replace on an
-- unchanged signature keeps the ACL; the grants are re-applied anyway.

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
