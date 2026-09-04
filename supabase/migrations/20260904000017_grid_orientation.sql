-- Grid orientation: AWAY selects the row, HOME selects the column.
--
-- This reverses the axes. Until now winning_block indexed p_row_digits by
-- the HOME score, which put HOME down the left side of the grid. Anthony's
-- hand-built 2025 grid — and every one before it — puts HOME across the top
-- and AWAY down the left, and 47 people read it that way from habit without
-- checking the axis labels. The app was the newcomer and it was transposed.
--
-- Both orientations are arithmetically valid pools; neither is more correct.
-- What matters is that the app agrees with the grid everyone already knows,
-- because a player reading their block's digit pair the 2025 way off a
-- transposed grid gets the wrong pair and believes the wrong block won.
--
-- Safe to do now and only now: applied 2026-09-04, with 0 of 23 games having
-- digits drawn, 0 published, 0 scored and 0 payout rows. There is no history
-- to invalidate. After the first draw this would change who wins a game that
-- had already been played.
--
-- The parameter names stay geometric on purpose. p_row_digits is the
-- VERTICAL axis and p_col_digits the HORIZONTAL one; which team sits on
-- which axis is what this migration changes. Same for the row_digits and
-- col_digits columns on games.
--
-- Worked example, the one carried in the spec and CLAUDE.md:
--   rows 3,7,1,9,0,5,2,8,4,6   cols 8,2,4,0,6,1,9,3,7,5
--   home 27 (digit 7), away 14 (digit 4)
--   row = position of AWAY 4 in rows = 8 (0-based)
--   col = position of HOME 7 in cols = 8 (0-based)
--   block = 8*10 + 8 + 1 = 89
-- Under the old orientation the same inputs gave 13. Different block,
-- different person: that difference is the whole point of this migration.

create or replace function winning_block(
  p_row_digits int[], p_col_digits int[], p_home_score int, p_away_score int
) returns int
language sql immutable
set search_path = public, pg_temp
as $$
  select (array_position(p_row_digits, p_away_score % 10) - 1) * 10
       + (array_position(p_col_digits, p_home_score % 10) - 1) + 1
$$;

comment on function winning_block(int[], int[], int, int) is
  'The winning block for a score. AWAY last digit selects the row, HOME last '
  'digit selects the column, block = row*10 + col + 1. Matches the '
  'hand-built 2025 grid: HOME across the top, AWAY down the left side. '
  'Reversed 2026-09-04 (migration 17) before any digits were drawn; do not '
  'flip it back by reasoning from a pre-17 spec.';

comment on column games.row_digits is
  'The VERTICAL axis of the grid: the AWAY team''s last-digit permutation, '
  'read down the left side. Named for the axis, not the team.';

comment on column games.col_digits is
  'The HORIZONTAL axis of the grid: the HOME team''s last-digit permutation, '
  'read across the top. Named for the axis, not the team.';
