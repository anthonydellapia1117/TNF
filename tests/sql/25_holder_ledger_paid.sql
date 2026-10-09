-- Migration 36: a holder check-in says Paid only when the ledger backs it
-- (Anthony, 2026-10-08, Part E4). email_holder_facts() marks each committed
-- block ledger_paid: true when the block is assigned and either comped, or the
-- participant's payment rows (corrections included) total at least the block
-- price for every assigned block that is not comped. The renderer reads that
-- fact and nothing else; blocks.status alone never makes a block Paid.
--
-- One transaction, rolled back. Every value read is guarded for NULL. Fixture
-- addresses use the reserved tnf.test domain only.
--
-- Mutation checks, each verified to raise: drop the comped clause (case I);
-- read status instead of the ledger (case B); count comped blocks as owed
-- (case G); ignore corrections (case E); let a reserved block be Paid (case F).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

update owners set email = 'avd-primary@tnf.test' where code = 'AVD';

-- Fixture holders, one address each, all on blocks that are open in the seed.
create temp table fx (k text primary key, pid uuid, addr text, blocks int[]) on commit drop;

do $$
declare
  v_open int[];
  v_pid uuid;
  v_pay uuid;
  v_k text;
begin
  select array_agg(block_number order by block_number) into v_open
    from (select block_number from blocks where status = 'available' order by block_number limit 12) s;
  if v_open is null or cardinality(v_open) < 12 then
    raise exception 'TEST SETUP: need 12 available blocks, found %', coalesce(cardinality(v_open), 0);
  end if;

  foreach v_k in array array['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] loop
    insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
    values ('Fixture ' || v_k, v_k, lower(v_k) || '-holder@tnf.test', 'RM', 'email', 2)
    returning id into v_pid;
    insert into fx values (v_k, v_pid, lower(v_k) || '-holder@tnf.test', '{}');
  end loop;

  -- A: one assigned block, one 500 Venmo row: Paid.
  select fx.pid into v_pid from fx where fx.k = 'A';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number = v_open[1];
  insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id) values (v_pid, 50000, 'venmo', '2026-10-01', 'fx-a');
  update fx set blocks = array[v_open[1]] where fx.k = 'A';

  -- B: one assigned block, no payment row at all: not found, whatever the status says.
  select fx.pid into v_pid from fx where fx.k = 'B';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number = v_open[2];
  update fx set blocks = array[v_open[2]] where fx.k = 'B';

  -- C: one assigned comped block, no payment row: Paid (a comp is reconciled, basis comp).
  select fx.pid into v_pid from fx where fx.k = 'C';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin', comped = true where block_number = v_open[3];
  update fx set blocks = array[v_open[3]] where fx.k = 'C';

  -- D: two assigned blocks, one 500 row: neither is backed (500 per assigned block).
  select fx.pid into v_pid from fx where fx.k = 'D';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number in (v_open[4], v_open[5]);
  insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id) values (v_pid, 50000, 'venmo', '2026-10-01', 'fx-d');
  update fx set blocks = array[v_open[4], v_open[5]] where fx.k = 'D';

  -- E: one assigned block, 500 then a correction of minus 500: net 0, not found.
  select fx.pid into v_pid from fx where fx.k = 'E';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number = v_open[6];
  insert into payments (participant_id, amount_cents, method, paid_on, collected_by) values (v_pid, 50000, 'cash', '2026-09-04', 'RM') returning id into v_pay;
  insert into payments (participant_id, amount_cents, method, paid_on, corrects_payment_id, collected_by) values (v_pid, -50000, 'correction', '2026-10-08', v_pay, 'RM');
  update fx set blocks = array[v_open[6]] where fx.k = 'E';

  -- F: one reserved block with a 500 row: still reserved, never Paid here.
  select fx.pid into v_pid from fx where fx.k = 'F';
  update blocks set participant_id = v_pid, status = 'reserved', assignment_method = 'admin' where block_number = v_open[7];
  insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id) values (v_pid, 50000, 'venmo', '2026-10-01', 'fx-f');
  update fx set blocks = array[v_open[7]] where fx.k = 'F';

  -- G: one comped and one paid assigned block, one 500 row: both Paid (the comp owes nothing).
  select fx.pid into v_pid from fx where fx.k = 'G';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin', comped = true where block_number = v_open[8];
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number = v_open[9];
  insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id) values (v_pid, 50000, 'venmo', '2026-10-01', 'fx-g');
  update fx set blocks = array[v_open[8], v_open[9]] where fx.k = 'G';

  -- H: one assigned block, owner-held cash: Paid (an owner's word is the record for his book).
  select fx.pid into v_pid from fx where fx.k = 'H';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number = v_open[10];
  insert into payments (participant_id, amount_cents, method, paid_on, collected_by) values (v_pid, 50000, 'cash', '2026-09-04', 'RM');
  update fx set blocks = array[v_open[10]] where fx.k = 'H';

  -- I: one comped and one unpaid assigned block, no payment row: the comp is
  -- Paid, the other is not found. The unpaid block must not drag the comp down
  -- (and this is the case that proves the comp clause is not redundant: with
  -- only comped blocks the owed count is 0 and the ledger test alone passes).
  select fx.pid into v_pid from fx where fx.k = 'I';
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin', comped = true where block_number = v_open[11];
  update blocks set participant_id = v_pid, status = 'assigned', assignment_method = 'admin' where block_number = v_open[12];
  update fx set blocks = array[v_open[11], v_open[12]] where fx.k = 'I';
end $$;

-- 1. Every committed block in a holder context carries ledger_paid, a boolean.
do $$
declare
  r record;
  v jsonb;
begin
  for r in select * from fx loop
    v := admin_email_context('holder_checkin_t', r.addr) -> 'holder' -> 'blocks';
    if v is null or jsonb_array_length(v) = 0 then raise exception 'TEST FAILURE: % has no blocks in its context', r.k; end if;
    if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e -> 'ledger_paid') is distinct from 'boolean') then
      raise exception 'TEST FAILURE: a block for % carries no boolean ledger_paid: %', r.k, v;
    end if;
  end loop;
end $$;

-- 2. The derivation, case by case.
do $$
declare
  want jsonb := '{"A": [true], "B": [false], "C": [true], "D": [false, false], "E": [false], "F": [false], "G": [true, true], "H": [true], "I": [true, false]}';
  r record;
  got jsonb;
begin
  for r in select * from fx order by k loop
    select jsonb_agg((e ->> 'ledger_paid')::boolean order by (e ->> 'block_number')::int)
      into got
      from jsonb_array_elements(admin_email_context('holder_checkin_t', r.addr) -> 'holder' -> 'blocks') e;
    if got is null then raise exception 'TEST FAILURE: case % read NULL', r.k; end if;
    if got is distinct from want -> r.k then
      raise exception 'TEST FAILURE: case % ledger_paid is %, want %', r.k, got, want -> r.k;
    end if;
  end loop;
end $$;

-- 3. The batch carries the same fact, and the comp flag still never reaches a context.
do $$
declare
  v jsonb;
begin
  v := admin_email_batch('holder_checkin_t');
  if v is null then raise exception 'TEST FAILURE: batch came back NULL'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v -> 'items') i, jsonb_array_elements(i -> 'holder' -> 'blocks') b
     where i ->> 'recipient' = 'b-holder@tnf.test' and (b ->> 'ledger_paid')::boolean = false) then
    raise exception 'TEST FAILURE: the batch does not carry ledger_paid false for the unbacked block';
  end if;
  if v::text like '%comped%' then
    raise exception 'TEST FAILURE: the comp flag reached an email batch; it is admin-only';
  end if;
  if admin_email_context('holder_checkin_t', 'c-holder@tnf.test')::text like '%comped%' then
    raise exception 'TEST FAILURE: the comp flag reached an email context; it is admin-only';
  end if;
end $$;

rollback;
