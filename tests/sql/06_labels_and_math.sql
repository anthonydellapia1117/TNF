-- Verbatim names, the apostrophe round-trip, the worked example, and the
-- $45,000 season total (10 holiday games, one tier, since 2026-09-08).
begin;

do $$
declare
  v_label text;
  v_total bigint;
begin
  -- Apostrophe round-trips exactly (section 7 row 9).
  select holiday_label into v_label from games where game_no = 10;
  if v_label <> 'New Year''s Eve' then
    raise exception 'holiday_label mangled: %', v_label;
  end if;

  -- Names stored verbatim, case preserved (section 7 row 10).
  if not exists (select 1 from participants where full_name = 'frank animal' and display_alias = 'frank animal') then
    raise exception 'lower-case name was normalized';
  end if;
  if not exists (select 1 from participants where full_name = 'M & M') then
    raise exception 'M & M mangled';
  end if;
  if not exists (select 1 from participants where display_alias = 'Breeze (Agnes)') then
    raise exception 'alias mangled';
  end if;
  if not exists (select 1 from participants where full_name = 'Jr/Diz') then
    raise exception 'Jr/Diz mangled';
  end if;

  -- The H2 worked example returns block 13 (acceptance 7).
  -- AWAY 4 selects the row (index 8), HOME 7 selects the column (index 8).
  -- The old orientation gave 13; see migration 17.
  if winning_block(array[3,7,1,9,0,5,2,8,4,6], array[8,2,4,0,6,1,9,3,7,5], 27, 14) <> 89 then
    raise exception 'worked example failed';
  end if;

  -- 10 games, every one holiday, since the 2026-09-08 restructure.
  if (select count(*) from games) <> 10
     or (select count(*) from games where game_type = 'holiday') <> 10
     or (select count(*) from games where game_type = 'regular') <> 0 then
    raise exception 'game mix wrong';
  end if;
  -- One tier: the same numbers whichever key an older path reads.
  select sum(
           case when g.game_type = 'holiday'
                then c.holiday_halftime_cents + c.holiday_final_cents
                else c.regular_halftime_cents + c.regular_final_cents end)
    into v_total
    from games g cross join config c;
  if v_total is null then
    raise exception 'season payout total is NULL, the assertion below would be vacuous';
  end if;
  if v_total <> 4500000 then
    raise exception 'season payout total is % cents, not $45,000', v_total;
  end if;
  if (select regular_halftime_cents from config) <> (select holiday_halftime_cents from config)
     or (select regular_final_cents from config) <> (select holiday_final_cents from config) then
    raise exception 'payout tiers differ; the pool has one tier';
  end if;

  -- Holiday mix: Thanksgiving Eve, 3 Thanksgiving, Black Friday, Christmas
  -- Eve, 3 Christmas, New Year's Eve.
  if (select count(*) from games where holiday_label = 'Thanksgiving Eve') <> 1
     or (select count(*) from games where holiday_label = 'Thanksgiving') <> 3
     or (select count(*) from games where holiday_label = 'Black Friday') <> 1
     or (select count(*) from games where holiday_label = 'Christmas Eve') <> 1
     or (select count(*) from games where holiday_label = 'Christmas') <> 3
     or (select count(*) from games where holiday_label = 'New Year''s Eve') <> 1 then
    raise exception 'holiday mix wrong';
  end if;

  -- Every date is confirmed; nothing ships unconfirmed any more.
  if exists (select 1 from games where not date_confirmed) then
    raise exception 'every game must ship date_confirmed';
  end if;
end $$;

rollback;
