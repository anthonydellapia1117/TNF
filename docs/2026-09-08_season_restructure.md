# Season restructure, 2026-09-08

Overnight run on Anthony's written authority. The 2026 pool went from 23
Thursday-night games in two payout tiers to the 10 holiday games in one
tier. This is the record of what moved. Hyphens only.

## What changed

- 10 holiday games, Thanksgiving Eve through New Year's Eve, weeks 12, 16, 17.
- One payout tier: $1,500 halftime, $3,000 final, every game. $45,000 fixed.
- $500 a block, unchanged. Break-even 90 paying blocks. $450 expected per block.
- Claim and payment deadline moved from 2026-09-04 to 2026-11-24.
- Two participants out at their own request: nerdz (block 1, Raychel Neil,
  cc Ray Vassallo; source Ray Vassallo's email of 2026-09-08 4:39 PM ET) and
  F Chili (block 78). Block 3 (AAA, comped) stays. Nobody else moves.
- The digits drawn and published for the September G01 and G02 are void.

## BEFORE, read live 2026-09-08 11:14 PM ET

| Read | Value |
|---|---|
| blocks by status | available 40, reserved 15, assigned 45, sum 100 |
| committed blocks | 60 |
| participants with a block | 52 |
| games | 23, 2 published, 2 with digits, 0 scored, 0 payout rows |
| config payouts | regular 75000 / 100000, holiday 75000 / 150000 |
| config price, deadline, mode | 50000, 2026-09-04, season_mode false, season_status open |
| money | due 2,950,000 (59 paying blocks x 50000), collected 2,200,000 (43 ledger rows), outstanding 750,000 |
| ledger, block 1 holder | one row, 50000, venmo, 2026-09-03, txn 4678217450148051522, id 53d8db46-854d-417b-aa20-d62079c39c48 |
| ledger, block 78 holder | none |
| audit_log | 241 rows, max id 249 |

Repo greps before, src + docs + tests + public + CLAUDE.md: "23 games" 6,
"$750" 9, "$1,000" 12, "$1,500" 7, "44,250" 9, "44250" 4, "Sep 9" 7,
"September 9" 9, "2026-09-09" 28, "regular" 32, "holiday" 131, "TNF" 71.

## STEP 1, removals (production, one transaction, audited)

- Block 78 released to available; prior holder kept in notes. Audit 250,
  `participant_removed` on blocks/78.
- Block 1 released to available; notes cite Ray Vassallo's email. Audit 251,
  `participant_removed` on blocks/1.
- Participant rows kept, `blocks_requested` 1 -> 0, dated note; the schema
  has no inactive flag. Audit 252 (F Chili) and 253 (Raychel Neil).
- Payment on file for block 1 untouched. One `/admin/queue` row,
  kind `refund_needed`, id 806526bf-7d90-41a5-9119-8785ebc3ffa3, amount
  50000, txn 4678217450148051522. Audit 254, `stage_pending`.
- After: available 42, reserved 14, assigned 44, sum 100, committed 58,
  50 participants, ledger still 43 rows / 2,200,000.

## STEP 2 and 3, migration 20260908000024_season_restructure.sql

Inside one transaction:

- Locked: `games` and `payouts` in EXCLUSIVE mode before anything is
  checked, so a score or payout committed by a concurrent admin request is
  either seen by the refusal or blocked until the migration ends (Codex
  review finding on PR #6, fixed before merge).
- Archived: one `audit_log` row per existing game, action
  `season_restructure_archive`, target `games/<game_no>`, payload the full
  row including row_digits, col_digits, digits_published_at and
  digits_reveal_at. The September digits survive only there.
- Deleted: the old game rows and any payout referencing them (none; the
  migration refuses to run if a score or a payout exists).
- Inserted: the 10 holiday games, status scheduled, date_confirmed true, no
  digits, no reveal scheduled. The 8:00 AM ET reveal slot on each game's
  own date is derived by the app.
- Config: every payout key to 150000 / 300000, claim_deadline 2026-11-24,
  old and new values in an audit row `season_restructure_config`. A final
  audit row `season_restructure` carries the counts.
- Self-check raises and rolls back on anything other than 10 scheduled
  holiday games with no digits and the config above.

Applied locally by `npm run test:db` (empty games table: archived 0,
inserted 10) with all 18 SQL suites passing, including the new
`18_season_restructure.sql`. Applied to production after merge; see AFTER.

## Code

- `payoutCents()` ignores `game_type` and reads the holiday pair.
- `nextHolidayGame()` lost its premium; the holiday card shows the countdown
  and the count still ahead.
- No hard-coded 23, 46, 44250, 442.5 or 89 remains in `src`. Season length
  and totals derive from the games table and config: og image, block page,
  schedule, winners empty state, home "kicks off" line.
- Public /blocks unchanged: placement words only, no price, deadline or
  claim language.

## Tests, fail first

- `pool.test.ts` "pays the same numbers regardless of game_type": old code
  `expected 75000 to be 150000`, new code passes.
- `board.test.ts` break-even 90: against the old $44,250 constant
  `expected 89 to be 90` and `expected 59 to be 60`, with $45,000 passes.
- `fan-stats.test.ts` two-argument `nextHolidayGame`: old code
  `expected undefined to be 13`, new code passes.
- `18_season_restructure.sql` with `holiday_final_cents` mutated to 250000:
  FAIL at the one-tier check, reverted, PASS. The unit suite carries the
  same mutation as a standing case ($4,000,000, not $4,500,000).
- Full runs: vitest 250 passed, `npm run test:db` 18 of 18 PASS, lint
  clean, `next build` compiles.

## STEP 7, PR, merge, apply

- PR #6 `claude/season-restructure-0908` -> main, 26 files. Vercel green on
  every head. Codex reviewed each head; one P2 fixed before merge (lock
  `games` and `payouts` in EXCLUSIVE mode before the checks, d884746,
  proven on a local Postgres: the lock waits out an in-flight write and is
  granted at once without one). Two Copilot nits fixed (og image word
  fallback when the games projection is empty, fan-stats header comment,
  000297d). One Codex P2 filed as issue #7 (`payoutCents()` ignores
  `game_type`; the SQL scorer stays tier-aware, no DB write depends on the
  helper) and merged past. Merge commit 735ef7d at 04:27 UTC.
- Production deploy of main live at 04:28:54 UTC, before the apply.
- Migration applied to production at 04:29 UTC, attended, as one DO block;
  recorded by Supabase as `20260909042948 season_restructure`. Self-check
  passed; nothing rolled back. Rehearsed first at 04:19 UTC inside a block
  that raised at the end, so every write rolled back: archived 23, deleted
  23, games 10, blocks 100. That rehearsal consumed audit ids 255-279; no
  audit row is missing.

## AFTER, read live 2026-09-09 04:31 UTC (12:31 AM ET)

| Read | Value |
|---|---|
| blocks by status | available 42, reserved 14, assigned 44, held 0, sum 100 |
| committed blocks | 58 |
| participants with a block | 50 |
| games | 10, all scheduled, 0 published, 0 with digits, weeks 12 / 16 / 17; G01 Packers at Rams Wed Nov 25 8:00 PM ET, G10 Ravens at Bengals Thu Dec 31 8:15 PM ET |
| config | halftime 150000 and final 300000 on all four keys, total 4,500,000, claim_deadline 2026-11-24, price 50000, season_mode false, season_status open |
| money | due 2,850,000 = (58 committed - 1 comped) x 50000; collected 2,200,000 (43 ledger rows, unchanged by this run); outstanding 650,000; paid out 0, owed out 0, payout rows 0 |
| audit_log | 271 rows; 25 new, ids 280-304 sequential: `season_restructure_archive` for games 1-23, `season_restructure_config` on config/1, `season_restructure` {archived 23, deleted 23, inserted 10, games_after 10} |
| archive spot check | game 1 row carries row_digits [7,1,5,3,6,0,2,8,9,4], col_digits [9,3,0,6,2,4,8,1,7,5], published 2026-09-04 |
| anon v_pot | available 42, reserved 14, assigned 44, held 0, committed 58; collected, due, paid_out and owed_out all null |
| anon v_public_games | 10 rows, digits null on all, digits_assigned false, reveal null, all scheduled |
| /schedule | 10 game cards, first G01 Nov 25, $1,500 and $3,000 on every card, no Sep 9, no $750, no $1,000 |
| / | G01 Packers at Rams, 78 days to Nov 25, $1,500 / $3,000, no 23 games |
| /grid?g=1 to g=10 | twenty question marks each, the right game code on each |
| /blocks | 42 AVAILABLE, the word claim absent |

Before and after, side by side: blocks 40 / 15 / 45 -> 42 / 14 / 44 (the
two removals), committed 60 -> 58, participants 52 -> 50, games 23 -> 10,
published 2 -> 0, payouts 75000/100000 and 75000/150000 -> 150000/300000
on every key, claim deadline 2026-09-04 -> 2026-11-24, due 2,950,000 ->
2,850,000, collected 2,200,000 -> 2,200,000, outstanding 750,000 ->
650,000.

## STEP 8, the announcement

- Sent 2026-09-09 04:32 UTC, Gmail message id 1a084701b17e391d, thread
  1a0846fbb91c2e72. To anthonydellapia@gmail.com, BCC 37, plain text,
  subject `TNF Block Pool | Change: 10 holiday games, $1,500 / $3,000
  payouts`. Body read back from the draft and diffed against the text in
  the run prompt: identical, the only difference being Gmail wrapping the
  /blocks link in its own redirect, which still opens the page.
- BCC arithmetic: 50 holders after STEP 1; 11 have no email and no
  cc_email; the rest give 38 distinct addresses after lowercasing and
  deduping (one address is shared by two holders, two holders carry a
  cc_email); Anthony's own address is one of the 38 and is the To, so 37
  in BCC. The old G01 pack draft carried 40, which is the same list plus
  the two nerdz addresses removed in STEP 1. The prompt expected 45 to 60;
  the shortfall is the 11 holders with no address, not a derivation gap.
  Every address is on a participant holding a committed block; none comes
  from any other list.
- Trashed after the send, nothing else touched: G01 pack 1a07247d09aadb3b,
  G02 pack 1a0781f07230fe68, "TNF Blocks | Final call - kickoff Wednesday"
  1a0781edacb62007.

## Left for Anthony

- Refund: queue row 806526bf-7d90-41a5-9119-8785ebc3ffa3, kind
  `refund_needed`, nerdz block 1, $500, Venmo txn 4678217450148051522.
- Issue #7, the `payoutCents()` tier branch.
- Routines stay paused. Cron lines to paste: TNF Draw Window
  `37 14 24 11 *` and `37 14 22,29 12 *`; TNF Game Day Pack
  `10 14 25-27 11 *` and `10 14 24,25,31 12 *`. Full list in
  `docs/ROUTINES.md`.
- Not in the PR: comment-only edits to `src/lib/format.ts`,
  `src/lib/week-digits.ts`, `src/lib/game-day-pack.ts`,
  `src/components/grid/grid-explorer.tsx` and `src/lib/season-mode.ts`
  were dropped to keep the push small; a few comments there still mention
  the old slate. `tests/unit/game-day-pack.test.ts` now carries literal em
  and en dash characters in its dash-stripping fixture instead of `\u`
  escapes (the file went through the GitHub API); the test is unchanged in
  meaning and passes.
