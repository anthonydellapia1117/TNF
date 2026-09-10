-- Money that reaches Anthony moves the participant to AVD, in the same
-- operation as the payment. CLAUDE.md has required this since 2026-09-03 and
-- the code has never done it.
--
-- admin_record_payment inserted the ledger row and promoted blocks, and never
-- touched participants.owner_group. So approving a staged payment for someone
-- in RM's or MAP's book left him in the wrong book with the queue row closed
-- applied = true, and the error only surfaced at season-end reconciliation.
--
-- WHAT DECIDES IT is payments.collected_by, added in migration 30. NULL means
-- Anthony collected, which is the default and the common case. A code means
-- that owner is holding the cash for his own book, and the rule's exception
-- applies: he keeps the participant, because he is doing the collecting.
--
-- Three conditions, and all three are load-bearing:
--   collected_by is null or AVD  - the exception is exactly the other case.
--   method is venmo, cash or check - a comp is not money reaching anyone, and
--     a correction adjusts a payment that already had its effect. Neither
--     moves a book.
--   amount_cents > 0 - a zero-value row moves nothing.
--
-- The signature gains p_collected_by, so the 9-argument form is DROPPED rather
-- than left beside the new one. Adding a defaulted parameter alone would leave
-- two functions and make every 9-argument call ambiguous, which fails at run
-- time and not at deploy time. The grant is re-applied to the new signature
-- because a drop takes the old one's grants with it.

drop function if exists admin_record_payment(uuid,int,text,date,text,text,text,uuid,text);

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

-- ---------------------------------------------------------------------------
-- The queue dispatcher, recreated because it is the only caller of the
-- signature dropped above.
--
-- Two changes and no others: the admin_record_payment call gains its tenth
-- argument, collected_by, read from the staged payload. A payload without that
-- key yields NULL, which means Anthony collected it - the correct default and
-- the behaviour every existing staged row already implies.
--
-- Derived from migration 29's text programmatically rather than retyped. The
-- last time this function was retyped by hand, migration 28 renamed
-- dispatched_to to rpc, broke the queue UI and the audit payload, and silently
-- killed four assertions that then compared against NULL and passed.
-- ---------------------------------------------------------------------------

create or replace function admin_approve_pending(
  p_id uuid,
  p_note text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r pending_actions;
  v_applied boolean := false;
  v_rpc text;
  v_result jsonb;
  v_amount int;
  v_allowed text[] := array[
    'payment', 'reserve_blocks',
    'refund_needed', 'identity_conflict', 'non_matching_multiple',
    'unparsed_intake', 'unclassified_mail'
  ];
begin
  perform assert_admin();
  select * into r from pending_actions where id = p_id for update;
  if r.id is null then
    raise exception 'pending action % not found', p_id;
  end if;
  if r.resolved_at is not null then
    raise exception 'pending action % is already %', p_id, r.resolution;
  end if;

  -- The guard. A row whose kind is on neither list cannot be approved into a
  -- no-op; it has to be dismissed, or restaged under a kind that means
  -- something. Same allowlist as admin_stage_pending, deliberately duplicated
  -- rather than shared so that adding a kind in one place and forgetting the
  -- other fails loudly here instead of silently writing nothing.
  if not (r.kind = any (v_allowed)) then
    raise exception
      'pending action % carries kind %, which is not approvable. It predates the closed list in migration 26. Dismiss it, or restage it under a kind that dispatches. Allowed: %',
      p_id, r.kind, array_to_string(v_allowed, ', ');
  end if;

  case r.kind
    when 'payment' then
      if nullif(r.payload ->> 'participant_id', '') is null then
        raise exception 'payment has no participant_id - dismiss it and record by hand, or restage it attached to someone';
      end if;
      if nullif(r.payload ->> 'paid_on', '') is null then
        raise exception 'payment needs paid_on';
      end if;
      v_amount := (r.payload ->> 'amount_cents')::int;
      if v_amount is null or v_amount <= 0 then
        raise exception 'payment amount_cents must be a positive whole number of cents, got %',
          coalesce(r.payload ->> 'amount_cents', 'nothing');
      end if;
      v_rpc := 'admin_record_payment';
      v_result := jsonb_build_object('payment_id', admin_record_payment(
        (r.payload ->> 'participant_id')::uuid,
        v_amount,
        r.payload ->> 'method',
        (r.payload ->> 'paid_on')::date,
        r.payload ->> 'venmo_txn_id',
        r.payload ->> 'source_ref',
        r.payload ->> 'note',
        null::uuid,
        p_actor,
        r.payload ->> 'collected_by'));
      v_applied := true;
    when 'reserve_blocks' then
      v_rpc := 'admin_reserve_blocks';
      v_result := jsonb_build_object('reserved', admin_reserve_blocks(
        (select array_agg(x::int)
           from jsonb_array_elements_text(r.payload -> 'block_numbers') x),
        (r.payload ->> 'participant_id')::uuid,
        r.payload ->> 'method',
        r.payload ->> 'ref',
        p_actor));
      v_applied := true;
    else
      v_rpc := null;
  end case;

  update pending_actions
     set resolved_at = now(), resolution = 'approved',
         resolution_note = nullif(p_note, ''), resolved_by = p_actor,
         applied = v_applied
   where id = p_id;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'approve_pending', 'pending_actions', p_id::text, to_jsonb(r),
          jsonb_build_object('kind', r.kind, 'applied', v_applied,
                             'dispatched_to', v_rpc, 'result', v_result),
          nullif(p_note, ''));

  return jsonb_build_object('applied', v_applied, 'dispatched_to', v_rpc,
                            'result', v_result);
end $$;
