-- The closed kind list, and the persisted applied flag (migration 26).
--
-- Two defects sit behind this suite, and both cost real money on 2026-09-08.
--
-- 1. admin_stage_pending took ANY kind string. The sweep staged Tom Nataloni's
--    $500 as "payment_candidate": a kind that reads like it dispatches, that no
--    dispatcher handles. Approve on it would have gone green, written nothing,
--    and closed the row. It sat open for two days while the money was already
--    in Anthony's Venmo and block 23 stayed reserved.
-- 2. Nothing recorded whether an approve applied anything. The only signal was
--    a toast on the click, and the row then left the open list, so a green
--    no-op and a green success were indistinguishable a moment later.
--
-- Every assertion below guards for NULL and raises. A conditionally-visible or
-- nullable column that comes back NULL turns "if x <> expected" into a no-op,
-- which is how migrations 15 and 16 silently deleted three suites.
begin;

select set_config('app.admin_email', 'admin@tnf.test', true);
select set_config('request.jwt.claims', '{"email":"admin@tnf.test"}', true);

-- ---------------------------------------------------------------------------
-- The guard refuses anything off the list.
-- ---------------------------------------------------------------------------
do $$
declare
  bad text;
  v_ok boolean;
  v_n int;
begin
  foreach bad in array array[
    'payment_candidate',   -- the one that actually happened
    'owner_owes_refund',   -- out of scope since 2026-09-10
    'paymnet',             -- a typo
    'PAYMENT',             -- wrong case: the list is case-sensitive
    'anything at all'
  ] loop
    v_ok := false;
    begin
      perform admin_stage_pending(bad, '{"x": 1}'::jsonb, null, 'test');
    exception when others then
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'TEST FAILURE: admin_stage_pending accepted the kind %', bad;
    end if;
  end loop;

  -- and nothing landed
  select count(*) into v_n from pending_actions
   where kind in ('payment_candidate','owner_owes_refund','paymnet','PAYMENT','anything at all');
  if v_n is null then raise exception 'TEST FAILURE: rejected-kind count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: % rejected kinds were stored anyway', v_n; end if;

  raise notice 'kind guard: every off-list kind refused, nothing stored';
end $$;

-- ---------------------------------------------------------------------------
-- Every kind on the list is accepted. The list in src/lib/pending.ts and the
-- one in the function must stay identical; this is the half that can be tested
-- in SQL.
-- ---------------------------------------------------------------------------
do $$
declare
  good text;
  v_id uuid;
  v_n int := 0;
begin
  foreach good in array array[
    'payment', 'reserve_blocks', 'refund_needed', 'identity_conflict',
    'non_matching_multiple', 'unparsed_intake', 'unclassified_mail'
  ] loop
    v_id := admin_stage_pending(good, '{"probe": true}'::jsonb, 'probe-' || good, 'test');
    if v_id is null then
      raise exception 'TEST FAILURE: admin_stage_pending returned NULL for the allowed kind %', good;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 7 then raise exception 'TEST FAILURE: staged % of 7 allowed kinds', v_n; end if;

  -- an open row has no verdict yet
  select count(*) into v_n from pending_actions
   where source_message_id like 'probe-%' and applied is not null;
  if v_n is null then raise exception 'TEST FAILURE: open-applied count came back NULL'; end if;
  if v_n <> 0 then raise exception 'TEST FAILURE: % open rows already carry an applied verdict', v_n; end if;

  raise notice 'kind guard: all 7 allowed kinds staged, applied null while open';
end $$;

-- ---------------------------------------------------------------------------
-- applied is PERSISTED, not just returned. This is the half that makes the
-- screen honest after a refresh.
-- ---------------------------------------------------------------------------
do $$
declare
  v_p uuid;
  v_id uuid;
  v_applied boolean;
  v_out jsonb;
begin
  select id into v_p from participants limit 1;
  if v_p is null then raise exception 'TEST FAILURE: no participant to attach a payment to'; end if;

  -- a. a dispatching kind stores applied = true
  v_id := admin_stage_pending('payment', jsonb_build_object(
            'participant_id', v_p, 'amount_cents', 50000, 'method', 'venmo',
            'paid_on', current_date, 'venmo_txn_id', 'guard-suite-txn-1'),
          'guard-applied-true', 'test');
  v_out := admin_approve_pending(v_id, 'suite', 'test');
  if (v_out ->> 'applied') is null then
    raise exception 'TEST FAILURE: approve returned no applied flag';
  end if;
  if (v_out ->> 'applied')::boolean is not true then
    raise exception 'TEST FAILURE: a payment approve returned applied=%', v_out ->> 'applied';
  end if;
  select applied into v_applied from pending_actions where id = v_id;
  if v_applied is null then
    raise exception 'TEST FAILURE: applied was not PERSISTED on an approved payment row';
  end if;
  if v_applied is not true then
    raise exception 'TEST FAILURE: persisted applied is % on a payment that dispatched', v_applied;
  end if;

  -- b. a non-dispatching kind stores applied = false, not null
  v_id := admin_stage_pending('unparsed_intake', '{"quoted": "nonsense"}'::jsonb,
            'guard-applied-false', 'test');
  v_out := admin_approve_pending(v_id, 'suite', 'test');
  if (v_out ->> 'applied')::boolean is not false then
    raise exception 'TEST FAILURE: a no-dispatcher approve returned applied=%', v_out ->> 'applied';
  end if;
  select applied into v_applied from pending_actions where id = v_id;
  if v_applied is null then
    raise exception 'TEST FAILURE: applied is NULL on an approved no-dispatcher row, so the screen cannot tell it did nothing';
  end if;
  if v_applied is not false then
    raise exception 'TEST FAILURE: a no-dispatcher approve persisted applied=%', v_applied;
  end if;

  -- c. dismiss never claims to have applied anything
  v_id := admin_stage_pending('refund_needed', '{"text": "x"}'::jsonb,
            'guard-dismissed', 'test');
  perform admin_dismiss_pending(v_id, 'suite', 'test');
  select applied into v_applied from pending_actions where id = v_id;
  if v_applied is null then
    raise exception 'TEST FAILURE: applied is NULL on a dismissed row';
  end if;
  if v_applied is not false then
    raise exception 'TEST FAILURE: a dismissal persisted applied=%', v_applied;
  end if;

  raise notice 'applied: persisted true on dispatch, false on no-dispatch, false on dismiss';
end $$;

-- ---------------------------------------------------------------------------
-- Resolved and its verdict arrive together, the same pairing the table already
-- enforces for resolved_at and resolution.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n from pending_actions
   where (resolved_at is null) <> (applied is null);
  if v_n is null then raise exception 'TEST FAILURE: pair-check count came back NULL'; end if;
  if v_n <> 0 then
    raise exception 'TEST FAILURE: % rows have resolved_at and applied out of step', v_n;
  end if;
  raise notice 'applied: paired with resolved_at on every row';
end $$;

rollback;

-- 5. A row carrying an off-list kind cannot be APPROVED into a no-op.
--
-- Migration 26 closed the staging door; migration 28 closes this one. A row
-- staged before the closed list existed still sits in the queue looking
-- ordinary, and without this guard Approve falls through the case statement,
-- runs nothing, and resolves it green. That is the same silent no-op that held
-- $500 for two days, arriving by the other door.
--
-- The row has to be inserted directly, because admin_stage_pending now refuses
-- the kind - which is the point: this is the state that can only pre-exist.
do $$
declare
  v_id uuid;
  v_msg text;
  v_n int;
begin
  perform set_config('app.admin_email', 'admin@tnf.test', true);
  perform set_config('request.jwt.claims', '{"email":"admin@tnf.test"}', true);

  insert into pending_actions (kind, payload, source_message_id, staged_by)
  values ('payment_candidate', '{"amount_cents": 50000}'::jsonb, 'legacy-test-1', 'tnf-sweep')
  returning id into v_id;

  begin
    perform admin_approve_pending(v_id, null, 'admin@tnf.test');
    raise exception 'TEST FAILURE: approving a legacy payment_candidate row was allowed';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like 'TEST FAILURE%' then raise; end if;
    if position('not approvable' in v_msg) = 0 then
      raise exception 'TEST FAILURE: wrong error approving an off-list kind: %', v_msg;
    end if;
  end;

  -- and it is still open, not silently resolved by the failed attempt
  select count(*) into v_n from pending_actions
   where id = v_id and resolved_at is null and applied is null;
  if v_n is null then raise exception 'TEST FAILURE: legacy-row state count came back NULL'; end if;
  if v_n <> 1 then
    raise exception 'TEST FAILURE: the refused approve did not leave the row open';
  end if;

  -- dismissing it is still available, which is the way out
  perform admin_dismiss_pending(v_id, 'legacy row, dismissed by test', 'admin@tnf.test');
  select count(*) into v_n from pending_actions
   where id = v_id and resolution = 'dismissed' and applied = false;
  if v_n <> 1 then
    raise exception 'TEST FAILURE: a legacy row could not be dismissed';
  end if;

  delete from pending_actions where id = v_id;
  raise notice 'kind guard: an off-list kind cannot be approved, only dismissed';
end $$;
