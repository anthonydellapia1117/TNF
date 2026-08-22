-- Finance is computed, never stored (spec 2.1, section 7 rows 1 and 3).
begin;

-- No code path writes a derived total: the base tables carry no derived
-- money or count columns at all.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('participants', 'blocks', 'payments')
      and column_name in ('amount_paid', 'amount_paid_cents', 'amount_due',
                          'amount_due_cents', 'blocks_assigned', 'blocks_held',
                          'balance', 'balance_cents', 'total_cents')
  ) then
    raise exception 'a derived total is stored on a base table';
  end if;
end $$;

-- Seeded finance figures compute correctly.
do $$
declare
  f record;
begin
  select vf.* into f from v_participant_finance vf
    join participants p on p.id = vf.participant_id
   where p.full_name = 'Nicco Esgro';
  if f.amount_due_cents <> 50000 or f.amount_paid_cents <> 50000
     or f.blocks_held <> 1 or f.blocks_assigned <> 1 then
    raise exception 'Nicco Esgro finance wrong: %', to_json(f);
  end if;

  -- Paid in full with no number chosen yet: due comes from blocks_requested.
  select vf.* into f from v_participant_finance vf
    join participants p on p.id = vf.participant_id
   where p.full_name = 'Anthony Giletto';
  if f.amount_due_cents <> 50000 or f.amount_paid_cents <> 50000 or f.blocks_held <> 0 then
    raise exception 'Anthony Giletto finance wrong: %', to_json(f);
  end if;

  -- Two numbered blocks.
  select vf.* into f from v_participant_finance vf
    join participants p on p.id = vf.participant_id
   where p.full_name = 'Jr/Diz';
  if f.amount_due_cents <> 100000 or f.amount_paid_cents <> 0 or f.blocks_held <> 2 then
    raise exception 'Jr/Diz finance wrong: %', to_json(f);
  end if;

  -- Disputed payment stays off the ledger.
  select vf.* into f from v_participant_finance vf
    join participants p on p.id = vf.participant_id
   where p.full_name = 'Robert Gambino';
  if f.amount_due_cents <> 50000 or f.amount_paid_cents <> 0 then
    raise exception 'Robert Gambino must be reserved and unpaid: %', to_json(f);
  end if;
end $$;

-- The pot adds up and the ledger sum equals the pot view exactly.
do $$
declare
  pot v_pot;
  ledger bigint;
begin
  select * into pot from v_pot;
  if pot.available + pot.reserved + pot.assigned + pot.held <> 100 then
    raise exception 'block invariant broken: %', to_json(pot);
  end if;
  if pot.assigned <> 1 or pot.reserved <> 12 or pot.available <> 87 then
    raise exception 'seed block counts wrong: %', to_json(pot);
  end if;
  if pot.collected_cents <> 100000 then
    raise exception 'collected should be $1,000: %', pot.collected_cents;
  end if;
  if pot.due_cents <> 27 * 50000 then
    raise exception 'due should be 27 blocks x $500: %', pot.due_cents;
  end if;
  select coalesce(sum(amount_cents), 0) into ledger from payments;
  if ledger <> pot.collected_cents then
    raise exception 'ledger sum % != pot view %', ledger, pot.collected_cents;
  end if;
end $$;

rollback;
