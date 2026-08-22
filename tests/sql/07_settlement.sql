-- Payout settlement (spec section 3): rows start owed, only the admin marks
-- paid, the app never moves money. Plus the remaining locked-rule checks.
begin;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

do $$
declare
  g2 uuid;
  g games;
  v_res jsonb;
  v_payout uuid;
begin
  -- Stage: publish digits on G02 and score a final that hits block 15
  -- (Nicco Esgro, assigned).
  select id into g2 from games where game_no = 2;
  update games set date_confirmed = true, kickoff_at = now() + interval '7 days' where id = g2;
  perform admin_assign_digits(g2, 'test');
  perform admin_publish_digits(g2, 'test');
  select * into g from games where id = g2;
  v_res := admin_score_game(g2, 'final', g.col_digits[5], g.row_digits[2], 'test');
  select id into v_payout from payouts where game_id = g2 and payout_type = 'final';

  -- A payout starts owed.
  if (select status from payouts where id = v_payout) <> 'owed' then
    raise exception 'payout did not start owed';
  end if;

  -- Settle: owed → paid with date and method.
  perform admin_settle_payout(v_payout, current_date, 'venmo', 'test');
  if not exists (select 1 from payouts where id = v_payout and status = 'paid'
                   and paid_on = current_date and method = 'venmo') then
    raise exception 'settle did not record paid state';
  end if;

  -- A paid payout cannot be settled again.
  begin
    perform admin_settle_payout(v_payout, current_date, 'cash', 'test');
    raise exception 'double settlement was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%only an owed payout%' then raise; end if;
  end;

  -- A paid final cannot be re-scored.
  begin
    perform admin_score_game(g2, 'final', 1, 2, 'test');
    raise exception 're-score after settlement was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%already settled%' then raise; end if;
  end;

  -- Reopen puts it back to owed.
  perform admin_reopen_payout(v_payout, 'test reopen', 'test');
  if (select status from payouts where id = v_payout) <> 'owed' then
    raise exception 'reopen failed';
  end if;
end $$;

-- A non-admin can never settle.
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
declare
  v_payout uuid;
begin
  select id into v_payout from payouts limit 1;
  begin
    perform admin_settle_payout(v_payout, current_date, 'venmo', 'x');
    raise exception 'non-admin settled a payout';
  exception
    when raise_exception then
      if sqlerrm not like '%not authorized%' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- Owner groups: no other values (spec section 3).
do $$
begin
  begin
    insert into participants (full_name, owner_group) values ('Bad Group Test', 'XYZ');
    raise exception 'invalid owner_group was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- Locked config values: price, block count, claim deadline.
do $$
declare
  c config;
begin
  select * into c from config;
  if c.price_per_block_cents <> 50000 or c.blocks_total <> 100
     or c.claim_deadline <> date '2026-09-04' or c.timezone <> 'America/New_York' then
    raise exception 'config drifted from the locked business rules: %', to_json(c);
  end if;
end $$;

rollback;
