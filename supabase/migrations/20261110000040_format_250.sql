-- Migration 40: the 250 format (Anthony, 2026-11-10, Part J step 2).
--
-- The pool goes from 500 a block to 250, every holder's block count doubles
-- for the same money, and every game pays 750 at halftime and 1,500 at the
-- final. This migration changes no data. It ships the code, and the switch is
-- three audited admin calls made together in one transaction:
--
--   admin_set_format(25000, 75000, 150000, actor)
--       the price and the one payout tier, one set_format audit row
--   admin_double_holdings(seed, fixed, actor)
--       one new block per held block, same holder, same status as the block
--       it mirrors; blocks_requested doubled; one double_holdings audit row
--       for the blocks and one per participant
--
-- and the format_change broadcast's recipient rule. Nothing here is a date or
-- a dollar figure: the numbers are the caller's, and the database checks them.

-- ---------------------------------------------------------------------------
-- The random draw, as docs/BLOCK_ASSIGNMENT_POLICY.md rule 2 describes it: the
-- seed string hashed with FNV-1a (32 bit) into a mulberry32 PRNG driving a
-- Fisher-Yates shuffle of the free numbers. src/lib/block-draw.ts is the same
-- function in TypeScript, and both suites assert the same vector, so anyone
-- can replay a draw from the seed and the free list in its audit row. The
-- earlier draws ran from a script that was never committed; this is the first
-- committed copy. Seeds are printable ASCII, so a character is one byte and one
-- UTF-16 unit and the two implementations cannot read a seed differently.
-- ---------------------------------------------------------------------------

-- Math.imul on two unsigned 32-bit values, without overflowing bigint.
create or replace function block_draw_imul(a bigint, b bigint) returns bigint
language sql immutable strict parallel safe
set search_path = public, pg_temp
as $$
  select ((a * (b & 65535)) + (((a * (b >> 16)) & 65535) << 16)) & 4294967295
$$;

-- p_free shuffled. The i-th block placed takes the i-th number.
create or replace function block_draw_order(p_seed text, p_free int[]) returns int[]
language plpgsql immutable strict
set search_path = public, pg_temp
as $$
declare
  h bigint := 2166136261;          -- FNV-1a offset basis
  a bigint;
  t bigint;
  v int[] := p_free;
  n int := coalesce(cardinality(p_free), 0);
  i int;
  j int;
  tmp int;
begin
  if p_seed !~ '^[ -~]{1,200}$' then
    raise exception 'a draw seed is printable ASCII, 1 to 200 characters';
  end if;
  for i in 1 .. length(p_seed) loop
    h := block_draw_imul(h # ascii(substr(p_seed, i, 1)), 16777619);   -- FNV prime
  end loop;
  a := h;
  -- for (i = n - 1; i > 0; i--) { j = floor(rand() * (i + 1)); swap(i, j) }, zero-based
  for i in reverse n - 1 .. 1 loop
    a := (a + 1831565813) & 4294967295;                                 -- 0x6D2B79F5
    t := block_draw_imul(a # (a >> 15), 1 | a);
    t := ((t + block_draw_imul(t # (t >> 7), 61 | t)) & 4294967295) # t;
    t := t # (t >> 14);
    j := ((t * (i + 1)) >> 32)::int;                                   -- floor(t / 2^32 * (i + 1)), exact
    tmp := v[i + 1];
    v[i + 1] := v[j + 1];
    v[j + 1] := tmp;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- The price and the one payout tier. All four tier keys carry the same two
-- numbers, as migration 24 left them; blocks_total, claim_deadline and
-- season_mode are not parameters. One audit row, old and new values.
--
-- On its own this halves what every holder owes. It is meant to run in the
-- same transaction as admin_double_holdings, and the caller checks that every
-- participant's owed total came out where it started.
-- ---------------------------------------------------------------------------
create or replace function admin_set_format(
  p_price_cents int,
  p_halftime_cents int,
  p_final_cents int,
  p_actor text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform assert_admin();
  if p_price_cents is null or p_halftime_cents is null or p_final_cents is null then
    raise exception 'the price, the halftime payout and the final payout are all required';
  end if;
  if p_price_cents <= 0 or p_halftime_cents <= 0 or p_final_cents <= 0 then
    raise exception 'every amount is a positive number of cents';
  end if;
  if p_price_cents % 100 <> 0 or p_halftime_cents % 100 <> 0 or p_final_cents % 100 <> 0 then
    raise exception 'whole dollars only: every amount is cents and a multiple of 100';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'an actor is required';
  end if;

  select jsonb_build_object('price_per_block_cents', c.price_per_block_cents,
                            'regular_halftime_cents', c.regular_halftime_cents,
                            'holiday_halftime_cents', c.holiday_halftime_cents,
                            'regular_final_cents', c.regular_final_cents,
                            'holiday_final_cents', c.holiday_final_cents)
    into v_before
    from config c where c.id = 1 for update;

  update config
     set price_per_block_cents  = p_price_cents,
         regular_halftime_cents = p_halftime_cents,
         holiday_halftime_cents = p_halftime_cents,
         regular_final_cents    = p_final_cents,
         holiday_final_cents    = p_final_cents
   where id = 1;

  select jsonb_build_object('price_per_block_cents', c.price_per_block_cents,
                            'regular_halftime_cents', c.regular_halftime_cents,
                            'holiday_halftime_cents', c.holiday_halftime_cents,
                            'regular_final_cents', c.regular_final_cents,
                            'holiday_final_cents', c.holiday_final_cents)
    into v_after
    from config c where c.id = 1;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'set_format', 'config', '1', v_before, v_after,
          'price and the one payout tier; blocks_total, claim_deadline and season_mode untouched');
  return v_after;
end $$;

-- ---------------------------------------------------------------------------
-- Double every holder. Each held block gets one new block: same participant,
-- same status (assigned stays assigned, reserved stays reserved), never
-- comped, no block name, method random, its number drawn from the open blocks
-- with block_draw_order. Sources are placed in block-number order, so the i-th
-- held block takes the i-th number of the shuffle.
--
-- p_fixed is a jsonb array of placements that take a named number instead of a
-- drawn one: {block, mirror_of, status, display_name, method, ref}. block is an
-- open number, mirror_of the held block it pairs with (its holder gets it),
-- status reserved or assigned, method requested or admin. A fixed block is
-- never drawn and its pair is never mirrored again.
--
-- Refuses, changing nothing, unless every participant's blocks_requested
-- equals the blocks he holds (a doubling of anything else is a guess), there
-- are enough open blocks, and the seed has never been used. Afterwards every
-- participant holds exactly blocks_requested, the comped set is unchanged, and
-- no participant holds more assigned, non-comped blocks than his payment rows
-- pay for at the current price: the rule migration 39 enforces on a
-- correction, checked here so the doubling cannot leave a block assigned on
-- money that does not cover it.
-- ---------------------------------------------------------------------------
create or replace function admin_double_holdings(
  p_seed text,
  p_fixed jsonb,
  p_actor text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fixed jsonb := coalesce(p_fixed, '[]'::jsonb);
  v_price int;
  v_comped_before int[];
  v_src int[];
  v_free int[];
  v_order int[];
  v_fixed_blocks int[];
  v_fixed_pairs int[];
  v_new int[] := '{}';
  v_pairs jsonb := '{}'::jsonb;
  v_bad text;
  f record;
  s record;
  i int;
  r record;
begin
  perform assert_admin();
  if p_seed is null or p_seed !~ '^[ -~]{1,200}$' then
    raise exception 'a draw seed is printable ASCII, 1 to 200 characters';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'an actor is required';
  end if;
  if jsonb_typeof(v_fixed) <> 'array' then
    raise exception 'p_fixed is a jsonb array of placements';
  end if;
  if exists (select 1 from audit_log a where a.action = 'double_holdings' and a.after ->> 'seed' = p_seed) then
    raise exception 'seed % was already used; a seed is never reused', p_seed;
  end if;

  -- Every block, locked in one order, before anything is read.
  perform 1 from blocks order by block_number for update;
  select price_per_block_cents into v_price from config where id = 1;
  v_comped_before := array(select block_number from blocks where comped order by block_number);

  select string_agg(coalesce(p.display_alias, p.full_name) || ' ' || p.blocks_requested || '/' || h.n, ', '
                    order by coalesce(p.display_alias, p.full_name))
    into v_bad
    from participants p
    cross join lateral (select count(*)::int as n from blocks b where b.participant_id = p.id) h
   where p.blocks_requested <> h.n;
  if v_bad is not null then
    raise exception 'doubling needs every participant''s blocks_requested to equal the blocks he holds (requested/held): %', v_bad;
  end if;

  -- The fixed placements, each checked before anything moves.
  for f in select * from jsonb_to_recordset(v_fixed)
                 as x(block int, mirror_of int, status text, display_name text, method text, ref text) loop
    if f.block is null or f.mirror_of is null then
      raise exception 'a fixed placement names block and mirror_of';
    end if;
    if f.block = any(coalesce(v_fixed_blocks, '{}')) or f.mirror_of = any(coalesce(v_fixed_pairs, '{}')) then
      raise exception 'fixed placements repeat block % or pair %', f.block, f.mirror_of;
    end if;
    if not exists (select 1 from blocks where block_number = f.block and status = 'available') then
      raise exception 'fixed block % is not open', f.block;
    end if;
    if not exists (select 1 from blocks where block_number = f.mirror_of and participant_id is not null) then
      raise exception 'fixed block % pairs with block %, which nobody holds', f.block, f.mirror_of;
    end if;
    if coalesce(f.status, '') not in ('reserved', 'assigned') then
      raise exception 'fixed block % takes status reserved or assigned, not %', f.block, coalesce(f.status, 'null');
    end if;
    if coalesce(f.method, 'requested') not in ('requested', 'admin') then
      raise exception 'fixed block % takes method requested or admin; random is the draw', f.block;
    end if;
    v_fixed_blocks := array_append(coalesce(v_fixed_blocks, '{}'), f.block);
    v_fixed_pairs := array_append(coalesce(v_fixed_pairs, '{}'), f.mirror_of);
  end loop;
  v_fixed_blocks := coalesce(v_fixed_blocks, '{}');
  v_fixed_pairs := coalesce(v_fixed_pairs, '{}');

  v_src := array(select block_number from blocks
                  where participant_id is not null and block_number <> all(v_fixed_pairs)
                  order by block_number);
  v_free := array(select block_number from blocks
                   where status = 'available' and block_number <> all(v_fixed_blocks)
                   order by block_number);
  if cardinality(v_src) = 0 and cardinality(v_fixed_pairs) = 0 then
    raise exception 'nobody holds a block; nothing to double';
  end if;
  if cardinality(v_free) < cardinality(v_src) then
    raise exception '% blocks to mirror and % open after the fixed placements', cardinality(v_src), cardinality(v_free);
  end if;
  v_order := block_draw_order(p_seed, v_free);

  -- The fixed placements.
  for f in select * from jsonb_to_recordset(v_fixed)
                 as x(block int, mirror_of int, status text, display_name text, method text, ref text) loop
    update blocks n
       set participant_id = o.participant_id,
           status = f.status,
           assignment_method = coalesce(f.method, 'requested'),
           requested_ref = nullif(btrim(coalesce(f.ref, '')), ''),
           assigned_at = case when f.status = 'assigned' then now() end,
           comped = false,
           display_name = nullif(btrim(coalesce(f.display_name, '')), '')
      from blocks o
     where n.block_number = f.block and o.block_number = f.mirror_of;
    v_new := array_append(v_new, f.block);
    v_pairs := v_pairs || jsonb_build_object(f.block::text, f.mirror_of);
  end loop;

  -- The draw: the i-th held block takes the i-th number of the shuffle.
  for i in 1 .. coalesce(cardinality(v_src), 0) loop
    select * into s from blocks where block_number = v_src[i];
    update blocks
       set participant_id = s.participant_id,
           status = s.status,
           assignment_method = 'random',
           requested_ref = format('seed %s - drawn from the %s open, pairs with block %s',
                                  p_seed, cardinality(v_free), s.block_number),
           assigned_at = case when s.status = 'assigned' then now() end,
           comped = false,
           display_name = null
     where block_number = v_order[i];
    v_new := array_append(v_new, v_order[i]);
    v_pairs := v_pairs || jsonb_build_object(v_order[i]::text, s.block_number);
  end loop;

  -- Every holder's count doubles, one audit row each.
  for r in select p.id, p.blocks_requested from participants p
            where exists (select 1 from blocks b where b.participant_id = p.id)
            order by p.id loop
    update participants set blocks_requested = r.blocks_requested * 2 where id = r.id;
    insert into audit_log (actor, action, target_table, target_id, before, after, note)
    values (p_actor, 'double_blocks_requested', 'participants', r.id::text,
            jsonb_build_object('blocks_requested', r.blocks_requested),
            jsonb_build_object('blocks_requested', r.blocks_requested * 2),
            format('seed %s', p_seed));
  end loop;

  -- After: the books balance, or nothing happened.
  select string_agg(coalesce(p.display_alias, p.full_name), ', ' order by coalesce(p.display_alias, p.full_name)) into v_bad
    from participants p
   where p.blocks_requested <> (select count(*) from blocks b where b.participant_id = p.id);
  if v_bad is not null then
    raise exception 'after doubling, blocks_requested and held disagree for %', v_bad;
  end if;
  if array(select block_number from blocks where comped order by block_number) <> v_comped_before then
    raise exception 'the comped blocks changed';
  end if;
  select string_agg(coalesce(p.display_alias, p.full_name), ', ' order by coalesce(p.display_alias, p.full_name)) into v_bad
    from participants p
   where (select count(*) from blocks b where b.participant_id = p.id and b.status = 'assigned' and not b.comped) * v_price
         > (select coalesce(sum(y.amount_cents), 0) from payments y where y.participant_id = p.id);
  if v_bad is not null then
    raise exception 'after doubling, assigned blocks outrun the payments for %', v_bad;
  end if;

  v_new := array(select x from unnest(v_new) x order by x);
  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'double_holdings', 'blocks', array_to_string(v_new, ','),
          jsonb_build_object('seed', p_seed,
                             'free', to_jsonb(v_free),
                             'order', to_jsonb(v_order),
                             'pairs', v_pairs,
                             'fixed', v_fixed,
                             'price_per_block_cents', v_price,
                             'blocks_added', cardinality(v_new)),
          'one new block per held block, same holder and status; draw per docs/BLOCK_ASSIGNMENT_POLICY.md rule 2');

  return jsonb_build_object('seed', p_seed, 'blocks_added', cardinality(v_new), 'blocks', to_jsonb(v_new), 'pairs', v_pairs);
end $$;

do $$
begin
  execute 'revoke execute on function block_draw_imul(bigint,bigint) from public, anon';
  execute 'revoke execute on function block_draw_order(text,int[]) from public, anon';
  execute 'grant execute on function block_draw_imul(bigint,bigint) to authenticated';
  execute 'grant execute on function block_draw_order(text,int[]) to authenticated';
  execute 'revoke execute on function admin_set_format(int,int,int,text) from public, anon';
  execute 'grant execute on function admin_set_format(int,int,int,text) to authenticated';
  execute 'revoke execute on function admin_double_holdings(text,jsonb,text) from public, anon';
  execute 'grant execute on function admin_double_holdings(text,jsonb,text) to authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- The format_change broadcast (format_change_YYYY-MM-DD): To every owner, Bcc
-- every holder address, the game-day set. Migration 37's function with that
-- one key added to the holder rule; nothing else in it changes.
-- ---------------------------------------------------------------------------
create or replace function admin_email_recipients(p_event_key text)
returns table (recipient text)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();

  if p_event_key ~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' then
    -- The recruit broadcast (migration 37): every owner with an address, and
    -- the plan's Bcc. Before the per-recipient recruit rule, which its key
    -- would otherwise match.
    return query
      select lower(btrim(o.email)) from owners o where nullif(btrim(o.email), '') is not null
      union
      select a.address from email_recruit_broadcast_addresses() a
       where not a.on_to and a.excluded is null
      order by 1;

  elsif p_event_key like 'holder\_checkin\_%' or p_event_key like 'game\_day\_%'
     or p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$' then
    return query
      select distinct h.recipient
        from email_holder_addresses() h
       where h.recipient not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'recruit\_%' then
    -- Prospects not already holding, not excluded, and not an owner: an owner
    -- is never a prospect (Anthony, 2026-10-08), so every owner address is
    -- out, primary and alt, Anthony's included.
    return query
      select p.email
        from prospects p
       where p.excluded_at is null
         and p.email not in (select h.recipient from email_holder_addresses() h)
         and p.email not in (select email_owner_addresses())
         and p.email not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'reply\_%' then
    return query
      select distinct a.addr
        from participants p,
             unnest(array[lower(btrim(p.email)), lower(btrim(p.cc_email))]) as a(addr)
       where nullif(a.addr, '') is not null
         and a.addr not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    -- A reply to one inbound message goes to an address the pool knows: a
    -- participant, a prospect or an owner. The command checks it is the
    -- address that wrote the message.
    return query
      select a.a from email_pool_addresses() a(a) order by 1;

  else
    raise exception 'no recipient rule for event %', p_event_key;
  end if;
end $$;
