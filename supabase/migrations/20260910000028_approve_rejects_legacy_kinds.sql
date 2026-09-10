-- Close the other half of the silent no-op.
--
-- Migration 26 made the kind string a closed list at STAGING time, so
-- "payment_candidate" can no longer be written. It did nothing about rows that
-- already carry an off-list kind. Those sit in the queue looking ordinary, and
-- approving one falls through the case statement to `else v_rpc := null`, which
-- resolves the row approved with applied = false having run no RPC at all.
--
-- That is exactly the failure migration 26 exists to prevent, arriving by the
-- other door: a green Approve that wrote nothing, on a row that may be holding
-- real money. The /admin/queue warning does surface it AFTER the fact, but by
-- then Anthony has pressed the button and been told it worked.
--
-- Production carries no such row today (checked 2026-09-10: zero resolved rows
-- with a null applied, zero off-list open rows). This is a guard against the
-- ones that could still be created before migration 26 shipped, and against a
-- future kind added to the dispatcher's allowlist but not to its case statement.
--
-- The deliberate no-dispatch kinds are unaffected. They are ON the allowlist and
-- approving one is supposed to record a decision and run nothing; only a kind
-- that is on NEITHER list now raises.

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
                             'rpc', v_rpc, 'result', v_result),
          nullif(p_note, ''));

  return jsonb_build_object('applied', v_applied, 'rpc', v_rpc, 'result', v_result);
end $$;
