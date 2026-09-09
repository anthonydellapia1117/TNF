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

## AFTER

Filled after the production apply and the live verify (STEP 7).
