-- Migration 44: one game-day email goes one day early, once (Anthony,
-- 2026-11-24 8:27 AM ET, Part P; approved in the TNF PM chat).
--
-- gameday_2026-11-25 (G01's numbers) may be claimed on ET date 2026-11-24 as
-- well as on its own date. Nothing else changes: every other gameday key,
-- kickoff_ and winners_ keep their date rule, and the per-day draw gate in
-- admin_draw_day and on /admin/digits is untouched. The exception expires by
-- itself: from 2026-11-25 the database date is never 2026-11-24 again, so no
-- revert migration and no flag. The renderer carries the same key and date
-- (EARLY_SENDS in src/lib/email/registry.ts).
--
-- email_day_not_ready is migration 43's, verbatim, with the one exception
-- added to its date check.

-- Is a day email's content ready? Null when it is, else the reason. Internal.
create or replace function email_day_not_ready(p_event_key text)
returns text
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from config where id = 1), 'America/New_York');
  v_today date := (now() at time zone v_tz)::date;
  v_kind text := substring(p_event_key from '^(kickoff|gameday|winners)_');
  v_date date := substring(p_event_key from '(\d{4}-\d{2}-\d{2})$')::date;
  v_day jsonb;
  g jsonb;
begin
  if v_kind is null or v_date is null then
    return 'not a game-day email key';
  end if;
  if v_kind in ('kickoff', 'gameday') and v_date <> v_today
     -- Migration 44: the one early send, on the one day it may go.
     and not (p_event_key = 'gameday_2026-11-25' and v_today = date '2026-11-24') then
    return format('%s goes out on its own date; today is %s', p_event_key, v_today);
  end if;
  if v_kind = 'winners' and v_date not in (v_today, v_today - 1) then
    return format('%s goes out the night of its games or the morning after; today is %s', p_event_key, v_today);
  end if;
  if v_kind = 'kickoff' then
    return null;
  end if;
  v_day := email_day_facts(v_date);
  if jsonb_array_length(v_day -> 'games') = 0 then
    return format('no games on %s', v_date);
  end if;
  for g in select * from jsonb_array_elements(v_day -> 'games') loop
    if not (g ->> 'published')::boolean then
      return format('G%s digits are not published', lpad(g ->> 'game_no', 2, '0'));
    end if;
    if not coalesce((g ->> 'digits_ok')::boolean, false) then
      return format('G%s digits do not match their draw row', lpad(g ->> 'game_no', 2, '0'));
    end if;
    if v_kind = 'winners' then
      if g ->> 'final_block' is null or g ->> 'halftime_block' is null then
        return format('G%s is not scored', lpad(g ->> 'game_no', 2, '0'));
      end if;
      if not (g ->> 'halftime_paid_out')::boolean or not (g ->> 'final_paid_out')::boolean then
        return format('G%s has a winning block with no payout behind it (not assigned): Anthony''s call', lpad(g ->> 'game_no', 2, '0'));
      end if;
    end if;
  end loop;
  return null;
end $$;

revoke execute on function email_day_not_ready(text) from public, anon, authenticated;
