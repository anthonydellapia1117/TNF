-- A correction inherits the collector of the payment it corrects.
--
-- Migration 30 gave payments a collected_by, and 31 made admin_record_payment
-- read it to decide the AVD move. Both treated the argument as the whole truth,
-- which is right for a receipt and wrong for a correction: a correction and the
-- row it corrects are THE SAME MONEY IN THE SAME BOOK, so the collector is not
-- an independent fact about the correction.
--
-- What it cost, concretely. RM holds a participant's $500, recorded
-- collected_by = 'RM'. The reversal is entered on /admin/payments, where the
-- collector defaults to Anthony and (since 31) resets to Anthony after every
-- successful record. The ledger then reads: RM +$500, Anthony -$500. The
-- overall balance is correct and BOTH owner totals are wrong, which is the
-- worst shape an error can have - it does not show up until season-end
-- reconciliation, which is the one job this column exists to do.
--
-- The two constraints that make inheriting safe rather than a guess:
--   correction_references_original - a correction must name a payment, so
--     there is always exactly one row to inherit from.
--   payments_corrects_payment_id_fkey - that payment must exist, so a bad id
--     fails the insert rather than quietly writing NULL.
--
-- A collector passed alongside a correction is not a second opinion; the row
-- being corrected wins. Every other method keeps taking its argument.
--
-- Derived from migration 31's function text programmatically, one insertion
-- and nothing else. `create or replace` on an unchanged signature keeps the
-- ACL, and the grants are re-applied below anyway so a future drop-based edit
-- cannot lose them silently.

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
