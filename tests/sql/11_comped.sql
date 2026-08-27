-- A comped block is a real block in play that owes nothing: it counts
-- toward committed and placed, stays fully winnable, contributes $0 to due
-- and $0 to collected, is never chased, and is invisible to the public.
begin;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Baseline, then comp one of Jr/Diz's two blocks (#36) — the same
-- two-blocks-one-owner shape as AAA in production.
do $$
declare
  v_due_before bigint;
  v_committed_before int;
  v_placed_before int;
  v_due_after bigint;
  pot v_pot;
  price int;
begin
  select price_per_block_cents into price from config;
  select due_cents, committed_blocks, reserved + assigned
    into v_due_before, v_committed_before, v_placed_before from v_pot;

  perform admin_set_comped(36, true, 'test');

  select * into pot from v_pot;
  v_due_after := pot.due_cents;

  -- Due drops by exactly one block's price; collected never moves.
  if v_due_after <> v_due_before - price then
    raise exception 'TEST FAILURE: due should drop by one block price, % -> %',
      v_due_before, v_due_after;
  end if;

  -- Committed and placed still count it.
  if pot.committed_blocks <> v_committed_before then
    raise exception 'TEST FAILURE: committed changed, % -> %',
      v_committed_before, pot.committed_blocks;
  end if;
  if pot.reserved + pot.assigned <> v_placed_before then
    raise exception 'TEST FAILURE: placed changed, % -> %',
      v_placed_before, pot.reserved + pot.assigned;
  end if;
  if (select count(*) from blocks where comped) <> 1 then
    raise exception 'TEST FAILURE: comped count should be 1, got %',
      (select count(*) from blocks where comped);
  end if;

  -- The invariant still holds.
  if pot.available + pot.reserved + pot.assigned + pot.held <> 100 then
    raise exception 'TEST FAILURE: block invariant broken';
  end if;
end $$;

-- Comping settles the block: it owes nothing, so it moves to assigned
-- without inventing a payment.
do $$
declare
  v_status text;
begin
  select status into v_status from blocks where block_number = 36;
  if v_status <> 'assigned' then
    raise exception 'TEST FAILURE: a comped block should be settled as assigned, got %', v_status;
  end if;
end $$;

-- Committed is a COUNT, never money divided by price: with a comp in play
-- the two disagree, and the count is the truth.
do $$
declare
  pot v_pot;
  price int;
begin
  select price_per_block_cents into price from config;
  select * into pot from v_pot;
  if pot.due_cents / price = pot.committed_blocks then
    raise exception 'TEST FAILURE: fixture cannot prove the difference';
  end if;
  if pot.due_cents / price
       <> pot.committed_blocks - (select count(*) from blocks where comped) then
    raise exception 'TEST FAILURE: due/price (%) should equal committed (%) minus comped (%)',
      pot.due_cents / price, pot.committed_blocks,
      (select count(*) from blocks where comped);
  end if;
end $$;

-- The comped block's owner is not chased for it.
do $$
declare
  f v_participant_finance;
  v_owner uuid;
  price int;
begin
  select price_per_block_cents into price from config;
  select participant_id into v_owner from blocks where block_number = 36;
  select * into f from v_participant_finance where participant_id = v_owner;
  if f.blocks_comped <> 1 then
    raise exception 'TEST FAILURE: owner should show 1 comped block, got %', f.blocks_comped;
  end if;
  -- Jr/Diz holds two blocks; only one is billable now.
  if f.amount_due_cents <> (f.blocks_held - f.blocks_comped) * price then
    raise exception 'TEST FAILURE: due should bill only non-comped blocks, got %',
      f.amount_due_cents;
  end if;
end $$;

-- Comped is admin-only and NEVER public.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('v_public_blocks','v_public_games','v_public_payouts','v_pot')
      and column_name = 'comped'
  ) then
    raise exception 'TEST FAILURE: comped leaks into a public projection view';
  end if;
end $$;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  n int;
begin
  -- The public block payload carries no comp marker at all.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'v_public_blocks'
     and column_name = 'comped';
  if n <> 0 then raise exception 'TEST FAILURE: v_public_blocks exposes comped'; end if;

  -- And anon cannot comp anything.
  begin
    perform admin_set_comped(38, true, 'anon');
    raise exception 'TEST FAILURE: anon comped a block';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- A comped block is still fully eligible to win, and pays out normally.
do $$
declare
  g uuid;
  res jsonb;
  rows_d int[];
  cols_d int[];
begin
  -- Block 36 = row 3, col 5 (0-based); SQL arrays are 1-indexed.
  select id into g from games where game_no = 6;
  update games set date_confirmed = true, kickoff_at = now() + interval '3 days'
   where id = g;
  perform admin_assign_digits(g, 'test');
  perform admin_publish_digits(g, 'test');
  select row_digits, col_digits into rows_d, cols_d from games where id = g;

  -- Promote block 36 to assigned so a payout can attach, then score the
  -- game so that block 36 is the final winner.
  update blocks set status = 'assigned' where block_number = 36;
  res := admin_score_game(g, 'final', cols_d[6], rows_d[4], 'test');

  if (res ->> 'block')::int <> 36 then
    raise exception 'TEST FAILURE: fixture did not land on block 36, got %', res ->> 'block';
  end if;
  if (res ->> 'payout_created')::boolean is not true then
    raise exception 'TEST FAILURE: a comped block must still win a payout';
  end if;
  if (res ->> 'review')::boolean is true then
    raise exception 'TEST FAILURE: a comped winner must not be flagged for review';
  end if;
end $$;

-- Un-comping restores the charge, and both directions are audited.
do $$
declare
  v_due_comped bigint;
  v_due_after bigint;
  price int;
  n int;
begin
  select price_per_block_cents into price from config;
  select due_cents into v_due_comped from v_pot;
  perform admin_set_comped(36, false, 'test');
  select due_cents into v_due_after from v_pot;
  if v_due_after <> v_due_comped + price then
    raise exception 'TEST FAILURE: un-comp should restore the charge, % -> %',
      v_due_comped, v_due_after;
  end if;
  select count(*) into n from audit_log where action in ('comp_block','uncomp_block');
  if n <> 2 then
    raise exception 'TEST FAILURE: expected 2 comp audit rows, got %', n;
  end if;
  -- The charge is back and the owner has not paid it, so the block drops
  -- out of assigned rather than sitting there as a phantom settlement.
  if (select status from blocks where block_number = 36) <> 'reserved' then
    raise exception 'TEST FAILURE: un-comp left an unpaid block assigned, got %',
      (select status from blocks where block_number = 36);
  end if;
  -- And the invariant is untouched by either direction.
  if (select count(*) from blocks) <> 100
     or (select available + reserved + assigned + held from v_pot) <> 100 then
    raise exception 'TEST FAILURE: block invariant broken by the comp round trip';
  end if;
end $$;

-- An unowned block cannot be comped, and releasing clears any comp.
do $$
declare
  v_comped boolean;
begin
  begin
    perform admin_set_comped(2, true, 'test');  -- block 2 is open
    raise exception 'TEST FAILURE: comped an unowned block';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;

  perform admin_set_comped(38, true, 'test');
  perform admin_release_block(38, 'test');
  select comped into v_comped from blocks where block_number = 38;
  if v_comped then
    raise exception 'TEST FAILURE: release left the comp attached';
  end if;
end $$;

rollback;
