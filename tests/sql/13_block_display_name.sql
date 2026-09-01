-- A block can carry its own name. The name is display only: it changes what
-- the grid and a winner announcement say, and it changes NOTHING about who
-- owes what or who gets chased.
begin;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Jr/Diz holds two blocks (36, 38) under one alias — the same shape as the
-- owner who wanted a different name on each of his.
do $$
declare
  v_pid uuid;
  v_due_before bigint;
  v_due_after bigint;
  v_committed_before int;
begin
  select participant_id into v_pid from blocks where block_number = 36;
  select amount_due_cents into v_due_before from v_participant_finance where participant_id = v_pid;
  select committed_blocks into v_committed_before from v_pot;

  perform admin_set_block_name(36, 'FIRST NAME', 'test');
  perform admin_set_block_name(38, 'second name', 'test');

  -- The two blocks now read differently from each other.
  if (select display_name from v_public_blocks where block_number = 36) is distinct from 'FIRST NAME' then
    raise exception 'TEST FAILURE: block 36 did not take its own name';
  end if;
  if (select display_name from v_public_blocks where block_number = 38) is distinct from 'second name' then
    raise exception 'TEST FAILURE: block 38 did not take its own name';
  end if;

  -- MONEY IS UNTOUCHED: one participant, one due, one committed count.
  select amount_due_cents into v_due_after from v_participant_finance where participant_id = v_pid;
  if v_due_after is distinct from v_due_before then
    raise exception 'TEST FAILURE: naming a block moved the money, % -> %', v_due_before, v_due_after;
  end if;
  if (select committed_blocks from v_pot) <> v_committed_before then
    raise exception 'TEST FAILURE: naming a block moved the committed count';
  end if;

  -- And the owner is still ONE row in every chase surface, not two.
  if (select count(*) from v_participant_finance where participant_id = v_pid) <> 1 then
    raise exception 'TEST FAILURE: owner appears more than once in finance';
  end if;
  if (select count(*) from participants where id = v_pid) <> 1 then
    raise exception 'TEST FAILURE: naming a block created a second participant row';
  end if;
end $$;

-- Fallback: a block with no name of its own still shows its owner.
do $$
declare v_alias text;
begin
  select coalesce(p.display_alias, p.full_name) into v_alias
    from blocks b join participants p on p.id = b.participant_id
   where b.block_number = 15;
  if v_alias is null then
    raise exception 'TEST FAILURE: fixture has no owner alias for block 15 — the fallback check would be vacuous';
  end if;
  if (select display_name from v_public_blocks where block_number = 15) is distinct from v_alias then
    raise exception 'TEST FAILURE: an unnamed block stopped falling back to its owner';
  end if;
end $$;

-- Clearing a name returns the block to the owner's alias.
do $$
declare v_alias text;
begin
  select coalesce(p.display_alias, p.full_name) into v_alias
    from blocks b join participants p on p.id = b.participant_id
   where b.block_number = 36;
  perform admin_set_block_name(36, '', 'test');
  if (select display_name from v_public_blocks where block_number = 36) is distinct from v_alias then
    raise exception 'TEST FAILURE: cleared name did not fall back to the alias';
  end if;
  perform admin_set_block_name(36, 'FIRST NAME', 'test');  -- restore for later checks
end $$;

-- A payout is announced under the name on the block that hit.
do $$
declare
  v_game uuid;
  v_pid uuid;
  v_name text;
begin
  select id into v_game from games order by game_no limit 1;
  select participant_id into v_pid from blocks where block_number = 38;
  insert into payouts (game_id, payout_type, block_number, participant_id, amount_cents, status)
  values (v_game, 'final', 38, v_pid, 100000, 'owed');
  select display_name into v_name from v_public_payouts where block_number = 38;
  if v_name is distinct from 'second name' then
    raise exception 'TEST FAILURE: payout announced as "%", expected the block name', v_name;
  end if;
end $$;

-- An unowned block cannot be named, and releasing clears any name.
do $$
declare v_name text;
begin
  begin
    perform admin_set_block_name(1, 'ORPHAN', 'test');  -- block 1 is open
    raise exception 'TEST FAILURE: named a block with no owner';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;

  perform admin_release_block(38, 'test');
  select display_name into v_name from blocks where block_number = 38;
  if v_name is not null then
    raise exception 'TEST FAILURE: release left the block name attached';
  end if;
  -- ...but the history remembers it.
  if (select notes from blocks where block_number = 38) not like '%second name%' then
    raise exception 'TEST FAILURE: release did not preserve the prior block name';
  end if;
end $$;

-- The name is admin-only to WRITE, public to READ (it is a display name).
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform admin_set_block_name(36, 'ANON WUZ HERE', 'anon');
    raise exception 'TEST FAILURE: anon named a block';
  exception
    when insufficient_privilege then null;
  end;
  -- anon cannot reach the base column at all
  if exists (select 1 from blocks) then
    raise exception 'TEST FAILURE: anon can read the blocks table';
  end if;
end $$;
reset role;

rollback;
