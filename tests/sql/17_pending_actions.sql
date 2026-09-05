-- The NEEDS ANTHONY queue (migration 23).
--
-- The sweep stages what it may not decide; Anthony approves or dismisses at
-- /admin/queue. Staging changes nothing. Approve applies an item ONLY by
-- calling the existing admin_* RPC its kind maps to; dismiss applies nothing.
-- Anon cannot see the table, a non-admin cannot call the RPCs, and every
-- resolution writes its audit row in the same transaction.
begin;

-- The admin identity is whatever app.admin_email says (is_admin() reads it
-- before its literal fallback), so this suite names a synthetic address and
-- no real one appears in the file.
select set_config('app.admin_email', 'admin@tnf.test', true);
select set_config('request.jwt.claims',
  '{"email":"admin@tnf.test"}', true);

-- ---------------------------------------------------------------------------
-- Structure: no client role may write the table directly, RLS is on, and the
-- three RPCs are definer with a pinned search_path (the reason they may write
-- a table their caller cannot).
-- ---------------------------------------------------------------------------
do $$
declare
  role_name text;
  priv text;
  fn record;
begin
  if not (select relrowsecurity from pg_class where relname = 'pending_actions') then
    raise exception 'TEST FAILURE: RLS is not enabled on pending_actions';
  end if;
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(role_name, 'pending_actions', priv) then
        raise exception 'TEST FAILURE: % may % pending_actions directly', role_name, priv;
      end if;
    end loop;
  end loop;
  if has_table_privilege('anon', 'pending_actions', 'SELECT') then
    raise exception 'TEST FAILURE: anon may select pending_actions';
  end if;
  for fn in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_stage_pending', 'admin_approve_pending',
                         'admin_dismiss_pending')
  loop
    if not fn.prosecdef then
      raise exception 'TEST FAILURE: % is not security definer, it cannot write the queue', fn.proname;
    end if;
    if fn.proconfig is null
       or not exists (select 1 from unnest(fn.proconfig) c where c like 'search_path=%') then
      raise exception 'TEST FAILURE: % has no pinned search_path', fn.proname;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('admin_stage_pending', 'admin_approve_pending',
                           'admin_dismiss_pending')) <> 3 then
    raise exception 'TEST FAILURE: expected exactly three queue RPCs';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Stage a payment for a reserved, unpaid, single-block participant from the
-- seed. Nothing about the pool changes until approve.
-- ---------------------------------------------------------------------------
do $$
declare
  v_pid uuid;
  v_block int;
  v_id uuid;
  n_payments_before int;
  n_payments_after int;
  n_audit int;
  r pending_actions;
begin
  select f.participant_id into v_pid
    from v_participant_finance f join participants p on p.id = f.participant_id
   where f.blocks_held = 1 and f.amount_paid_cents = 0 and f.amount_due_cents = 50000
     and p.full_name <> 'Robert Gambino'
   order by p.full_name limit 1;
  if v_pid is null then
    raise exception 'no reserved unpaid single-block participant in the seed - the approve checks below would be vacuous';
  end if;
  select block_number into v_block from blocks where participant_id = v_pid and status = 'reserved';
  if v_block is null then
    raise exception 'chosen participant holds no reserved block';
  end if;
  perform set_config('test.pid', v_pid::text, true);
  perform set_config('test.block', v_block::text, true);

  select count(*) into n_payments_before from payments;

  v_id := admin_stage_pending('payment',
    jsonb_build_object('participant_id', v_pid, 'participant_name', 'Probe',
                       'amount_cents', 50000, 'method', 'venmo',
                       'paid_on', '2026-09-04', 'venmo_txn_id', 'test-txn-17-1',
                       'source_ref', 'sweep'),
    'gmail-msg-17-1', 'test');
  perform set_config('test.pending_id', v_id::text, true);

  select * into r from pending_actions where id = v_id;
  if r.id is null then
    raise exception 'TEST FAILURE: staged row not readable by the admin';
  end if;
  if r.resolved_at is not null or r.resolution is not null then
    raise exception 'TEST FAILURE: a staged row is already resolved';
  end if;
  if r.staged_by <> 'test' or r.source_message_id <> 'gmail-msg-17-1' then
    raise exception 'TEST FAILURE: staged_by / source_message_id not recorded';
  end if;

  -- Staging is not deciding: the ledger and the block are untouched.
  select count(*) into n_payments_after from payments;
  if n_payments_after <> n_payments_before then
    raise exception 'TEST FAILURE: staging wrote % payment row(s)', n_payments_after - n_payments_before;
  end if;
  if (select status from blocks where block_number = v_block) <> 'reserved' then
    raise exception 'TEST FAILURE: staging changed the block status';
  end if;

  -- Audited, in the same transaction.
  select count(*) into n_audit from audit_log
   where action = 'stage_pending' and target_table = 'pending_actions' and target_id = v_id::text;
  if n_audit <> 1 then
    raise exception 'TEST FAILURE: expected 1 stage_pending audit row, got %', n_audit;
  end if;

  -- The same message cannot be open twice under the same kind.
  begin
    perform admin_stage_pending('payment', '{"amount_cents": 50000}'::jsonb,
                                'gmail-msg-17-1', 'test');
    raise exception 'TEST FAILURE: duplicate open staging accepted';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;

  -- kind and source_message_id are stored trimmed, so a padded restage of
  -- the same message is still caught by the open-row dedupe and a padded
  -- kind still reaches its dispatcher.
  declare
    v_trim uuid;
    r2 pending_actions;
  begin
    v_trim := admin_stage_pending('  identity_conflict ', '{"who": "x"}'::jsonb,
                                  '  gmail-msg-17-trim  ', 'test');
    select * into r2 from pending_actions where id = v_trim;
    if r2.kind <> 'identity_conflict' or r2.source_message_id <> 'gmail-msg-17-trim' then
      raise exception 'TEST FAILURE: kind / source_message_id stored untrimmed: [%] [%]',
        r2.kind, r2.source_message_id;
    end if;
    begin
      perform admin_stage_pending('identity_conflict', '{"who": "x"}'::jsonb,
                                  'gmail-msg-17-trim', 'test');
      raise exception 'TEST FAILURE: dedupe missed the trimmed duplicate';
    exception
      when others then
        if sqlerrm like '%TEST FAILURE%' then raise; end if;
    end;
    -- A blank-after-trim source is stored as null, not as spaces.
    v_trim := admin_stage_pending('identity_conflict', '{"who": "y"}'::jsonb, '   ', 'test');
    if (select source_message_id from pending_actions where id = v_trim) is not null then
      raise exception 'TEST FAILURE: blank source_message_id stored as spaces';
    end if;
  end;

  -- Junk is refused: a non-object payload, a blank kind.
  begin
    perform admin_stage_pending('payment', '[1,2]'::jsonb, null, 'test');
    raise exception 'TEST FAILURE: array payload accepted';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  begin
    perform admin_stage_pending('  ', '{}'::jsonb, null, 'test');
    raise exception 'TEST FAILURE: blank kind accepted';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Anon: cannot read the queue (an open row exists, so this is not vacuous)
-- and cannot call any of the three RPCs.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  n int;
  v_id uuid := current_setting('test.pending_id', true)::uuid;
begin
  begin
    select count(*) into n from pending_actions;
    if n <> 0 then
      raise exception 'TEST FAILURE: anon read % pending row(s)', n;
    end if;
  exception
    when insufficient_privilege then null;  -- select revoked outright also passes
  end;
  begin
    perform admin_stage_pending('payment', '{}'::jsonb, null, 'anon');
    raise exception 'TEST FAILURE: anon staged an item';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform admin_approve_pending(v_id, null, 'anon');
    raise exception 'TEST FAILURE: anon approved an item';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform admin_dismiss_pending(v_id, null, 'anon');
    raise exception 'TEST FAILURE: anon dismissed an item';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- A signed-in non-admin: zero rows under RLS, and assert_admin refuses each
-- RPC. The row must still be open afterwards.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
declare
  n int;
  v_id uuid := current_setting('test.pending_id', true)::uuid;
begin
  select count(*) into n from pending_actions;
  if n <> 0 then
    raise exception 'TEST FAILURE: non-admin read % pending row(s)', n;
  end if;
  begin
    perform admin_stage_pending('payment', '{}'::jsonb, null, 'stranger@example.com');
    raise exception 'TEST FAILURE: non-admin staged an item';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  begin
    perform admin_approve_pending(v_id, null, 'stranger@example.com');
    raise exception 'TEST FAILURE: non-admin approved an item';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  begin
    perform admin_dismiss_pending(v_id, null, 'stranger@example.com');
    raise exception 'TEST FAILURE: non-admin dismissed an item';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claims',
  '{"email":"admin@tnf.test"}', true);
do $$
declare
  r pending_actions;
begin
  select * into r from pending_actions where id = current_setting('test.pending_id', true)::uuid;
  if r.resolved_at is not null then
    raise exception 'TEST FAILURE: a refused caller resolved the row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Approve a payment: one ledger row through admin_record_payment, the block
-- promotes, the queue row resolves, and both audit rows exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := current_setting('test.pending_id', true)::uuid;
  v_pid uuid := current_setting('test.pid', true)::uuid;
  v_block int := current_setting('test.block', true)::int;
  n_before int;
  n_after int;
  v_out jsonb;
  r pending_actions;
  a audit_log;
  pay payments;
begin
  select count(*) into n_before from payments;

  v_out := admin_approve_pending(v_id, 'verified in Venmo', 'test');

  if (v_out ->> 'applied')::boolean is not true
     or v_out ->> 'dispatched_to' <> 'admin_record_payment' then
    raise exception 'TEST FAILURE: approve did not dispatch a payment: %', v_out;
  end if;

  select count(*) into n_after from payments;
  if n_after <> n_before + 1 then
    raise exception 'TEST FAILURE: approve wrote % payment row(s), expected 1', n_after - n_before;
  end if;
  select * into pay from payments where venmo_txn_id = 'test-txn-17-1';
  if pay.id is null or pay.participant_id <> v_pid or pay.amount_cents <> 50000
     or pay.method <> 'venmo' or pay.paid_on <> date '2026-09-04' or pay.source_ref <> 'sweep' then
    raise exception 'TEST FAILURE: ledger row does not match the staged payload';
  end if;
  if pay.id::text <> (v_out -> 'result' ->> 'payment_id') then
    raise exception 'TEST FAILURE: approve did not return the payment id it created';
  end if;

  -- The existing promotion rule ran, because the existing RPC ran.
  if (select status from blocks where block_number = v_block) <> 'assigned' then
    raise exception 'TEST FAILURE: paid in full, block % should be assigned', v_block;
  end if;

  select * into r from pending_actions where id = v_id;
  if r.resolution <> 'approved' or r.resolved_at is null
     or r.resolved_by <> 'test' or r.resolution_note <> 'verified in Venmo' then
    raise exception 'TEST FAILURE: queue row not resolved as approved';
  end if;

  select * into a from audit_log
   where action = 'approve_pending' and target_id = v_id::text;
  if a.id is null then
    raise exception 'TEST FAILURE: no approve_pending audit row';
  end if;
  if (a.after ->> 'applied')::boolean is not true
     or a.after ->> 'dispatched_to' <> 'admin_record_payment'
     or a.before ->> 'kind' <> 'payment' or a.note <> 'verified in Venmo' then
    raise exception 'TEST FAILURE: approve_pending audit payload wrong: % / %', a.before, a.after;
  end if;
  if not exists (select 1 from audit_log where action = 'record_payment' and target_id = pay.id::text) then
    raise exception 'TEST FAILURE: the dispatched RPC did not write its own audit row';
  end if;

  -- Resolved is final.
  begin
    perform admin_approve_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: approved an already-approved item';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  begin
    perform admin_dismiss_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: dismissed an already-approved item';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;

  -- A resolved row no longer blocks the same message from being staged again.
  perform admin_stage_pending('payment', '{"amount_cents": 50000}'::jsonb,
                              'gmail-msg-17-1', 'test');
end $$;

-- ---------------------------------------------------------------------------
-- Approve refused by the dispatched RPC leaves the row OPEN. A duplicate
-- Venmo txn is the ledger's own dedupe firing; the queue must not swallow it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_pid uuid := current_setting('test.pid', true)::uuid;
  n_before int;
begin
  v_id := admin_stage_pending('payment',
    jsonb_build_object('participant_id', v_pid, 'amount_cents', 50000,
                       'method', 'venmo', 'paid_on', '2026-09-04',
                       'venmo_txn_id', 'test-txn-17-1'),
    'gmail-msg-17-dup', 'test');
  select count(*) into n_before from payments;
  begin
    perform admin_approve_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: duplicate txn approved';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  if (select count(*) from payments) <> n_before then
    raise exception 'TEST FAILURE: a refused approve still wrote a payment';
  end if;
  if (select resolved_at from pending_actions where id = v_id) is not null then
    raise exception 'TEST FAILURE: a refused approve resolved the row';
  end if;

  -- Zero and negative amounts are refused before any RPC is reached: zero
  -- is a bogus ledger row, negative is a correction the sweep never stages.
  v_id := admin_stage_pending('payment',
    jsonb_build_object('participant_id', v_pid, 'amount_cents', 0,
                       'method', 'venmo', 'paid_on', '2026-09-04',
                       'venmo_txn_id', 'test-txn-17-zero'),
    'gmail-msg-17-zero', 'test');
  begin
    perform admin_approve_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: zero-amount payment approved';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  if (select count(*) from payments) <> n_before then
    raise exception 'TEST FAILURE: a zero-amount payment reached the ledger';
  end if;
  if (select resolved_at from pending_actions where id = v_id) is not null then
    raise exception 'TEST FAILURE: a refused zero-amount approve resolved the row';
  end if;
  v_id := admin_stage_pending('payment',
    jsonb_build_object('participant_id', v_pid, 'amount_cents', -50000,
                       'method', 'venmo', 'paid_on', '2026-09-04'),
    'gmail-msg-17-neg', 'test');
  begin
    perform admin_approve_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: negative-amount payment approved';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  if (select count(*) from payments) <> n_before then
    raise exception 'TEST FAILURE: a negative-amount payment reached the ledger';
  end if;

  -- A payment with nobody attached is refused before any RPC is reached.
  v_id := admin_stage_pending('payment',
    '{"amount_cents": 50000, "method": "venmo", "paid_on": "2026-09-04"}'::jsonb,
    'gmail-msg-17-nobody', 'test');
  begin
    perform admin_approve_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: payment with no participant approved';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
  if (select count(*) from payments) <> n_before then
    raise exception 'TEST FAILURE: an unattached payment reached the ledger';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Approve a block request: admin_reserve_blocks runs, nothing else.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_pid uuid;
  v_block int;
  v_out jsonb;
  b blocks;
begin
  select id into v_pid from participants where full_name = 'Anthony Giletto';
  select block_number into v_block from blocks where status = 'available' order by block_number limit 1;
  if v_pid is null or v_block is null then
    raise exception 'seed lacks Anthony Giletto or an available block';
  end if;
  v_id := admin_stage_pending('reserve_blocks',
    jsonb_build_object('participant_id', v_pid, 'participant_name', 'Anthony Giletto',
                       'block_numbers', jsonb_build_array(v_block), 'method', 'requested',
                       'ref', 'gmail-msg-17-2'),
    'gmail-msg-17-2', 'test');
  v_out := admin_approve_pending(v_id, null, 'test');
  if v_out ->> 'dispatched_to' <> 'admin_reserve_blocks' or (v_out -> 'result' ->> 'reserved')::int <> 1 then
    raise exception 'TEST FAILURE: reserve dispatch wrong: %', v_out;
  end if;
  select * into b from blocks where block_number = v_block;
  if b.status <> 'reserved' or b.participant_id <> v_pid or b.assignment_method <> 'requested' then
    raise exception 'TEST FAILURE: block % not reserved for the participant', v_block;
  end if;
  if not exists (select 1 from audit_log where action = 'reserve_blocks' and target_id = v_block::text) then
    raise exception 'TEST FAILURE: admin_reserve_blocks did not audit';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A kind with no dispatcher: approve resolves, applies nothing, and says so.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_out jsonb;
  n_payments int;
  n_blocks_changed int;
  a audit_log;
begin
  select count(*) into n_payments from payments;
  perform set_config('test.blocks_sig',
    (select string_agg(block_number || ':' || status || ':' || coalesce(participant_id::text, ''), ',' order by block_number) from blocks), true);

  v_id := admin_stage_pending('non_matching_multiple',
    '{"amount_cents": 100000, "sender": "Somebody", "note": "two blocks or a friend"}'::jsonb,
    'gmail-msg-17-3', 'test');
  v_out := admin_approve_pending(v_id, 'recorded by hand on /admin/payments', 'test');

  if (v_out ->> 'applied')::boolean is not false or v_out ->> 'dispatched_to' is not null then
    raise exception 'TEST FAILURE: an undispatched kind reported an application: %', v_out;
  end if;
  if (select count(*) from payments) <> n_payments then
    raise exception 'TEST FAILURE: approving an undispatched kind wrote a payment';
  end if;
  if (select string_agg(block_number || ':' || status || ':' || coalesce(participant_id::text, ''), ',' order by block_number) from blocks)
     <> current_setting('test.blocks_sig', true) then
    raise exception 'TEST FAILURE: approving an undispatched kind changed a block';
  end if;
  if (select resolution from pending_actions where id = v_id) <> 'approved' then
    raise exception 'TEST FAILURE: undispatched approve did not resolve the row';
  end if;
  select * into a from audit_log where action = 'approve_pending' and target_id = v_id::text;
  if a.id is null or (a.after ->> 'applied')::boolean is not false then
    raise exception 'TEST FAILURE: audit row for an undispatched approve is wrong: %', a.after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Dismiss: resolves without applying, audited.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_pid uuid := current_setting('test.pid', true)::uuid;
  n_payments int;
  r pending_actions;
  a audit_log;
begin
  select count(*) into n_payments from payments;
  v_id := admin_stage_pending('payment',
    jsonb_build_object('participant_id', v_pid, 'amount_cents', 50000,
                       'method', 'venmo', 'paid_on', '2026-09-04',
                       'venmo_txn_id', 'test-txn-17-4'),
    'gmail-msg-17-4', 'test');
  perform admin_dismiss_pending(v_id, 'already in the ledger', 'test');

  if (select count(*) from payments) <> n_payments then
    raise exception 'TEST FAILURE: dismiss wrote a payment';
  end if;
  select * into r from pending_actions where id = v_id;
  if r.resolution <> 'dismissed' or r.resolved_at is null
     or r.resolution_note <> 'already in the ledger' or r.resolved_by <> 'test' then
    raise exception 'TEST FAILURE: dismiss did not resolve the row as dismissed';
  end if;
  select * into a from audit_log where action = 'dismiss_pending' and target_id = v_id::text;
  if a.id is null or (a.after ->> 'applied')::boolean is not false or a.note <> 'already in the ledger' then
    raise exception 'TEST FAILURE: dismiss_pending audit row wrong';
  end if;

  -- Once dismissed it is off the open list and stays resolved.
  if exists (select 1 from pending_actions where id = v_id and resolved_at is null) then
    raise exception 'TEST FAILURE: dismissed row still open';
  end if;
  begin
    perform admin_approve_pending(v_id, null, 'test');
    raise exception 'TEST FAILURE: approved a dismissed item';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
end $$;

-- The resolution pair constraint holds even against a privileged writer.
do $$
begin
  begin
    update pending_actions set resolved_at = null
     where resolution = 'dismissed';
    raise exception 'TEST FAILURE: resolved_at cleared while resolution stayed set';
  exception
    when check_violation then null;
  end;
end $$;

rollback;
