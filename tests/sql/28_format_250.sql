-- Migration 40: the 250 format (Anthony, 2026-11-10, Part J step 2).
-- admin_set_format moves the price and the one payout tier; admin_double_holdings
-- gives every held block one new block, same holder and same status, its
-- number drawn by block_draw_order; blocks_requested doubles. Run together,
-- every participant owes what he owed before, except a fixed placement's
-- holder, who owes one block more.
--
-- One transaction, rolled back. Every value read is guarded for NULL.
--
-- Mutation checks, each verified to raise: mirror every block as reserved
-- (section 2, holdings); skip the blocks_requested doubling (2, requested);
-- place the sources in descending order (2, draw); mirror the comped flag
-- (2, comped); drop the seed-reuse check (3a); drop the after-check on
-- assigned blocks and payments (3b); move only the holiday keys in
-- admin_set_format (2, config); skip the double_holdings audit row (2, audit);
-- grant either RPC to anon (section 4); refuse the exact fit, < to <= (1e);
-- leave requested_ref null on a drawn block (2, draw); wipe a placed block's
-- notes (2, notes); key the pairs map by source (2, audit).

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

create temp table fx (k text primary key, pid uuid) on commit drop;

-- 0. The draw. The same vector as tests/unit/block-draw.test.ts, so the SQL
--    and TypeScript copies cannot drift apart.
do $$
begin
  if block_draw_order('tnf-2026-blockdraw-test', array[1,2,3,4,5,6,7,8,9,10])
       is distinct from array[5,2,6,4,3,10,7,9,1,8] then
    raise exception '0a: block_draw_order drifted from the TypeScript vector: %',
      block_draw_order('tnf-2026-blockdraw-test', array[1,2,3,4,5,6,7,8,9,10]);
  end if;
  if (block_draw_order('tnf-2026-blockdraw-test', array(select generate_series(1, 100))))[1:5]
       is distinct from array[77,1,18,89,43] then
    raise exception '0b: the 100-number draw drifted from the TypeScript vector';
  end if;
  if block_draw_order('x', array[7]) is distinct from array[7]
     or block_draw_order('x', '{}'::int[]) is distinct from '{}'::int[] then
    raise exception '0c: one number and no numbers are their own draw';
  end if;
  if (select array_agg(x order by x) from unnest(block_draw_order('s', array(select generate_series(1, 100)))) x)
       is distinct from array(select generate_series(1, 100)) then
    raise exception '0d: a draw is not a permutation of the free numbers';
  end if;
  begin
    perform block_draw_order('naïve', array[1, 2]);
    raise exception '0e: a non-ASCII seed was accepted';
  exception when others then
    if sqlerrm not like 'a draw seed is printable ASCII%' then raise; end if;
  end;
end $$;

-- Fixtures. Every seed block is released and every seed participant set to
-- zero first, so the doubling sees only these.
--   A: one block, paid, assigned.
--   M: one block paid and assigned, a second reserved and unpaid (mixed).
--   R: one block, reserved, unpaid.
--   C: one comped block, assigned, nothing paid (block 3's shape). Its new
--      block is the fixed placement, reserved and named.
--   T: three blocks, paid for all three, assigned.
--   Z: no block and nothing requested (removed, the Dennis Bell shape).
do $$
declare
  r record;
  v_open int[];
  v_p uuid;
begin
  for r in select block_number from blocks where participant_id is not null order by 1 loop
    perform admin_release_block(r.block_number, 'fx');
  end loop;
  update participants set blocks_requested = 0;
  select array_agg(block_number order by block_number) into v_open from blocks where status = 'available';

  insert into participants (full_name, email, owner_group, blocks_requested)
  values ('FA', 'fa@tnf.test', 'RM', 1) returning id into v_p;
  insert into fx values ('A', v_p);
  perform admin_reserve_blocks(array[v_open[1]], v_p, 'admin', 'fx', 'fx');
  perform admin_record_payment(v_p, 50000, 'cash', '2026-09-04', null, 'fx', null, null, 'fx', 'RM');

  insert into participants (full_name, email, cc_email, owner_group, blocks_requested)
  values ('FM', 'fm@tnf.test', 'fm2@tnf.test', 'RM', 1) returning id into v_p;
  insert into fx values ('M', v_p);
  perform admin_reserve_blocks(array[v_open[2]], v_p, 'admin', 'fx', 'fx');
  perform admin_record_payment(v_p, 50000, 'cash', '2026-09-04', null, 'fx', null, null, 'fx', 'RM');
  -- the second block came later, as mike capelli's did: reserved, unpaid
  update participants set blocks_requested = 2 where id = v_p;
  perform admin_reserve_blocks(array[v_open[3]], v_p, 'admin', 'fx', 'fx');

  insert into participants (full_name, owner_group, blocks_requested)
  values ('FR', 'AVD', 1) returning id into v_p;
  insert into fx values ('R', v_p);
  perform admin_reserve_blocks(array[v_open[4]], v_p, 'admin', 'fx', 'fx');

  insert into participants (full_name, owner_group, blocks_requested)
  values ('FC', 'AVD', 1) returning id into v_p;
  insert into fx values ('C', v_p);
  perform admin_reserve_blocks(array[v_open[5]], v_p, 'requested', 'fx', 'fx');
  perform admin_set_comped(v_open[5], true, 'fx');
  perform admin_promote_if_paid(v_p, 'fx');

  insert into participants (full_name, owner_group, blocks_requested)
  values ('FT', 'MAP', 3) returning id into v_p;
  insert into fx values ('T', v_p);
  perform admin_reserve_blocks(array[v_open[6], v_open[7], v_open[8]], v_p, 'admin', 'fx', 'fx');
  perform admin_record_payment(v_p, 150000, 'cash', '2026-09-04', null, 'fx', null, null, 'fx', 'MAP');

  insert into participants (full_name, owner_group, blocks_requested)
  values ('FZ', 'AVD', 0) returning id into v_p;
  insert into fx values ('Z', v_p);
end $$;

do $$
declare
  v text;
begin
  select string_agg(k || ':' || a || '/' || r || '/' || c, ' ' order by k) into v
    from (select f.k,
                 count(*) filter (where b.status = 'assigned' and not b.comped) a,
                 count(*) filter (where b.status = 'reserved') r,
                 count(*) filter (where b.comped and b.status = 'assigned') c
            from fx f left join blocks b on b.participant_id = f.pid
           group by f.k) x;
  if v is distinct from 'A:1/0/0 C:0/0/1 M:1/1/0 R:0/1/0 T:3/0/0 Z:0/0/0' then
    raise exception 'fixture: holdings are %', v;
  end if;
  if (select count(*) from blocks where participant_id is not null) <> 8 then
    raise exception 'fixture: 8 held blocks expected';
  end if;
  if (select count(*) from games) is distinct from 10::bigint then
    raise exception 'fixture: 10 games expected';
  end if;
end $$;

create temp table due0 on commit drop as
  select participant_id, amount_due_cents, amount_paid_cents from v_participant_finance;

-- 1. Refusals before the switch, each changing nothing.
do $$
declare
  v_c int;
  v_pair int;
  v_a int;
begin
  select block_number into v_pair from blocks where participant_id = (select pid from fx where k = 'C');
  select block_number into v_a from blocks where participant_id = (select pid from fx where k = 'A');
  select min(block_number) into v_c from blocks where status = 'available';

  -- 1a. admin only.
  perform set_config('request.jwt.claims', '{"email":"someone@tnf.test"}', true);
  begin
    perform admin_set_format(25000, 75000, 150000, 'fx');
    raise exception '1a: a non-admin moved the price';
  exception when others then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
  begin
    perform admin_double_holdings('fx-seed-0', '[]'::jsonb, 'fx');
    raise exception '1a: a non-admin doubled the holdings';
  exception when others then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

  -- 1b. admin_set_format takes whole dollars, positive, with an actor.
  begin
    perform admin_set_format(0, 75000, 150000, 'fx');
    raise exception '1b: a zero price was accepted';
  exception when others then
    if sqlerrm not like 'every amount is a positive%' then raise; end if;
  end;
  begin
    perform admin_set_format(25050, 75000, 150000, 'fx');
    raise exception '1b: a price with cents was accepted';
  exception when others then
    if sqlerrm not like 'whole dollars only%' then raise; end if;
  end;
  begin
    perform admin_set_format(25000, 75000, 150000, ' ');
    raise exception '1b: a blank actor was accepted';
  exception when others then
    if sqlerrm <> 'an actor is required' then raise; end if;
  end;

  -- 1c. A participant whose request is not what he holds: no doubling.
  update participants set blocks_requested = 2 where id = (select pid from fx where k = 'A');
  begin
    perform admin_double_holdings('fx-seed-0', '[]'::jsonb, 'fx');
    raise exception '1c: doubled with a request that is not what is held';
  exception when others then
    if sqlerrm not like 'doubling needs every participant''s blocks_requested%' then raise; end if;
  end;
  update participants set blocks_requested = 1 where id = (select pid from fx where k = 'A');

  -- 1d. Fixed placements: an open block, a held pair, reserved or assigned, never random, never twice.
  begin
    perform admin_double_holdings('fx-seed-0', jsonb_build_array(jsonb_build_object('block', v_a, 'mirror_of', v_pair, 'status', 'reserved')), 'fx');
    raise exception '1d: a fixed placement on a held block';
  exception when others then
    if sqlerrm not like 'fixed block % is not open' then raise; end if;
  end;
  begin
    perform admin_double_holdings('fx-seed-0', jsonb_build_array(jsonb_build_object('block', v_c, 'mirror_of', v_c + 1, 'status', 'reserved')), 'fx');
    raise exception '1d: a fixed placement paired with an open block';
  exception when others then
    if sqlerrm not like 'fixed block % pairs with block %, which nobody holds' then raise; end if;
  end;
  begin
    perform admin_double_holdings('fx-seed-0', jsonb_build_array(jsonb_build_object('block', v_c, 'mirror_of', v_pair, 'status', 'held')), 'fx');
    raise exception '1d: a fixed placement with status held';
  exception when others then
    if sqlerrm not like 'fixed block % takes status reserved or assigned%' then raise; end if;
  end;
  begin
    perform admin_double_holdings('fx-seed-0', jsonb_build_array(jsonb_build_object('block', v_c, 'mirror_of', v_pair, 'status', 'reserved', 'method', 'random')), 'fx');
    raise exception '1d: a fixed placement with method random';
  exception when others then
    if sqlerrm not like 'fixed block % takes method requested or admin%' then raise; end if;
  end;
  begin
    perform admin_double_holdings('fx-seed-0', jsonb_build_array(
      jsonb_build_object('block', v_c, 'mirror_of', v_pair, 'status', 'reserved'),
      jsonb_build_object('block', v_c, 'mirror_of', v_a, 'status', 'reserved')), 'fx');
    raise exception '1d: a fixed block placed twice';
  exception when others then
    if sqlerrm not like 'fixed placements repeat%' then raise; end if;
  end;

  -- No check that a refusal left nothing behind: each ran in its own
  -- exception block, which Postgres rolls back when it catches the error, so
  -- such a check could never fail.
end $$;

-- 1e. The production shape: every open block used, 49 mirrored into 49 after
--     the fixed placement. Each attempt runs in a block that rolls back.
do $$
declare
  v_x uuid;
  v_open int[];
  v_fixed int;
  v_pair int;
  v jsonb;
begin
  select block_number into v_pair from blocks where participant_id = (select pid from fx where k = 'C');
  begin
    insert into participants (full_name, owner_group, blocks_requested) values ('FX', 'AVD', 42) returning id into v_x;
    select array_agg(block_number order by block_number) into v_open from blocks where status = 'available';
    perform admin_reserve_blocks(v_open[1:42], v_x, 'admin', 'fx', 'fx');
    if (select count(*) from blocks where participant_id is not null) <> 50
       or (select count(*) from blocks where status = 'available') <> 50 then
      raise exception '1e: the fixture is not 50 held and 50 open';
    end if;
    select min(block_number) into v_fixed from blocks where status = 'available';
    perform admin_set_format(25000, 75000, 150000, 'fx');
    v := admin_double_holdings('fx-seed-fit', jsonb_build_array(jsonb_build_object(
           'block', v_fixed, 'mirror_of', v_pair, 'status', 'reserved')), 'fx');
    if (v ->> 'blocks_added')::int is distinct from 50
       or (select count(*) from blocks where status = 'available') <> 0
       or (select count(*) from blocks where participant_id is not null) <> 100 then
      raise exception '1e: the exact fit did not fill the grid';
    end if;
    raise exception '1e: rollback';
  exception when others then
    if sqlerrm <> '1e: rollback' then raise; end if;
  end;
  -- One held block more than fits: 51 held, 49 open, the fixed placement takes
  -- one, so 50 to mirror and 48 open. Refused before anything moves.
  begin
    insert into participants (full_name, owner_group, blocks_requested) values ('FX', 'AVD', 43) returning id into v_x;
    select array_agg(block_number order by block_number) into v_open from blocks where status = 'available';
    perform admin_reserve_blocks(v_open[1:43], v_x, 'admin', 'fx', 'fx');
    select min(block_number) into v_fixed from blocks where status = 'available';
    perform admin_double_holdings('fx-seed-fit', jsonb_build_array(jsonb_build_object(
              'block', v_fixed, 'mirror_of', v_pair, 'status', 'reserved')), 'fx');
    raise exception '1e: doubled with more blocks to mirror than open ones';
  exception when others then
    if sqlerrm is distinct from '50 blocks to mirror and 48 open after the fixed placements' then raise; end if;
  end;
end $$;

-- Every open block carries a note before the switch, so a placement that
-- wipes a block's history cannot pass for one that kept it.
update blocks set notes = coalesce(notes, 'fx history ' || block_number) where status = 'available';
create temp table notes0 on commit drop as select block_number, notes from blocks;

-- 2. The switch: the price and the tier, then the doubling, one transaction.
create temp table drawn (i int, src int, dst int) on commit drop;

do $$
declare
  v_fixed int;
  v_pair int;
  v_free int[];
  v_src int[];
  v_order int[];
  v jsonb;
  v_bad text;
  v_audit audit_log;
begin
  select block_number into v_pair from blocks where participant_id = (select pid from fx where k = 'C');
  select min(block_number) into v_fixed from blocks where status = 'available';
  v_free := array(select block_number from blocks where status = 'available' and block_number <> v_fixed order by 1);
  v_src := array(select block_number from blocks where participant_id is not null and block_number <> v_pair order by 1);
  v_order := block_draw_order('fx-seed-1', v_free);
  insert into drawn select i, v_src[i], v_order[i] from generate_subscripts(v_src, 1) i;

  perform admin_set_format(25000, 75000, 150000, 'fx');
  v := admin_double_holdings('fx-seed-1', jsonb_build_array(jsonb_build_object(
         'block', v_fixed, 'mirror_of', v_pair, 'status', 'reserved',
         'display_name', 'Philadelphia Poultry', 'method', 'requested', 'ref', 'fx: for his father')), 'fx');
  if (v ->> 'blocks_added')::int is distinct from 8 then
    raise exception '2: 8 blocks added expected, got %', v ->> 'blocks_added';
  end if;

  -- config: the four tier keys carry the same pair; nothing else moved.
  if (select (price_per_block_cents, regular_halftime_cents, holiday_halftime_cents, regular_final_cents,
              holiday_final_cents, blocks_total, claim_deadline)
        from config) is distinct from (25000, 75000, 75000, 150000, 150000, 100, date '2026-11-24') then
    raise exception '2, config: %', (select to_jsonb(c) from config c);
  end if;
  -- 10 games x (750 + 1,500) = 22,500, 90 percent of 100 x 250, as 45,000 was of 50,000.
  if (select sum(c.holiday_halftime_cents + c.holiday_final_cents) from games g cross join config c)
       is distinct from 2250000::bigint
     or (select 100 * sum(c.holiday_halftime_cents + c.holiday_final_cents) / (c.blocks_total * c.price_per_block_cents)
           from games g cross join config c group by c.blocks_total, c.price_per_block_cents) is distinct from 90::bigint then
    raise exception '2, payouts: the season does not pay 22,500, 90 percent of 25,000';
  end if;

  -- money: what everyone owes and has paid is unchanged, except C, one block (250) more.
  select string_agg(f.k || ' ' || d.amount_due_cents || '->' || n.amount_due_cents, ', ') into v_bad
    from fx f
    join due0 d on d.participant_id = f.pid
    join v_participant_finance n on n.participant_id = f.pid
   where n.amount_due_cents is distinct from d.amount_due_cents + case when f.k = 'C' then 25000 else 0 end
      or n.amount_paid_cents is distinct from d.amount_paid_cents;
  if v_bad is not null then
    raise exception '2, money: owed or paid moved: %', v_bad;
  end if;

  -- holdings: assigned stays assigned, reserved stays reserved; C's new block reserved.
  select string_agg(k || ':' || a || '/' || r || '/' || c, ' ' order by k) into v_bad
    from (select f.k,
                 count(*) filter (where b.status = 'assigned' and not b.comped) a,
                 count(*) filter (where b.status = 'reserved') r,
                 count(*) filter (where b.comped and b.status = 'assigned') c
            from fx f left join blocks b on b.participant_id = f.pid
           group by f.k) x;
  if v_bad is distinct from 'A:2/0/0 C:0/1/1 M:2/2/0 R:0/2/0 T:6/0/0 Z:0/0/0' then
    raise exception '2, holdings: %', v_bad;
  end if;

  -- requested: doubled for every holder, untouched for Z.
  select string_agg(f.k || ':' || p.blocks_requested, ' ' order by f.k) into v_bad
    from fx f join participants p on p.id = f.pid;
  if v_bad is distinct from 'A:2 C:2 M:4 R:2 T:6 Z:0' then
    raise exception '2, requested: %', v_bad;
  end if;

  -- the fixed placement: C's, reserved, named, not comped, requested.
  if not exists (select 1 from blocks
                  where block_number = v_fixed and participant_id = (select pid from fx where k = 'C')
                    and status = 'reserved' and not comped and display_name = 'Philadelphia Poultry'
                    and assignment_method = 'requested' and requested_ref = 'fx: for his father'
                    and assigned_at is null) then
    raise exception '2, fixed: block % is not the reserved, named placement', v_fixed;
  end if;

  -- the draw: the i-th source, in block order, took the i-th number of the shuffle.
  select string_agg(d.src || '->' || d.dst, ', ') into v_bad
    from drawn d
    join blocks s on s.block_number = d.src
    join blocks n on n.block_number = d.dst
   where n.participant_id is distinct from s.participant_id
      or n.status is distinct from s.status
      or n.assignment_method is distinct from 'random'
      or n.comped
      or n.display_name is not null
      or n.requested_ref is null
      or n.requested_ref not like 'seed fx-seed-1 - drawn from the % open, pairs with block ' || d.src
      or (n.status = 'assigned') is distinct from (n.assigned_at is not null);
  if v_bad is not null or (select count(*) from drawn) <> 7 then
    raise exception '2, draw: these pairs are not the seeded draw: %', coalesce(v_bad, 'wrong count');
  end if;
  if (select count(*) from blocks where participant_id is not null) <> 16
     or exists (select 1 from unnest(v_order[8:]) x join blocks b on b.block_number = x where b.status <> 'available') then
    raise exception '2, draw: a number past the 7th of the shuffle was placed';
  end if;

  -- comped: still only C's original block.
  if array(select block_number from blocks where comped) is distinct from array[v_pair] then
    raise exception '2, comped: %', array(select block_number from blocks where comped);
  end if;

  -- audit: one set_format, one double_holdings, one doubling row per holder (not Z).
  if (select count(*) from audit_log where action = 'set_format') <> 1
     or (select (before ->> 'price_per_block_cents', after ->> 'price_per_block_cents',
                 after ->> 'regular_final_cents', after ->> 'holiday_halftime_cents')
           from audit_log where action = 'set_format')
        is distinct from ('50000'::text, '25000'::text, '150000'::text, '75000'::text) then
    raise exception '2, audit: the set_format row';
  end if;
  select * into v_audit from audit_log where action = 'double_holdings';
  if v_audit.id is null
     or (select count(*) from audit_log where action = 'double_holdings') <> 1
     or v_audit.after ->> 'seed' is distinct from 'fx-seed-1'
     or v_audit.after -> 'free' is distinct from to_jsonb(v_free)
     or v_audit.after -> 'order' is distinct from to_jsonb(v_order)
     or v_audit.target_id is distinct from
          (select string_agg(x::text, ',' order by x) from (select dst x from drawn union select v_fixed) y)
     or v_audit.after -> 'pairs' is distinct from
          ((select jsonb_object_agg(dst::text, src) from drawn) || jsonb_build_object(v_fixed::text, v_pair))
     or v -> 'pairs' is distinct from v_audit.after -> 'pairs' then
    raise exception '2, audit: the double_holdings row';
  end if;

  -- notes: every block's history is as it was, placed or not.
  select string_agg(b.block_number::text, ', ') into v_bad
    from blocks b join notes0 o on o.block_number = b.block_number
   where b.notes is distinct from o.notes;
  if v_bad is not null or (select count(*) from notes0) <> 100 then
    raise exception '2, notes: changed on blocks %', coalesce(v_bad, 'unknown');
  end if;
  if (select string_agg(f.k || ':' || (a.before ->> 'blocks_requested') || '->' || (a.after ->> 'blocks_requested'), ' ' order by f.k)
        from audit_log a join fx f on f.pid::text = a.target_id
       where a.action = 'double_blocks_requested')
     is distinct from 'A:1->2 C:1->2 M:2->4 R:1->2 T:3->6' then
    raise exception '2, audit: the per-participant rows';
  end if;
end $$;

-- 3. Refusals after the switch.
do $$
declare
  v_b int;
begin
  -- 3a. A seed is never used twice.
  begin
    perform admin_double_holdings('fx-seed-1', '[]'::jsonb, 'fx');
    raise exception '3a: a seed was reused';
  exception when others then
    if sqlerrm not like 'seed fx-seed-1 was already used%' then raise; end if;
  end;

  -- 3b. A second doubling under a fresh seed: every assigned block would
  --     outrun its payments, so it refuses, naming each holder in order. FR is
  --     named too, for the block the fixture marks assigned with nothing paid.
  select block_number into v_b from blocks where participant_id = (select pid from fx where k = 'R') order by 1 limit 1;
  update blocks set status = 'assigned' where block_number = v_b;
  begin
    perform admin_double_holdings('fx-seed-2', '[]'::jsonb, 'fx');
    raise exception '3b: doubled over assigned blocks nothing pays for';
  exception when others then
    if sqlerrm is distinct from 'after doubling, assigned blocks outrun the payments for FA, FC, FM, FR, FT' then raise; end if;
  end;
  update blocks set status = 'reserved' where block_number = v_b;
end $$;

-- 4. The format_change broadcast derives the holder set, as game_day does.
do $$
begin
  if array(select recipient from admin_email_recipients('format_change_2026-11-10'))
       is distinct from array(select recipient from admin_email_recipients('game_day_g01'))
     or array(select recipient from admin_email_recipients('format_change_2026-11-10'))
       is distinct from array['fa@tnf.test', 'fm2@tnf.test', 'fm@tnf.test'] then
    raise exception '4a: format_change recipients are %', array(select recipient from admin_email_recipients('format_change_2026-11-10'));
  end if;
  begin
    perform admin_email_recipients('format_change_soon');
    raise exception '4b: an undated format_change key derived recipients';
  exception when others then
    if sqlerrm not like 'no recipient rule for event%' then raise; end if;
  end;
  if has_function_privilege('anon', 'admin_set_format(int,int,int,text)', 'execute')
     or has_function_privilege('anon', 'admin_double_holdings(text,jsonb,text)', 'execute') then
    raise exception '4c: anon can execute a format RPC';
  end if;
end $$;

rollback;
