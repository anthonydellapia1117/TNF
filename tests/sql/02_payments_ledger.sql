-- The ledger is append-only and the database is the dedupe (section 7 rows 2-3).
begin;

-- Admin claims: v_pot.collected_cents is admin-only since migration 16, so
-- without these the ledger-equals-pot half of the reconciliation below is
-- NULL and never fires. See the note at the top of 01_finance.sql.
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);

-- Duplicate venmo_txn_id is rejected by the DATABASE, not app code.
do $$
begin
  begin
    insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id)
    select id, 50000, 'venmo', date '2026-08-22', '4668875750736929799'
      from participants where full_name = 'Konnor McGrorty';
    raise exception 'duplicate venmo_txn_id was accepted';
  exception
    when unique_violation then null; -- correct
  end;
end $$;

-- UPDATE and DELETE are blocked by trigger regardless of role.
do $$
declare
  v_id uuid;
begin
  select id into v_id from payments limit 1;
  begin
    update payments set amount_cents = 1 where id = v_id;
    raise exception 'payment update was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from payments where id = v_id;
    raise exception 'payment delete was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- Corrections are new rows referencing the original; a correction without a
-- reference is rejected; after a correction the ledger sum equals the pot.
do $$
declare
  v_orig uuid;
  v_pot_collected bigint;
  v_ledger bigint;
begin
  select p.id into v_orig from payments p
    join participants pp on pp.id = p.participant_id
   where pp.full_name = 'Nicco Esgro';

  begin
    insert into payments (participant_id, amount_cents, method, paid_on)
    values ((select participant_id from payments where id = v_orig), -50000, 'correction', current_date);
    raise exception 'correction without corrects_payment_id was accepted';
  exception
    when check_violation then null; -- correct
  end;

  insert into payments (participant_id, amount_cents, method, paid_on, corrects_payment_id, note)
  values ((select participant_id from payments where id = v_orig), -50000, 'correction', current_date, v_orig, 'test correction');

  select collected_cents into v_pot_collected from v_pot;
  select coalesce(sum(amount_cents), 0) into v_ledger from payments;
  if v_pot_collected is null then
    raise exception 'v_pot.collected_cents is NULL — not running as admin, so '
      'the ledger-equals-pot check below is vacuous';
  end if;
  if v_ledger <> v_pot_collected or v_ledger <> 50000 then
    raise exception 'ledger % vs pot % after correction', v_ledger, v_pot_collected;
  end if;
end $$;

rollback;
