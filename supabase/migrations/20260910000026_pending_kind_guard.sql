-- Two defects the queue shipped with, both of which cost money on 2026-09-08.
--
-- 1. THE KIND STRING WAS OPEN. admin_stage_pending accepted any short label.
--    The sweep staged Tom Nataloni's $500 as kind 'payment_candidate', which
--    reads like a dispatching kind and which no dispatcher handles. Pressing
--    Approve on it would have taken the else branch: resolution 'approved',
--    applied false, zero dollars in the ledger, row closed. Nobody pressed it,
--    which is the only reason the money was still findable. The row sat open
--    for two days while block 23 stayed reserved and the $500 was already in
--    Anthony's Venmo. Recorded by hand 2026-09-10.
--
--    The fix is a closed list, checked at staging time. A plausible-looking
--    kind is now refused at the door instead of accepted and silently ignored.
--    Note what is NOT the fix: rejecting every kind without a dispatcher would
--    break refund_needed, identity_conflict, non_matching_multiple,
--    unparsed_intake and unclassified_mail, all of which are deliberately
--    dispatcher-less because each needs Anthony on a particular admin page.
--    The list therefore names both groups, and the guard rejects only what is
--    on neither.
--
--    'owner_owes_refund' is deliberately absent. Owner-held cash left the
--    pool's scope on 2026-09-10: Anthony tracks his own money only, so what an
--    owner owes his own participant is that owner's business and there is
--    nothing to stage.
--
--    The list is duplicated in src/lib/pending.ts as STAGEABLE_KINDS, the same
--    way DISPATCH already mirrors the CASE in admin_approve_pending. Change
--    both together; tests/sql/20 and tests/unit/pending-kinds.test.ts each
--    assert their own half.
--
-- 2. NOTHING RECORDED WHETHER AN APPROVE APPLIED ANYTHING. admin_approve_pending
--    computed `applied` and returned it, and the client turned it into a toast,
--    but nothing was stored. The row then left the open list. So an approve
--    that ran admin_record_payment and an approve that ran nothing at all were
--    indistinguishable the moment the toast faded, and the second one looks
--    exactly like work that got done. `applied` is now a column.

alter table pending_actions add column applied boolean;

comment on column pending_actions.applied is
  'Did Approve actually run an RPC? Null while the row is open. False on a '
  'dismissal, and on an approve of a kind with no dispatcher. Null on a row '
  'resolved before this migration: the screen reports that as unknown, never '
  'as applied.';

-- Backfill. A dismissal has never applied anything, on any row, ever, so this
-- is a statement of fact rather than a guess. Approved rows are deliberately
-- left null: what their approve did was not recorded at the time and inventing
-- a value here would be the exact lie this column exists to prevent. There are
-- none in production as of 2026-09-10 in any case.
update pending_actions set applied = false where resolution = 'dismissed';

-- ---------------------------------------------------------------------------
-- Stage, with the closed list.
-- ---------------------------------------------------------------------------
create or replace function admin_stage_pending(
  p_kind text,
  p_payload jsonb,
  p_source_message_id text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_open uuid;
  v_kind text := trim(p_kind);
  v_source text := nullif(trim(coalesce(p_source_message_id, '')), '');
  -- Two dispatch (admin_approve_pending applies them on its own); five do not
  -- and are meant not to. Anything else is refused.
  v_allowed text[] := array[
    'payment', 'reserve_blocks',
    'refund_needed', 'identity_conflict', 'non_matching_multiple',
    'unparsed_intake', 'unclassified_mail'
  ];
begin
  perform assert_admin();
  if v_kind is null or length(v_kind) = 0 or length(v_kind) > 64 then
    raise exception 'kind must be a short label';
  end if;
  if not (v_kind = any (v_allowed)) then
    raise exception
      'kind % is not stageable. Allowed: %. A kind that no dispatcher handles '
      'must not be accepted and then silently ignored: that is how a $500 '
      'payment sat in this queue for two days on 2026-09-08.',
      v_kind, array_to_string(v_allowed, ', ');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a json object';
  end if;
  if v_source is not null then
    select id into v_open from pending_actions
     where kind = v_kind and source_message_id = v_source and resolved_at is null;
    if v_open is not null then
      raise exception 'already staged and still open as %', v_open;
    end if;
  end if;
  insert into pending_actions (kind, payload, source_message_id, staged_by)
  values (v_kind, p_payload, v_source, p_actor)
  returning id into v_id;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'stage_pending', 'pending_actions', v_id::text,
          jsonb_build_object('kind', v_kind, 'source_message_id', v_source,
                             'payload', p_payload));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Approve, now persisting the verdict. The CASE is unchanged from migration 23.
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
begin
  perform assert_admin();
  select * into r from pending_actions where id = p_id for update;
  if r.id is null then
    raise exception 'pending action % not found', p_id;
  end if;
  if r.resolved_at is not null then
    raise exception 'pending action % is already %', p_id, r.resolution;
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

-- ---------------------------------------------------------------------------
-- Dismiss. Never applied anything, and now says so on the row.
-- ---------------------------------------------------------------------------
create or replace function admin_dismiss_pending(
  p_id uuid,
  p_note text,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r pending_actions;
begin
  perform assert_admin();
  select * into r from pending_actions where id = p_id for update;
  if r.id is null then
    raise exception 'pending action % not found', p_id;
  end if;
  if r.resolved_at is not null then
    raise exception 'pending action % is already %', p_id, r.resolution;
  end if;
  update pending_actions
     set resolved_at = now(), resolution = 'dismissed',
         resolution_note = nullif(p_note, ''), resolved_by = p_actor,
         applied = false
   where id = p_id;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'dismiss_pending', 'pending_actions', p_id::text, to_jsonb(r),
          jsonb_build_object('kind', r.kind, 'applied', false),
          nullif(p_note, ''));
end $$;
