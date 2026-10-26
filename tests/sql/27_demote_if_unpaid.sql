-- Migration 39: admin_demote_if_unpaid, the mirror of admin_promote_if_paid,
-- and admin_record_payment calling it after every correction (Anthony,
-- 2026-10-26, Part H2; review of PR 31). A correction that leaves a
-- participant short moves his assigned, non-comped blocks back to reserved,
-- holder and name kept. No other payment method demotes.
--
-- One transaction, rolled back. Every value read is guarded for NULL.
--
-- Mutation checks, each verified to raise: drop the call from record_payment
-- (case A); call it for every method (case G); demote comped blocks too (case
-- C); drop the paid < due guard (case B); skip the audit row (case A); keep
-- assigned_at (case A); demote only one of a partial payer's blocks (case D);
-- let a non-admin call it (section 1).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

create temp table fx (k text primary key, pid uuid, blocks int[]) on commit drop;

-- Fixtures on blocks that are open in the seed. Each case is assigned before
-- the step under test.
--   A: one block, RM cash (the H2 shape).
--   B: one block, paid in full.
--   C: one comped block and one paid block.
--   D: two blocks, paid for both in two rows.
--   E: one block left assigned with nothing paid (the state a correction made
--      before migration 39 would have left), set directly by the fixture.
--   F: one block, half paid, so still reserved.
--   G: one block paid and assigned, then a second block requested.
do $$
declare
  v_open int[];
  v_pid uuid;
begin
  select array_agg(block_number order by block_number) into v_open
    from (select block_number from blocks where status = 'available' order by block_number limit 9) s;
  if v_open is null or cardinality(v_open) < 9 then
    raise exception 'TEST SETUP: need 9 available blocks, found %', coalesce(cardinality(v_open), 0);
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
  perform admin_record_payment(v_pid, 50000, 'venmo', '2026-09-04', 'fx-g', 'fixture', null, null, 'test', null);
  update participants set blocks_requested = 2 where id = v_pid;
  insert into fx values ('G', v_pid, array[v_open[9]]);
end $$;

-- 0. The fixture is what it claims.
do $$
declare
  v_n int;
begin
  select count(*) into v_n from blocks b join fx on b.block_number = any (fx.blocks)
   where fx.k in ('A','B','C','D','E','G') and b.status = 'assigned';
  if v_n is null or v_n <> 8 then
    raise exception 'TEST SETUP: expected 8 fixture blocks assigned, found %', v_n;
  end if;
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'F')) is distinct from 'reserved' then
    raise exception 'TEST SETUP: case F should start reserved';
  end if;
end $$;

-- 1. The RPC on its own: admin-only, an actor, a real participant.
do $$
declare
  v_e uuid := (select pid from fx where k = 'E');
begin
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
--    method and ref kept, assigned_at cleared and kept in one audit row, the
--    correction carrying RM. A second, direct call is a no-op.
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

  select count(*) into v_audit from audit_log where action = 'demote_blocks' and target_id = v_pid::text;
  if v_audit is null or v_audit <> 1 then raise exception 'TEST FAILURE: case A wrote % demote_blocks rows', v_audit; end if;
  select * into a from audit_log where action = 'demote_blocks' and target_id = v_pid::text;
  if a.actor is distinct from 'test' or a.target_table is distinct from 'blocks'
     or (a.after ->> 'demoted') is null or (a.after ->> 'demoted')::int <> 1
     or (a.after ->> 'paid_cents') is null or (a.after ->> 'paid_cents')::bigint <> 0
     or (a.after ->> 'due_cents') is null or (a.after ->> 'due_cents')::bigint <> 50000 then
    raise exception 'TEST FAILURE: case A audit row %', a.after;
  end if;
  if (a.before -> 'blocks' -> 0 ->> 'block_number') is null
     or (a.before -> 'blocks' -> 0 ->> 'block_number')::int <> v_n
     or (a.before -> 'blocks' -> 0 ->> 'assigned_at') is null then
    raise exception 'TEST FAILURE: case A audit row lost the block or its assigned_at: %', a.before;
  end if;

  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 0 then raise exception 'TEST FAILURE: case A second call demoted %', v_count; end if;
  if (select count(*) from audit_log where action = 'demote_blocks' and target_id = v_pid::text) <> 1 then
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
  if exists (select 1 from audit_log where action = 'demote_blocks' and target_id = v_pid::text) then
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

-- D. Partial payment after a correction: both blocks go back, the rule
--    promotion uses in reverse.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'D');
  v_orig uuid := (select id from payments where participant_id = (select pid from fx where k = 'D') and source_ref = 'fixture 1');
begin
  if v_orig is null then raise exception 'TEST SETUP: case D has no payment to correct'; end if;
  perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null, 'fixture reversal', null, v_orig, 'test', null);
  if (select count(*) from blocks where participant_id = v_pid and status = 'reserved') <> 2 then
    raise exception 'TEST FAILURE: case D did not demote both blocks';
  end if;
end $$;

-- E. The RPC on its own, for a block already assigned and short.
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
  if exists (select 1 from audit_log where action = 'demote_blocks' and target_id = v_pid::text) then
    raise exception 'TEST FAILURE: case F wrote a demote row';
  end if;
end $$;

-- G. Only a correction demotes. G is short only because he asked for a second
--    block; an ordinary payment that leaves him short moves nothing.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'G');
begin
  perform admin_record_payment(v_pid, 10000, 'cash', '2026-10-26', null, 'fixture partial', null, null, 'test', null);
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'G')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: case G: a cash payment demoted a block';
  end if;
  if exists (select 1 from audit_log where action = 'demote_blocks' and target_id = v_pid::text) then
    raise exception 'TEST FAILURE: case G wrote a demote row';
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

rollback;
