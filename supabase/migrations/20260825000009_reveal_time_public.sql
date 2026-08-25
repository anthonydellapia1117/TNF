-- The NEXT REVEAL dashboard card needs the announced drop time. Expose the
-- reveal TIMESTAMP as its own column the moment a publish (immediate or
-- scheduled) exists — the digit set itself stays absent from the public
-- payload until that instant passes, and the gated digits_published_at
-- column keeps its meaning (non-null = digits actually visible now).
create or replace view v_public_games as
select
  g.id, g.game_no, g.week, g.kickoff_at, g.date_confirmed, g.game_type,
  g.holiday_label, g.home_team, g.away_team, g.network,
  case when g.digits_published_at is not null and g.digits_published_at <= now()
       then g.row_digits end as row_digits,
  case when g.digits_published_at is not null and g.digits_published_at <= now()
       then g.col_digits end as col_digits,
  (g.digits_assigned_at is not null) as digits_assigned,
  case when g.digits_published_at is not null and g.digits_published_at <= now()
       then g.digits_published_at end as digits_published_at,
  g.live_home, g.live_away, g.live_updated_at,
  g.halftime_home, g.halftime_away, g.halftime_block, g.halftime_scored_at,
  g.final_home, g.final_away, g.final_block, g.final_scored_at,
  case when g.status = 'published'
        and g.digits_published_at is not null
        and g.digits_published_at > now()
       then 'digits_assigned' else g.status end as status,
  g.digits_published_at as digits_reveal_at
from games g;
