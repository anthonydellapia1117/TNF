-- Season restructure, 2026-09-08.
--
-- The 2026 1622 TNF Block Pool is the 10 holiday games only, Thanksgiving Eve
-- through New Year's Eve, with one payout tier: $1,500 halftime, $3,000 final,
-- every game. 100 blocks x $500 = $50,000 in. 10 x $4,500 = $45,000 out.
-- Break-even is 90 paying blocks. $500 a block is unchanged.
--
-- What this does, inside one transaction:
--   1. Refuses to run if any game is scored or any payout row exists.
--   2. Archives every existing game row into audit_log, one row per game,
--      action season_restructure_archive, payload = the full row. The digits
--      drawn and published for the September G01 and G02 are void, and this
--      archive is the only place they survive. Digits are never edited; the
--      rows are deleted whole after they are archived.
--   3. Deletes the old game rows and any payout stub referencing them (none,
--      by step 1).
--   4. Inserts the 10 holiday games. status scheduled, date_confirmed true,
--      no digits, nothing published. The reveal slot is derived by the app:
--      8:00 AM America/New_York on each game's own date.
--   5. Sets every payout tier key to 150000 / 300000, so the regular/holiday
--      split is harmless wherever an older path still reads it, and moves
--      claim_deadline to 2026-11-24. price_per_block_cents and season_mode
--      are untouched. Old and new config values go to audit_log.
--   6. Checks itself and raises, rolling everything back, if the result is
--      not 10 scheduled holiday games with no digits and the config above.
--
-- On a fresh local database (scripts/db/test-db.sh) the games table is empty
-- when this runs: it archives nothing and seeds the 10 games. seed.sql no
-- longer inserts games for that reason.

do $$
declare
  v_actor text := 'migration:20260908000024_season_restructure';
  v_games int;
  v_archived int;
  v_scored int;
  v_payouts int;
  v_cfg_before jsonb;
  v_cfg_after jsonb;
  c config%rowtype;
begin
  -- 1. Nothing to lose: no scores, no payouts.
  select count(*) into v_games from games;
  select count(*) into v_scored from games
   where halftime_scored_at is not null or final_scored_at is not null
      or halftime_block is not null or final_block is not null;
  select count(*) into v_payouts from payouts;
  if v_scored <> 0 or v_payouts <> 0 then
    raise exception 'season restructure refused: % scored games, % payout rows', v_scored, v_payouts;
  end if;

  -- 2. Archive first. Full row, digits included.
  insert into audit_log (actor, action, target_table, target_id, before, note)
  select v_actor, 'season_restructure_archive', 'games', g.game_no::text,
         to_jsonb(g) || jsonb_build_object('digits_reveal_at', g.digits_published_at),
         'season restructure 2026-09-08: full game row archived before delete. '
         'The September digits survive only in this row.'
    from games g
   order by g.game_no;
  get diagnostics v_archived = row_count;
  if v_archived <> v_games then
    raise exception 'archived % of % games', v_archived, v_games;
  end if;

  -- 3. Delete, children first.
  delete from payouts where game_id in (select id from games);
  delete from games;

  -- 4. The 10 holiday games. Kickoffs in UTC; all local times are EST (UTC-5).
  insert into games (game_no, week, kickoff_at, date_confirmed, game_type, holiday_label, away_team, home_team, network, status) values
    ( 1, 12, '2026-11-26T01:00:00Z', true, 'holiday', 'Thanksgiving Eve', 'Green Bay Packers',    'Los Angeles Rams',     'Netflix',     'scheduled'),
    ( 2, 12, '2026-11-26T18:00:00Z', true, 'holiday', 'Thanksgiving',     'Chicago Bears',        'Detroit Lions',        'CBS',         'scheduled'),
    ( 3, 12, '2026-11-26T21:30:00Z', true, 'holiday', 'Thanksgiving',     'Philadelphia Eagles',  'Dallas Cowboys',       'FOX',         'scheduled'),
    ( 4, 12, '2026-11-27T01:20:00Z', true, 'holiday', 'Thanksgiving',     'Kansas City Chiefs',   'Buffalo Bills',        'NBC',         'scheduled'),
    ( 5, 12, '2026-11-27T20:00:00Z', true, 'holiday', 'Black Friday',     'Denver Broncos',       'Pittsburgh Steelers',  'Prime Video', 'scheduled'),
    ( 6, 16, '2026-12-25T01:15:00Z', true, 'holiday', 'Christmas Eve',    'Houston Texans',       'Philadelphia Eagles',  'Prime Video', 'scheduled'),
    ( 7, 16, '2026-12-25T18:00:00Z', true, 'holiday', 'Christmas',        'Green Bay Packers',    'Chicago Bears',        'Netflix',     'scheduled'),
    ( 8, 16, '2026-12-25T21:30:00Z', true, 'holiday', 'Christmas',        'Buffalo Bills',        'Denver Broncos',       'Netflix',     'scheduled'),
    ( 9, 16, '2026-12-26T01:15:00Z', true, 'holiday', 'Christmas',        'Los Angeles Rams',     'Seattle Seahawks',     'Prime Video', 'scheduled'),
    (10, 17, '2027-01-01T01:15:00Z', true, 'holiday', 'New Year''s Eve',  'Baltimore Ravens',     'Cincinnati Bengals',   'Prime Video', 'scheduled');

  -- 5. One payout tier, new claim deadline. Old and new values audited.
  select to_jsonb(cfg) into v_cfg_before from config cfg where cfg.id = 1;
  update config
     set regular_halftime_cents = 150000,
         regular_final_cents    = 300000,
         holiday_halftime_cents = 150000,
         holiday_final_cents    = 300000,
         claim_deadline         = date '2026-11-24'
   where id = 1;
  select to_jsonb(cfg) into v_cfg_after from config cfg where cfg.id = 1;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (v_actor, 'season_restructure_config', 'config', '1', v_cfg_before, v_cfg_after,
          'one payout tier: halftime 150000 and final 300000 on every tier key; '
          'claim_deadline 2026-11-24; price_per_block_cents and season_mode untouched');

  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (v_actor, 'season_restructure', 'games', null,
          jsonb_build_object('archived', v_archived, 'deleted', v_games, 'inserted', 10,
                             'games_after', (select count(*) from games)),
          'season restructure 2026-09-08: 10 holiday games, one tier, $45,000 fixed');

  -- 6. Self-check.
  if (select count(*) from games) <> 10
     or (select count(*) from games where game_type <> 'holiday' or status <> 'scheduled' or not date_confirmed) <> 0
     or (select count(*) from games where row_digits is not null or col_digits is not null
                                       or digits_assigned_at is not null or digits_published_at is not null) <> 0 then
    raise exception 'post-insert check failed';
  end if;
  select * into c from config where id = 1;
  if c.regular_halftime_cents <> 150000 or c.holiday_halftime_cents <> 150000
     or c.regular_final_cents <> 300000 or c.holiday_final_cents <> 300000
     or c.claim_deadline <> date '2026-11-24' or c.price_per_block_cents <> 50000 then
    raise exception 'config check failed: %', to_jsonb(c);
  end if;
end $$;
