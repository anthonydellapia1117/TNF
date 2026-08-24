-- A public visitor sees no email, phone, or payment amount on any route
-- (section 7 row 12, acceptance 14). The public surface is exactly:
-- v_public_blocks, v_public_games, v_public_payouts, v_pot, config.
begin;

-- Structural: no public view exposes contact or per-person money columns.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('v_public_blocks', 'v_public_games', 'v_public_payouts')
      and (column_name in ('email', 'phone', 'notes', 'digit_seed', 'source_ref')
           or column_name like '%paid%')
  ) then
    raise exception 'public view exposes a private column';
  end if;
  -- Paid vs owed is admin-only (spec 4.6).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v_public_payouts'
      and column_name in ('status', 'paid_on', 'method')
  ) then
    raise exception 'v_public_payouts leaks settlement state';
  end if;
end $$;

-- Remember the true pot figures before dropping to anon — the public pot
-- must serve the same numbers to an anonymous visitor.
select set_config('test.expected_due',
  (select coalesce(sum(amount_due_cents), 0)::text from v_participant_finance), true);
select set_config('test.expected_collected',
  (select coalesce(sum(amount_cents), 0)::text from payments), true);

-- Behavioral: as anon, raw tables yield zero rows and the finance view is
-- not selectable at all.
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
declare
  n int;
begin
  select count(*) into n from participants;
  if n <> 0 then raise exception 'anon can read participants'; end if;
  select count(*) into n from payments;
  if n <> 0 then raise exception 'anon can read payments'; end if;
  select count(*) into n from audit_log;
  if n <> 0 then raise exception 'anon can read audit_log'; end if;

  begin
    select count(*) into n from v_participant_finance;
    raise exception 'anon can select v_participant_finance';
  exception
    when insufficient_privilege then null;
  end;

  -- The public projections DO serve anon.
  select count(*) into n from v_public_blocks;
  if n <> 100 then raise exception 'v_public_blocks should serve 100 rows to anon'; end if;
  -- Assignment policy: requested-vs-random is public per block.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v_public_blocks'
      and column_name = 'assignment_method'
  ) then
    raise exception 'v_public_blocks should expose assignment_method';
  end if;
  select count(*) into n from v_public_games;
  if n <> 23 then raise exception 'v_public_games should serve 23 rows to anon'; end if;
  select count(*) into n from v_pot;
  if n <> 1 then raise exception 'v_pot should serve anon'; end if;
  select count(*) into n from config;
  if n <> 1 then raise exception 'config should serve anon'; end if;
end $$;

-- Regression: v_pot's aggregates must survive RLS for anon — due_cents once
-- collapsed to 0 because it was read through an invoker view, which
-- evaluates RLS as the session user even inside a definer view.
do $$
declare
  pot v_pot;
begin
  select * into pot from v_pot;
  if pot.due_cents::text <> current_setting('test.expected_due', true) then
    raise exception 'anon v_pot.due_cents % != true due %',
      pot.due_cents, current_setting('test.expected_due', true);
  end if;
  if pot.due_cents <= 0 then
    raise exception 'anon v_pot.due_cents should be positive with a seeded pool';
  end if;
  if pot.collected_cents::text <> current_setting('test.expected_collected', true) then
    raise exception 'anon v_pot.collected_cents % != ledger %',
      pot.collected_cents, current_setting('test.expected_collected', true);
  end if;
end $$;

reset role;

-- Digits stay hidden from the public until published (acceptance 6).
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  g2 uuid;
  r record;
begin
  select id into g2 from games where game_no = 2;
  update games set date_confirmed = true, kickoff_at = now() + interval '7 days' where id = g2;
  perform admin_assign_digits(g2, 'test');

  set local role anon;
  select * into r from v_public_games where game_no = 2;
  if r.row_digits is not null or r.col_digits is not null then
    raise exception 'unpublished digits leak through v_public_games';
  end if;
  if r.digits_assigned is not true then
    raise exception 'digits_assigned flag should still show';
  end if;
  reset role;

  perform admin_publish_digits(g2, 'test');

  set local role anon;
  select * into r from v_public_games where game_no = 2;
  if r.row_digits is null or r.col_digits is null then
    raise exception 'published digits should be public';
  end if;
  reset role;
end $$;

rollback;
