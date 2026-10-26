-- Migration 39: admin_demote_if_unpaid, the mirror of admin_promote_if_paid
-- (Anthony, 2026-10-26, Part H2). A correction that leaves a participant short
-- moves his assigned, non-comped blocks back to reserved, holder and name kept.
--
-- One transaction, rolled back. Every value read is guarded for NULL.
--
-- Mutation checks, each verified to raise: demote comped blocks too (case C);
-- drop the paid < due guard (case B); skip the audit row (case A); keep
-- assigned_at (case A); demote only one of a partial payer's blocks (case D);
-- let a non-admin call it (section 1).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

create temp table fx (k text primary key, pid uuid, blocks int[]) on commit drop;

-- Fixtures on blocks that are open in the seed. A: one block, RM cash, then a
-- correction. B: paid in full, never corrected. C: one comped block and one
-- paid-then-corrected block. D: two blocks, paid for both, one payment
-- corrected.
do $$
declare
  v_open int[];
  v_pid uuid;
  v_pay uuid;
begin
  select array_agg(block_number order by block_number) into v_open
    from (select block_number from blocks where status = 'available' order by block_number limit 6) s;
  if v_open is null or cardinality(v_open) < 6 then
    raise exception 'TEST SETUP: need 6 available blocks, found %', coalesce(cardinality(v_open), 0);
  end if;

  insert into participants (full_name, display_alias, owner_group, blocks_requested)
    values ('Case A', 'Scro Test', 'RM', 1) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[1]], v_pid, 'admin', 'fixture A', 'test');
  perform admin_set_block_name(v_open[1], 'Block A Name', 'test');
  v_pay := admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null,
                                'Held by Ronnie Malandro (RM), confirmed by him to Anthony 2026-09-04',
                                null, null, 'test', 'RM');
  perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null,
                               'fixture reversal', 'Reverses payment ' || v_pay::text, v_pay, 'test', null);
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
  v_pay := admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture', null, null, 'test', null);
  perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null, 'fixture reversal', null, v_pay, 'test', null);
  insert into fx values ('C', v_pid, array[v_open[3], v_open[4]]);

  insert into participants (full_name, owner_group, blocks_requested)
    values ('Case D', 'MAP', 2) returning id into v_pid;
  perform admin_reserve_blocks(array[v_open[5], v_open[6]], v_pid, 'admin', 'fixture D', 'test');
  v_pay := admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture 1', null, null, 'test', 'MAP');
  perform admin_record_payment(v_pid, 50000, 'cash', '2026-09-04', null, 'fixture 2', null, null, 'test', 'MAP');
  perform admin_record_payment(v_pid, -50000, 'correction', '2026-10-26', null, 'fixture reversal', null, v_pay, 'test', null);
  insert into fx values ('D', v_pid, array[v_open[5], v_open[6]]);
end $$;

-- 0. The fixture is what it claims: every case is assigned before the call,
--    because record_payment only ever promotes, and corrections inherited.
do $$
declare
  v_n int;
begin
  select count(*) into v_n from blocks b join fx on b.block_number = any (fx.blocks) where b.status = 'assigned';
  if v_n is null or v_n <> 6 then
    raise exception 'TEST SETUP: expected all 6 fixture blocks assigned before demotion, found %', v_n;
  end if;
  if exists (select 1 from payments p join fx on fx.k = 'A' and p.participant_id = fx.pid
              where p.method = 'correction' and p.collected_by is distinct from 'RM') then
    raise exception 'TEST SETUP: the correction did not inherit RM';
  end if;
end $$;

-- 1. Admin-only, an actor, and a real participant.
do $$
declare
  v_a uuid := (select pid from fx where k = 'A');
begin
  perform set_config('request.jwt.claims', '{"email":"someone-else@tnf.test"}', true);
  begin
    perform admin_demote_if_unpaid(v_a, 'test');
    raise exception 'TEST FAILURE: a non-admin demoted';
  exception when others then
    if sqlerrm like 'TEST FAILURE%' then raise; end if;
    if sqlerrm not like '%not authorized%' then raise exception 'TEST FAILURE: wrong refusal: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
  begin
    perform admin_demote_if_unpaid(v_a, ' ');
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
  if (select status from blocks where block_number = (select blocks[1] from fx where k = 'A')) is distinct from 'assigned' then
    raise exception 'TEST FAILURE: a refused call changed the block';
  end if;
end $$;

-- A. The H2 shape: reversed RM cash, one block. Back to reserved, holder,
--    name, comp flag and notes kept, assigned_at cleared, one audit row that
--    keeps the old assigned_at. A second call is a no-op.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'A');
  v_n int := (select blocks[1] from fx where k = 'A');
  b_before blocks;
  b_after blocks;
  v_count int;
  v_audit int;
  a audit_log;
begin
  select * into b_before from blocks where block_number = v_n;
  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 1 then raise exception 'TEST FAILURE: case A demoted %, expected 1', v_count; end if;
  select * into b_after from blocks where block_number = v_n;
  if b_after.status is distinct from 'reserved' then raise exception 'TEST FAILURE: case A status %', b_after.status; end if;
  if b_after.participant_id is distinct from v_pid then raise exception 'TEST FAILURE: case A lost its holder'; end if;
  if b_after.display_name is distinct from 'Block A Name' then raise exception 'TEST FAILURE: case A display name %', b_after.display_name; end if;
  if b_after.comped or b_after.notes is distinct from b_before.notes
     or b_after.assignment_method is distinct from b_before.assignment_method
     or b_after.requested_ref is distinct from b_before.requested_ref then
    raise exception 'TEST FAILURE: case A changed more than status and assigned_at';
  end if;
  if b_before.assigned_at is null then raise exception 'TEST SETUP: case A had no assigned_at to clear'; end if;
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

-- B. Paid in full: nothing moves and nothing is written.
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
  v_count int;
begin
  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 1 then raise exception 'TEST FAILURE: case C demoted %, expected 1', v_count; end if;
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

-- D. Partial payment: both blocks go back, the rule promotion uses in reverse.
do $$
declare
  v_pid uuid := (select pid from fx where k = 'D');
  v_count int;
begin
  v_count := admin_demote_if_unpaid(v_pid, 'test');
  if v_count is null or v_count <> 2 then raise exception 'TEST FAILURE: case D demoted %, expected 2', v_count; end if;
  if (select count(*) from blocks where participant_id = v_pid and status = 'reserved') <> 2 then
    raise exception 'TEST FAILURE: case D did not demote both blocks';
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
