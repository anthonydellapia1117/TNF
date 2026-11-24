-- Migration 44: gameday_2026-11-25 may be claimed on ET date 2026-11-24 as
-- well as on its own date (Anthony, 2026-11-24 8:27 AM ET, Part P). Nothing
-- else moves.
--
-- email_day_not_ready reads now(), so every expectation here is computed from
-- the database's own ET date: the suite is true on any day it runs. It was also
-- run under libfaketime at 2026-11-23, 24, 25 and 26 (see the PR), which is
-- what exercises the exception itself; on the default runner only the "not
-- today" branches fire.
--
-- Mutation checks, each verified to fail: drop the exception (2026-11-24 run);
-- widen it to any date (23, 26 runs); widen it to any gameday key (24 run);
-- let a kickoff key through (24 run).

begin;

create temp table t_d as
select (now() at time zone 'America/New_York')::date as today;

-- The date half of the reason, '' when the date check passes. A not-ready for
-- another reason (no games on that date, digits not published) is not a date
-- refusal, so only the "goes out on its own date" text counts here.
create function pg_temp.date_refused(k text) returns boolean language sql as $$
  select coalesce(email_day_not_ready(k), '') like '%goes out on its own date%'
$$;
create function pg_temp.winners_refused(k text) returns boolean language sql as $$
  select coalesce(email_day_not_ready(k), '') like '%the night of its games or the morning after%'
$$;

do $$
declare
  d date := (select today from t_d);
  k text;
  want boolean;
begin
  -- 1. The exception: gameday_2026-11-25 passes the date check on Nov 24 and
  --    on Nov 25, and nowhere else.
  want := d not in (date '2026-11-24', date '2026-11-25');
  if pg_temp.date_refused('gameday_2026-11-25') is distinct from want then
    raise exception 'TEST FAILURE: gameday_2026-11-25 on %: date refused %, want %', d, pg_temp.date_refused('gameday_2026-11-25'), want;
  end if;

  -- 2. Every other gameday key keeps its own-date rule, Nov 26's above all.
  foreach k in array array['gameday_2026-11-26', 'gameday_2026-11-27', 'gameday_2026-11-24', 'gameday_2026-12-24', 'gameday_2026-12-25', 'gameday_2026-12-31'] loop
    want := d <> substring(k from '(\d{4}-\d{2}-\d{2})$')::date;
    if pg_temp.date_refused(k) is distinct from want then
      raise exception 'TEST FAILURE: % on %: date refused %, want %', k, d, pg_temp.date_refused(k), want;
    end if;
  end loop;

  -- 3. The day before and the day after the date it names are both refused
  --    for any gameday key that is not the exception, relative to today.
  foreach k in array array['gameday_' || to_char(d + 1, 'YYYY-MM-DD'), 'gameday_' || to_char(d - 1, 'YYYY-MM-DD')] loop
    if k = 'gameday_2026-11-25' then continue; end if;
    if not pg_temp.date_refused(k) then
      raise exception 'TEST FAILURE: % passed the date check on %', k, d;
    end if;
  end loop;

  -- 4. Kickoff is unchanged: its own date only.
  foreach k in array array['kickoff_2026-11-24', 'kickoff_2026-11-25', 'kickoff_' || to_char(d + 1, 'YYYY-MM-DD')] loop
    want := d <> substring(k from '(\d{4}-\d{2}-\d{2})$')::date;
    if pg_temp.date_refused(k) is distinct from want then
      raise exception 'TEST FAILURE: % on %: date refused %, want %', k, d, pg_temp.date_refused(k), want;
    end if;
  end loop;

  -- 5. Winners is unchanged: its game date or the morning after.
  foreach k in array array['winners_2026-11-25', 'winners_2026-11-24', 'winners_' || to_char(d + 1, 'YYYY-MM-DD'), 'winners_' || to_char(d - 2, 'YYYY-MM-DD')] loop
    want := d not in (substring(k from '(\d{4}-\d{2}-\d{2})$')::date, substring(k from '(\d{4}-\d{2}-\d{2})$')::date + 1);
    if pg_temp.winners_refused(k) is distinct from want then
      raise exception 'TEST FAILURE: % on %: refused %, want %', k, d, pg_temp.winners_refused(k), want;
    end if;
  end loop;
end $$;

-- 6. The exception changes only the date check: on the one day it applies,
--    gameday_2026-11-25 still needs G01 drawn and published, and the claim
--    still refuses it until then.
do $$
begin
  if (select today from t_d) = date '2026-11-24' then
    if coalesce(email_day_not_ready('gameday_2026-11-25'), '') not like '%not published%'
       and exists (select 1 from games g where (g.kickoff_at at time zone 'America/New_York')::date = date '2026-11-25'
                     and g.status <> 'void' and (g.digits_published_at is null or g.digits_published_at > now())) then
      raise exception 'TEST FAILURE: the early key skipped the publish check: %', email_day_not_ready('gameday_2026-11-25');
    end if;
  end if;
end $$;

rollback;
