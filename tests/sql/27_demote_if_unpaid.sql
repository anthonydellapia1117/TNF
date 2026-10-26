-- Migration 39: admin_demote_if_unpaid, and admin_record_payment calling it
-- after every correction (Anthony, 2026-10-26, Part H2; review of PR 31).
-- An assigned block the ledger no longer pays for goes back to reserved,
-- holder and name kept. Only assigned, non-comped blocks are judged, against
-- the whole blocks the payment rows pay for; a reserved or requested block
-- never makes a paid one look short. Partial cover and a block with a payout
-- are refused. Only a row that takes money away demotes: a correction, or a
-- negative amount on any method. A correction booked on a participant other
-- than the one whose row it corrects is refused.
--
-- One transaction, rolled back. Every value read is guarded for NULL.
--
-- Mutation checks, each verified to raise: drop the call from record_payment
-- (case A); call it for every method (case G); judge against due instead of
-- the assigned blocks (case H); demote comped blocks too (case C); demote when
-- paid in full (case B); demote on partial cover instead of refusing (case D);
-- drop the payout guard (case P); skip the audit row (case A); keep
-- assigned_at (case A); target the participant instead of the blocks (case
-- A); let a non-admin call it, or grant it to anon (section 1); drop the
-- participant lock from demote or promote (section 3); skip the demote on a
-- negative cash row (case N); drop the corrected row's participant check
-- (case W).
--
-- Section 3 checks the lock is taken, not the race itself: this harness is
-- one session in one rolled-back transaction, so a second session cannot see
-- the fixture. scripts/db/race-demote.sh runs the races in two sessions: a
-- correction against an owner-held payment, and against the score that makes
-- the block a winner, each in both orders. It passes with the locks and fails
-- with either lock removed.

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

create temp table fx (k text primary key, pid uuid, blocks int[]) on commit drop;

-- Fixtures on blocks that are open in the seed.
--   A: one block, RM cash, assigned (the H2 shape).
--   B: one block, paid in full.
--   C: one comped block and one paid block, both assigned.
--   D: two blocks, paid for both in two rows.
--   E: one block left assigned with nothing paid, set directly by the fixture
--      (the state a correction made before migration 39 would have left).
--   F: one block, half paid, so still reserved.
--   G: like E, one assigned block with nothing paid.
--   H: one block paid and assigned, then a second block reserved and unpaid
--      (the shape two live holders had on 2026-10-26).
--   P: like E, and the block has a payout that is not void.
--   N: one block, paid in full and assigned.
--   W: one block, paid in full and assigned; its payment is the one a
--      correction booked on case B's participant tries to reverse.
do $$
declare
  v_open int[];
  v_pid uuid;
  v_game uuid;
begin
  select array_agg(block_number order by block_number) into v_open
    from (select block_number from blocks where status = 'available' order by block_number limit 14) s;
  if v_open is null or cardinality(v_open) < 14 then
    raise exception 'TEST SETUP: need 14 available blocks, found %', coalesce(cardinality(v_open), 0);
  end if;

  insert into participants (full_name, display_alias, owner_group, blocks_requested)
    values ('Case A', 'Scro Test', 'RM', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[1]], v_pid, 'admin', 'fixture A', 'test');
  perform admin_set_block_name(v_open[1], 'Block A Name', 'test');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null,
                               'Held by Ronnie Malandro (RM), confirmed by him to Anthony 2026-09-04',
                               null, null, 'test', 'RM');
  insert into fx values ('A', v_pid, array[v_open[1]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case B', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[2]], v_pid, 'admin', 'fixture B', 'test');
  perform admin_record_payment(v_pid, 50000, 'venmo', '2026-09-04', 'fx-b', 'fixture', null, null, 'test', null);
  insert into fx values ('B', v_pid, array[v_open[2]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case C', 'AVD', 2) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[3], v_open[4]], v_pid, 'admin', 'fixture C', 'test');
  perform admin_set_comped(v_open[3], true, 'test');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture', null, null, 'test', null);
  insert into fx values ('C', v_pid, array[v_open[3], v_open[4]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case D', 'MAP', 2) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[5], v_open[6]], v_pid, 'admin', 'fixture D', 'test');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture 1', null, null, 'test', 'MAP');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture 2', null, null, 'test', 'MAP');
  insert into fx values ('D', v_pid, array[v_open[5], v_open[6]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case E', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[7]], v_pid, 'admin', 'fixture E', 'test');
  update blocks set status = 'assigned', assigned_at = now() where block_number = v_open[7];
  insert into fx values ('E', v_pid, array[v_open[7]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case F', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[8]], v_pid, 'admin', 'fixture F', 'test');
  perform admin_record_payment(v_pid, 25000, 'cash', '2026-09-04', null, 'fixture half', null, null, 'test', null);
  insert into fx values ('F', v_pid, array[v_open[8]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case G', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[9]], v_pid, 'admin', 'fixture G', 'test');
  update blocks set status = 'assigned', assigned_at = now() where block_number = v_open[9];
  insert into fx values ('G', v_pid, array[v_open[9]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case H', 'RM', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[10]], v_pid, 'admin', 'fixture H', 'test');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture H paid', null, null, 'test', 'RM');
  update participants set blocks_requested = 2 where id = v_pid;
  perform admin_reserve_blocks(array[v_open[11]], v_pid, 'admin', 'fixture H second', 'test');
  insert into fx values ('H', v_pid, array[v_open[10], v_open[11]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case P', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[12]], v_pid, 'admin', 'fixture P', 'test');
  update blocks set status = 'assigned', assigned_at = now() where block_number = v_open[12];
  select id into v_game from games order by game_no limit 1;
  if v_game is null then raise exception 'TEST SETUP: no game to hang a payout on'; end if;
  insert into payouts (game_id, payout_type, block_number, participant_id, amount_cents, status)
    values (v_game, 'halftime', v_open[12], v_pid, 150000, 'owed');
  insert into fx values ('P', v_pid, array[v_open[12]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case N', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[13]], v_pid, 'admin', 'fixture N', 'test');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture N', null, null, 'test', null);
  insert into fx values ('N', v_pid, array[v_open[13]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case W', 'AVD', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[14]], v_pid, 'admin', 'fixture W', 'test');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture W', null, null, 'test', null);
  insert into fx values ('W', v_pid, array[v_open[14]]);
end $$;

-- 0. The fixture is what it claims.
do $$
declare
  v_n int;
begin
  select count(*) into v_n from blocks b join fx on b.block_number = any (fx.blocks) where b.status = 'assigned';
  if v_n is null or v_n <> 12 then
    raise exception 'TEST SETUP: expected 12 fixture blocks assigned, found %', v_n;
  end if;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'F')) is distinct from 'reserved'
     or (select status from blocks where block_number = (select blocks[2] from fx where k = 'H')) is distinct from 'reserved' then
    raise exception 'TEST SETUP: cases F and H second block should start reserved';
  end if;
end $$;

-- 1. The RPC on its own: admin-only, never anon, an actor, a real participant.
do $$
declare
  v_e uuid := (select pid from fx where k = 'E');
begin
  if has_function_privilege('anon', 'admin_demote_if_unpaid(uuid,text)', 'execute') then
    raise exception 'TEST FAILURE: anon can execute admin_demote_if_unpaid';
  end if;
  if not has_function_privilege('authenticated', 'admin_demote_if_unpaid(uuid,text)', 'execute') then
    raise exception 'TEST FAILURE: authenticated cannot execute admin_demote_if_unpaid';
  end if;
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_demote_if_unpaid(v_e, 'test');
    raise exception 'TEST FAILURE: a non-admin demoted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
  begin
    perform admin_demote_if_unpaid(v_e, ' ');
    raise exception 'TEST FAILURE: a blank actor was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%actor required%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  begin
    perform admin_demote_if_unpaid(gen_random_uuid(), 'test');
    raise exception 'TEST FAILURE: an unknown participant was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not found%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'E')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: a refused call changed the block';
  end if;
end $$;

-- A. The H2 shape, through the correction alone. The block goes back to
--    reserved inside admin_record_payment: holder, name, comp flag, notes,
--    method and ref kept, assigned_at cleared and kept in one audit row whose
--    target is the block, the correction carrying RM. A second, direct call is
--    a no-op.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'A');
  v_n int := (select blocks[1] from fx where k = 'A');
  v_orig uuid;
  b_before blocks;
  b_after blocks;
  v_count int;
  v_audit int;
  a audit_log;
begin
  select * into b_before from blocks where block_number = v_n;
  if b_before.assigned_at is null then raise exception 'TEST SETUP: case A had no assigned_at to clear'; end if;
  select id into v_orig from payments where participant_id = v_pid and method = 'cash';
  if v_orig is null then raise exception 'TEST SETUP: case A has no payment to correct'; end if;

  perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null,
                               'fixture reversal', 'Reverses payment ' || v_orig::text, v_orig, 'test', null);

  if exists (select 1 from payments where participant_id = v_pid and method = 'correction' and collected_by is distinct from 'RM') then
    raise exception 'TEST FAILURE: the correction did not inherit RM';
  end if;
  select * into b_after from blocks where block_number = v_n;
  if b_after.status is distinct from 'reserved' then raise exception 'TEST FAILURE: case A correction left the block %', b_after.status; end if;
  if b_after.participant_id is distinct from v_pid then raise exception 'TEST FAILURE: case A lost its holder'; end if;
  if b_after.display_name is distinct from 'Block A Name' then raise exception 'TEST FAILURE: case A display name %', b_after.display_name; end if;
  if b_after.comped or b_after.notes is distinct from b_before.notes
     or b_after.assignment_method is distinct from b_before.assignment_method
     or b_after.requested_ref is distinct from b_before.requested_ref then
    raise exception 'TEST FAILURE: case A changed more than status and assigned_at';
  end if;
  if b_after.assigned_at is not null then raise exception 'TEST FAILURE: case A kept assigned_at'; end if;

  select count(*) into v_audit from audit_log where action = 'demote_blocks' and after ->> 'participant_id' = v_pid::text;
  if v_audit is null or v_audit <> 1 then raise exception 'TEST FAILURE: case A wrote % demote_blocks rows', v_audit; end if;
  select * into a from audit_log where action = 'demote_blocks' and after ->> 'participant_id' = v_pid::text;
  -- getBlockHistory matches the block number in target_id (comma-separated).
  if a.target_id is distinct from v_n::text then
    raise exception 'TEST FAILURE: case A audit target_id is %, not block %', a.target_id, v_n;
  end if;
  if a.actor is distinct from 'test' or a.target_table is distinct from 'blocks'
     or (a.after ->> 'demoted') is null or (a.after ->> 'demoted')::int <> 1
     or (a.after ->> 'paid_cents') is null or (a.after ->> 'paid_cents')::bigint <> 0
     or (a.after ->> 'owed_cents') is null or (a.after ->> 'owed_cents')::bigint <> 50000 then
    raise exception 'TEST FAILURE: case A audit row %', a.after;
  end if;
  if (a.before -> 'blocks' -> 0 ->> 'block_number') is null
     or (a.before -> 'blocks' -> 0 ->> 'block_number')::int <> v_n
     or (a.before -> 'blocks' -> 0 ->> 'assigned_at') is null then
    raise exception 'TEST FAILURE: case A audit row lost the block or its assigned_at: %', a.before;
  end if;

  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 0 then raise exception 'TEST FAILURE: case A second call demoted %', v_count; end if;
  if (select count(*) from audit_log where action = 'demote_blocks' and after ->> 'participant_id' = v_pid::text) <> 1 then
    raise exception 'TEST FAILURE: a no-op call wrote an audit row';
  end if;
end $$;

-- B. Paid in full: a direct call moves nothing and writes nothing.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'B');
  v_count int;
begin
  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 0 then raise exception 'TEST FAILURE: case B (paid in full) demoted %', v_count; end if;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'B')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case B block is no longer assigned';
  end if;
  if exists (select 1 from audit_log where action = 'demote_blocks' and after ->> 'participant_id' = v_pid::text) then
    raise exception 'TEST FAILURE: case B wrote an audit row';
  end if;
end $$;

-- C. A comped block owes nothing and stays assigned; the corrected one goes.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'C');
  v_comp int := (select blocks[1] from fx where k = 'C');
  v_paid int := (select blocks[2] from fx where k = 'C');
  v_orig uuid := (select id from payments where participant_id = (select pid from fx where k = 'C') and method = 'cash');
begin
  if v_orig is null then raise exception 'TEST SETUP: case C has no payment to correct'; end if;
  perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null, 'fixture reversal', null, v_orig, 'test', null);
  if (select status from blocks where block_number = v_comp) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case C demoted the comped block';
  end if;
  if (select comped from blocks where block_number = v_comp) is distinct from true then
    raise exception 'TEST FAILURE: case C lost the comp';
  end if;
  if (select status from blocks where block_number = v_paid) is distinct from 'reserved' then
    raise exception 'TEST FAILURE: case C kept the unpaid block assigned';
  end if;
end $$;

-- D. Partial cover is refused: the ledger would pay for one of his two
--    assigned blocks, and which one keeps its payout is Anthony's call. The
--    correction itself does not land, and nothing moves.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'D');
  v_orig uuid := (select id from payments where participant_id = (select pid from fx where k = 'D') and source_ref = 'fixture 1');
begin
  if v_orig is null then raise exception 'TEST SETUP: case D has no payment to correct'; end if;
  begin
    perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null, 'fixture reversal', null, v_orig, 'test', null);
    raise exception 'TEST FAILURE: case D partial cover was not refused';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%Anthony''s call%' then raise exception 'TEST FAILURE: case D wrong refusal: %', sqlerrm; end if;
  end;
  if (select count(*) from blocks where participant_id = v_pid and status = 'assigned') <> 2 then
    raise exception 'TEST FAILURE: case D moved a block';
  end if;
  if exists (select 1 from payments where participant_id = v_pid and method = 'correction') then
    raise exception 'TEST FAILURE: case D correction landed though it was refused';
  end if;
end $$;

-- E. The RPC on its own, for a block already assigned with nothing paid.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'E');
  v_count int;
begin
  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 1 then raise exception 'TEST FAILURE: case E demoted %, expected 1', v_count; end if;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'E')) is distinct from 'reserved' then
    raise exception 'TEST FAILURE: case E block is not reserved';
  end if;
end $$;

-- F. A correction that completes a payment promotes and never demotes.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'F');
  v_orig uuid := (select id from payments where participant_id = (select pid from fx where k = 'F') and method = 'cash');
begin
  if v_orig is null then raise exception 'TEST SETUP: case F has no payment to correct'; end if;
  perform admin_record_payment(v_pid, 25000, 'correction', '2026-10-26', null, 'fixture top-up', null, v_orig, 'test', null);
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'F')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case F correction to full did not promote';
  end if;
  if exists (select 1 from audit_log where action = 'demote_blocks' and after ->> 'participant_id' = v_pid::text) then
    raise exception 'TEST FAILURE: case F wrote a demote row';
  end if;
end $$;

-- G. Only a correction demotes. G's assigned block has nothing behind it; an
--    ordinary payment that does not cover it moves nothing.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'G');
begin
  perform admin_record_payment(v_pid, 10000, 'cash', '2026-10-26', null, 'fixture partial', null, null, 'test', null);
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'G')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case G: a cash payment demoted a block';
  end if;
  if exists (select 1 from audit_log where action = 'demote_blocks' and after ->> 'participant_id' = v_pid::text) then
    raise exception 'TEST FAILURE: case G wrote a demote row';
  end if;
end $$;

-- H. A reserved, unpaid second block never makes the paid one look short.
--    A mistaken extra payment and its correction leave the paid block
--    assigned, and a direct call agrees.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'H');
  v_paid_block int := (select blocks[1] from fx where k = 'H');
  v_extra uuid;
  v_count int;
begin
  v_extra := admin_record_payment(v_pid, 10000, 'cash', '2026-10-26', null, 'fixture mistaken extra', null, null, 'test', 'RM');
  perform admin_record_payment(v_pid, -10000, 'correction', '2026-10-26', null, 'fixture reversal of the extra', null, v_extra, 'test', null);
  if (select status from blocks where block_number = v_paid_block) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case H: a correction demoted a block he paid for';
  end if;
  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 0 then raise exception 'TEST FAILURE: case H direct call demoted %', v_count; end if;
  if (select status from blocks where block_number = (select blocks[2] from fx where k = 'H')) is distinct from 'reserved' then
    raise exception 'TEST FAILURE: case H second block changed';
  end if;
end $$;

-- P. A block with a payout that is not void is refused, and stays assigned.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'P');
begin
  begin
    perform admin_demote_if_unpaid(v_pid, 'test');
    raise exception 'TEST FAILURE: case P demoted a block with a payout';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%payout%' then raise exception 'TEST FAILURE: case P wrong refusal: %', sqlerrm; end if;
  end;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'P')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case P block moved';
  end if;
end $$;

-- N. A negative amount on an ordinary method takes money away too, and
--    demotes like a correction.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'N');
begin
  perform admin_record_payment(v_pid, -50000, 'cash', '2026-10-26', null, 'fixture negative cash', null, null, 'test', null);
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'N')) is distinct from 'reserved' then
    raise exception 'TEST FAILURE: case N: a negative cash row left the block assigned';
  end if;
end $$;

-- W. A correction booked on the wrong participant is refused: it would
--    reverse W's money on B's ledger and demote B. Nothing lands.
do $$
declare
  v_b uuid := (select pid from fx where k = 'B');
  v_w uuid := (select pid from fx where k = 'W');
  v_orig uuid := (select id from payments where participant_id = (select pid from fx where k = 'W') and method = 'cash');
begin
  if v_orig is null then raise exception 'TEST SETUP: case W has no payment to correct'; end if;
  begin
    perform admin_record_payment(v_b, -50000, 'correction', '2026-10-26', null, 'fixture wrong person', null, v_orig, 'test', null);
    raise exception 'TEST FAILURE: case W correction on the wrong participant was accepted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%different participant%' then raise exception 'TEST FAILURE: case W wrong refusal: %', sqlerrm; end if;
  end;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'B')) is distinct from 'assigned'
     or (select status from blocks where block_number = (select blocks[1] from fx where k = 'W')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case W moved a block';
  end if;
  if exists (select 1 from payments where corrects_payment_id = v_orig) then
    raise exception 'TEST FAILURE: case W correction landed though it was refused';
  end if;
end $$;

-- 2. Paying again promotes back and stamps a fresh assigned_at.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'A');
  v_n int := (select blocks[1] from fx where k = 'A');
begin
  perform admin_record_payment(v_pid, 50000, 'venmo', '2026-10-27', 'fx-a2', 'fixture', null, null, 'test', null);
  if (select status from blocks where block_number = v_n) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: paying again did not promote case A';
  end if;
  if (select assigned_at from blocks where block_number = v_n) is null then
    raise exception 'TEST FAILURE: re-promotion left assigned_at empty';
  end if;
end $$;

-- 3. Promote and demote take the same participant lock before reading the
--    balance, and record_payment reaches it through them. Fresh participants,
--    so no earlier call in this transaction holds it.
do $$
declare
  v_p uuid;
  v_fn text;
  k1 oid := (hashtext('participant_finance')::bigint & 4294967295)::oid;
begin
  foreach v_fn in array array['promote', 'demote', 'record'] loop
    insert into participants (full_name, owner_group, blocks_requested)
      values ('Lock ' || v_fn, 'AVD', 0) returning id into v_p;
    if exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                and classid = k1 and objid = (hashtext(v_p::text)::bigint & 4294967295)::oid and objsubid = 2) then
      raise exception 'TEST SETUP: % lock already held before the call', v_fn;
    end if;
    if v_fn = 'promote' then
      perform admin_promote_if_paid(v_p, 'test');
    elsif v_fn = 'demote' then
      perform admin_demote_if_unpaid(v_p, 'test');
    else
      perform admin_record_payment(v_p, 10000, 'cash', '2026-10-26', null, 'fixture lock', null, null, 'test', null);
    end if;
    if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                    and classid = k1 and objid = (hashtext(v_p::text)::bigint & 4294967295)::oid and objsubid = 2) then
      raise exception 'TEST FAILURE: % did not take the participant lock', v_fn;
    end if;
  end loop;
end $$;

rollback;
