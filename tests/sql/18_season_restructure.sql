-- The 2026-09-08 season restructure (migration 24): 10 holiday games, one
-- payout tier, $45,000 fixed, claim deadline 2026-11-24, and the block
-- invariant through a release. Money assertions carry NULL guards so losing
-- admin visibility fails loudly instead of passing vacuously.
begin;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

do $$
declare
  v_total bigint;
  c config%rowtype;
  n int;
begin
  -- The slate.
  if (select count(*) from games) <> 10 then
    raise exception 'expected 10 games, found %', (select count(*) from games);
  end if;
  if exists (select 1 from games where game_type <> 'holiday' or status <> 'scheduled' or not date_confirmed) then
    raise exception 'every game must be holiday, scheduled, date_confirmed';
  end if;
  if exists (select 1 from games where row_digits is not null or col_digits is not null
                                or digits_assigned_at is not null or digits_published_at is not null) then
    raise exception 'no game may carry digits before its draw';
  end if;
  if (select array_agg(distinct week order by week) from games) <> array[12, 16, 17] then
    raise exception 'weeks must be 12, 16, 17';
  end if;
  if (select kickoff_at from games where game_no = 1) <> timestamptz '2026-11-26T01:00:00Z'
     or (select kickoff_at from games where game_no = 10) <> timestamptz '2027-01-01T01:15:00Z' then
    raise exception 'G01 or G10 kickoff wrong';
  end if;
  if (select (kickoff_at at time zone 'America/New_York')::date from games where game_no = 1) <> date '2026-11-25' then
    raise exception 'G01 is Wednesday November 25 in ET';
  end if;
  if (select count(*) from games where game_no > 10) <> 0 then
    raise exception 'no game past G10';
  end if;

  -- The config.
  select * into c from config where id = 1;
  if c.regular_halftime_cents <> 150000 or c.holiday_halftime_cents <> 150000
     or c.regular_final_cents <> 300000 or c.holiday_final_cents <> 300000 then
    raise exception 'one tier: halftime 150000, final 300000 on every key, got %', to_jsonb(c);
  end if;
  if c.claim_deadline <> date '2026-11-24' or c.price_per_block_cents <> 50000 or c.blocks_total <> 100 then
    raise exception 'claim_deadline, price or blocks_total wrong: %', to_jsonb(c);
  end if;

  -- Payout total across the games table, from the tier each game reads.
  select sum(case when g.game_type = 'holiday'
                  then cc.holiday_halftime_cents + cc.holiday_final_cents
                  else cc.regular_halftime_cents + cc.regular_final_cents end)
    into v_total
    from games g cross join config cc;
  if v_total is null then
    raise exception 'payout total is NULL; the assertion below would be vacuous';
  end if;
  if v_total <> 4500000 then
    raise exception 'payout total is % cents, not 4500000', v_total;
  end if;

  -- The archive shape: one row per game that existed before the migration,
  -- and the migration's own row says how many that was.
  select count(*) into n from audit_log where action = 'season_restructure_archive';
  if n <> (select (after ->> 'archived')::int from audit_log where action = 'season_restructure' order by id desc limit 1) then
    raise exception 'archive rows % do not match the migration row', n;
  end if;
end $$;

-- Money: real numbers, never a placeholder. Collected equals the ledger sum,
-- due is committed minus comped at the block price.
do $$
declare
  pot v_pot;
  ledger bigint;
  v_comped int;
begin
  select * into pot from v_pot;
  if pot.collected_cents is null or pot.due_cents is null then
    raise exception 'v_pot money is NULL: this suite is not running as admin, '
      'so every money assertion here is vacuous';
  end if;
  select coalesce(sum(amount_cents), 0) into ledger from payments;
  if ledger <> pot.collected_cents then
    raise exception 'collected % is not the ledger sum %', pot.collected_cents, ledger;
  end if;
  select count(*) into v_comped from blocks where comped and status in ('reserved', 'assigned');
  if pot.due_cents <> (pot.committed_blocks - v_comped) * (select price_per_block_cents from config) then
    raise exception 'due % is not (committed % - comped %) x price', pot.due_cents, pot.committed_blocks, v_comped;
  end if;
end $$;

-- The block invariant holds through a release, the shape of the 2026-09-08
-- removals: available + reserved + assigned + held stays 100.
do $$
declare
  pot v_pot;
  before_avail int;
begin
  select * into pot from v_pot;
  if pot.available + pot.reserved + pot.assigned + pot.held <> 100 then
    raise exception 'block invariant broken before release: %', to_json(pot);
  end if;
  before_avail := pot.available;
  perform admin_release_block(99, 'test');
  select * into pot from v_pot;
  if pot.available + pot.reserved + pot.assigned + pot.held <> 100 then
    raise exception 'block invariant broken after release: %', to_json(pot);
  end if;
  if pot.available <> before_avail + 1 then
    raise exception 'release did not open exactly one block';
  end if;
  if (select participant_id from blocks where block_number = 99) is not null
     or (select notes from blocks where block_number = 99) not like 'Released from %' then
    raise exception 'release must clear the holder and keep the prior holder in notes';
  end if;
end $$;

-- The public projection, read without admin claims.
select set_config('request.jwt.claims', '{}', true);
do $$
declare n int;
begin
  select count(*) into n from v_public_games;
  if n <> 10 then raise exception 'v_public_games should serve 10 rows'; end if;
  select count(*) into n from v_public_games where row_digits is not null or col_digits is not null;
  if n <> 0 then raise exception 'v_public_games digits should be null before any draw'; end if;
  if (select collected_cents from v_pot) is not null then
    raise exception 'v_pot money must be null without admin claims';
  end if;
end $$;

rollback;
