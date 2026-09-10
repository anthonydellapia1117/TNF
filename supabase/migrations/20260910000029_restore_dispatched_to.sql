-- Restore the dispatched_to key that migration 28 renamed.
--
-- Migration 28 rewrote admin_approve_pending to add the off-list-kind guard.
-- Its commit message said the dispatch body was byte-identical to migration
-- 26's, and it was - but only the case statement was diffed. The RETURN and the
-- audit payload were retyped, and 'dispatched_to' came out as 'rpc'.
--
-- What that broke, in order of how quietly:
--
--   src/components/admin/queue/queue-actions.tsx reads res.data.dispatched_to,
--   so every successful approve told Anthony "Approved and applied through
--   undefined". ApprovePendingResult in src/app/admin/actions.ts types the same
--   key. The audit_log row lost it too, so the record of WHICH rpc ran went
--   missing from the ledger.
--
--   And tests/sql/17_pending_actions.sql asserts on that key in four places.
--   With the key renamed, v_out ->> 'dispatched_to' is NULL,
--   NULL <> 'admin_record_payment' is NULL, the IF never fires, and the suite
--   reported 20/20 PASS while the contract it exists to protect was broken.
--
-- That last part is the CLAUDE.md rule about migrations 15 and 16, reproduced
-- exactly: a migration changed a column an assertion reads, the assertion was
-- re-run instead of re-verified, and NULL passed in silence. The four
-- assertions now carry explicit is-null guards that raise, so losing the key
-- again fails loudly instead of turning the test into a no-op.
--
-- Migration 28's guard is unchanged and still refuses an off-list kind.

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
        p_actor));
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
