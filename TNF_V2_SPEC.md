# TNF BLOCK POOL — V2 ENHANCEMENT SPECIFICATION

Repo: `tnf`
Live: `ad-26-tnf.vercel.app`
Supabase: project `bqisojzdwodwaznzwega`
Written 2026-08-24. Claim and payment deadline **September 4**. First game **G01, Wednesday September 9**.

Work autonomously inside this repo, its Supabase project, and its Vercel deployment. Do not stop for file creation, migrations, components, or deploys.

The sibling Survivor app at `github.com/anthonydellapia1117/Survivor` just completed an equivalent v2 pass. Where a pattern exists there — the alive/eliminated toggle, the team color system, the game board, conditional color tokens — read it and match it. Two apps, one visual language.

**Governing principle: nothing is ever deleted.** Not blocks, not participants, not payments, not games. Views filter; data persists. Every filtered view has a toggle that brings the hidden rows back with their full history intact.

---

## PART A — TEAM COLORS AND THE GRID AXES

This is the most visible change and the reason for the pass.

**A1. Ship a static NFL color lookup.** All 32 teams, primary and secondary hex values, sourced from `teampalettes.com/nfl`. Committed to the repo as a typed constant — never fetched at runtime.

**A2. Every color must clear WCAG 4.5:1 on the dark surface.** Several NFL primaries are too dark to read on `#0B0D0F`. For each team compute a lightened display variant, store both the true brand color and the display variant, and add a test asserting all 32 display variants pass. Use the true color for large fills and the display variant for text and small marks.

**A3. The grid axes become unmistakable.**

```
                    AWAY  ·  DALLAS COWBOYS
                    ═══════════════════════════════════
              8    2    4    0    6    1    9    3    7    5
        ┌───┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
H   3   │   │  1 │  2 │  3 │  4 │  5 │  6 │  7 │  8 │  9 │ 10 │
O   7   │   │ 11 │ 12 │[13]│ 14 │ 15 │ 16 │ 17 │ 18 │ 19 │ 20 │
M   1   │   │ 21 │ 22 │ 23 │ ...
E   ...
║
SEATTLE SEAHAWKS
```

- The **away** axis runs across the top with a full-width bar in that team's color, team name in the contrasting display variant
- The **home** axis runs down the left as a vertical rail in that team's color, name rotated
- Both bars are solid and unmissable — a player glancing at their phone must know which axis is theirs in under a second
- Digit cells sit inside the colored bars, in the display variant so they stay legible
- When a team's primary and the surface are too close, fall back to the display variant for the bar itself

**A4. Score display uses team colors.** Above the grid, each team's name and score render in their color, with the **last digit of each score at full weight and the leading digits at 60%** — because the last digit is the only part that matters and showing that teaches the game to anyone new.

**A5. On logos.** Use color and typographic treatment, not raster marks. NFL logos are trademarked and scraping them creates a licensing problem on a site shared publicly. A well-set team name or three-letter abbreviation in the team's color reads better at grid density and carries no risk.

---

## PART B — BLOCK STATUS FILTERING

**B1. `/blocks` gets a persistent segmented toggle:**

```
[ OPEN 71 ]  [ CLAIMED 29 ]  [ ALL 100 ]
```

Counts are live. Default is `ALL` — this board is the sales tool and the whole point is seeing what is available against what is gone. Selection persists in the URL and localStorage.

**B2. Open blocks are visually loud.** Dashed border, bright, inviting, with the number large. Claimed blocks are quiet — solid surface, owner alias in muted text. Assigned versus Reserved distinguished by a small paid glyph, not by color alone.

**B3. Color-by toggle.** Switch the board between coloring by status (open / reserved / assigned) and coloring by owner group (AVD, MAP, RM, JPOD, EJD, NL, GD). The group view makes it obvious at a glance who brought whom.

**B4. Nothing is ever released by deletion.** Releasing a block sets it back to available with an audit row and preserves the prior holder in notes. A block's full history — who held it, when, what changed — is reachable from `/block/[n]`.

---

## PART C — GAME BOARD AND SEASON VIEW

**C1. `/schedule` becomes a proper season view.** All 23 games, grouped by week, with the current or next game auto-selected. Each game as a card:

```
┌──────────────────────────────────────────────────┐
│  G13 · THANKSGIVING · Thu Nov 26, 1:00 PM · CBS  │
│                                                  │
│  ● CHICAGO BEARS              at                 │
│  ● DETROIT LIONS                                 │
│                                                  │
│  Halftime $750  ·  Final $1,500                  │
│  DIGITS NOT ASSIGNED                             │
└──────────────────────────────────────────────────┘
```

- Team names in their colors with swatches
- Holiday games carry a warm accent border and the label — the $1,500 final is why people care about Thanksgiving
- State chip per game: `DATE TBD` amber · `DIGITS NOT ASSIGNED` amber · `DIGITS PUBLISHED` green · `LIVE` pulsing blue · `FINAL` neutral with the winning block
- Once scored, the card shows both winners with block numbers, names, and amounts

**C2. Multiple games in one week get sub-tabs.** Thanksgiving has three, Christmas Day has three. Sub-tabs labeled by matchup — `CHI @ DET`, `PHI @ DAL` — swapping the grid with no page load.

**C3. Season progress strip.** A compressed 23-game timeline across the top of `/schedule`: each game a segment, colored by state, current game marked. Click to jump. This is the whole season at a glance.

---

## PART D — LIVE SCORING AND THE WINNER MOMENT

**D1. `/admin/score` gets the treatment it deserves.** Two number inputs, away and home, each labeled with the team name in that team's color. As digits are typed, the grid preview live-highlights the cell that would win right now.

**D2. Echo-confirm, unchanged and non-negotiable.** Before processing, restate in away-at-home order: `Confirm G01 final: Patriots 14 at Seahawks 27?` No processing without an explicit yes.

**D3. LIVE mode.** A toggle that pushes the current score to the public grid as a pulsing `IF IT ENDED NOW` marker on whichever block would currently win. One boolean, and it is the difference between people checking the app twice and watching it all quarter.

**D4. The winner reveal.** When a game is scored, the winning row and winning column both light at 12% opacity across their full length, converging on the winning cell at 100%. Animate the convergence over 600ms on first paint, then hold. Respect `prefers-reduced-motion`.

- Halftime winner: amber ring, `HALF $750` badge
- Final winner: gold fill, trophy glyph, `FINAL $1,000` or `FINAL $1,500` badge
- Both on the same cell: split diagonal fill, both badges stacked
- The eight cells adjacent to the final winner get a faint 8% accent wash — the near-miss

**D5. Winner panel above the fold on mobile.**

```
🏆  FINAL       Block 13  ·  Breeze          $1,500
🥈  HALFTIME    Block 47  ·  Ant Astorga     $750
```

**D6. Invalid winner handling.** A winning block that is not `assigned` records the score, creates **no payout**, and raises a red review flag naming the block and its actual status. Never pay an unassigned block.

**D7. Score correction recomputes everything.** A payout derives from its game's score. Correct a score and the winning block, winner, and payout row all recompute. Never store a payout that can drift from its game.

---

## PART E — CONDITIONAL COLOR SYSTEM

**E1. One shared token set**, used in every cell, chip, and chart:

| State | Color | Also carries |
|---|---|---|
| Available | slate, dashed | number only |
| Reserved | neutral fill | alias, no paid glyph |
| Assigned | solid surface | alias + paid glyph |
| Halftime winner | amber | `HALF $750` |
| Final winner | gold | trophy + amount |
| Live leader | pulsing blue | `IF IT ENDED NOW` |
| Near miss | 8% accent wash | — |
| Review flag | red | `⚠` |

**E2. Rules that make color usable rather than decorative:**
- Every colored state also carries a glyph or text label, so it survives colorblindness and grayscale
- Review flags override everything and show red regardless of other state
- Every pair clears WCAG 4.5:1 on the dark surface — verify each and fix failures
- Holiday games carry a warm accent that never collides with a winner state

---

## PART F — ADMIN UX

**F1. Every table sorts and filters.** Participants, blocks, payments, games, payouts. Click any column header. Search box across visible columns. Sort state persists in the URL.

**F2. Participants table leads with name**, then alias, group, blocks held, due, paid, balance.

**F3. One unified participant drawer** opening from any row: name, alias, email, phone, group, blocks, payments. No hunting across screens.

**F4. Email is the primary contact field.** Warn visibly on save when a participant has none — several currently do, and that is legitimate for text and in-person signups, but I should know.

**F5. `/admin/emails`** — every participant email with a COPY ALL button producing a comma-separated string for a BCC field. Filters: all, paid, unpaid, missing email. Count and flag the gaps.

**F6. `/admin/list` stays exactly as specced** — the group-chat paste block, plain text, one numbered line per block, `- #N` only when a number is assigned, using `display_alias`.

**F7. Keyboard navigation** on the score entry screen and the block assignment screen.

**F8. Mobile.** Every admin screen usable one-handed. The grid keeps its pinned column and fit-to-width behavior.

---

## PART G — ANALYTICS

**G1. Public dashboard:**
- **Hero** — next game with matchup in team colors, kickoff countdown, state chip
- **Blocks** — `29 committed · 29 placed · 71 open` with a progress bar. Never conflate committed and placed
- **Money** — collected against due, payouts remaining against $44,250
- **Recent winners** — last five payouts with block, name, amount
- **Blocks remaining CTA** — while any block is open, a prominent card linking to `/blocks`. Sales pressure, publicly visible
- **Hot digits** — which digits have produced the most winners this season. Pure fun

**G2. `/winners`** — season leaderboard by total winnings, every payout game by game. Public sees winner and amount; paid-versus-owed is admin-only.

**G3. `/block/[n]`** — one block's whole season. Owner, status, and every game: this block's digits that week, whether it hit halftime or final, what it won. Running total. Bookmarkable — a player keeps it open all season.

**G4. Admin alerts on `/admin`**, in priority order:
- **Red** — a game kicks off within 24 hours and digits are not published
- **Red** — a game is final with no payout recorded
- **Amber** — unconfirmed game dates
- **Amber** — reserved blocks unpaid within 7 days of the claim deadline
- **Blue** — payouts owed and unpaid

---

## PART H — OPEN DATA ITEMS

**H1. Blocks 8, 17, 27, 47 are flagged `carryover, unconfirmed`.** Anthony Esgro's email carried last year's numbers rather than fresh requests. Surface these prominently on `/admin/blocks` with a one-tap `confirm as requested` or `release to pool` action. I am waiting on Scro.

**H2. Rob Gambino's block 99 is reserved and unpaid.** His only $500 Venmo (Aug 17, txn `4665850241799398643`) carries a gas-pump emoji memo, and no second $500 from him exists. Keep the dispute note visible on his participant row and on block 99.

**H3. G19 and G23 have unconfirmed dates.** Christmas Eve and New Year's Eve. Digits cannot be assigned until confirmed — that gate is deliberate and stays. Make the confirm action one tap from `/admin/games`.

**H4. Missing emails.** Several participants have none, which is legitimate for text and in-person signups. List them on `/admin/emails` and never treat a missing email as a defect.

---

## CONSTRAINTS

`payout_mode` is FIXED — $44,250 regardless of blocks sold. **Never mention sellout risk or contingent payouts anywhere in the UI.** Reserved is a hold; only an Assigned block receives a payout. Digits are immutable once written, never assigned when `date_confirmed` is false, never after kickoff, never scored before published. Scores come only from admin entry, echo-confirmed away-at-home. Winner messages contain exactly: `I'll get you paid this week - Venmo or cash.` Payout rows start `owed`; only I mark them `paid`. **The app never moves money.** Names stored verbatim. Ledger append-only. Every write audited in the same transaction. No cascade deletes. Public routes never expose email, phone, or payment amounts. Cross-pool isolation is absolute — never reference or link the Survivor system.

## TESTS

- All 32 team display variants clear WCAG 4.5:1 on the dark surface
- Block filter toggle returns correct counts and persists across navigation
- `available + reserved + assigned + held = 100` after every mutation
- The H2 worked example: rows `3,7,1,9,0,5,2,8,4,6`, cols `8,2,4,0,6,1,9,3,7,5`, home 27, away 14 → block 13
- Assigning digits to a game with `date_confirmed = false` is refused by the database
- Scoring before publish is refused by the database
- A winning block that is not `assigned` creates no payout and raises a review
- A corrected score recomputes the winning block, winner, and payout row
- Duplicate `venmo_txn_id` rejected by the database, not application code
- `New Year's Eve` round-trips through storage, display, and export
- `/admin/list` output contains no markdown artifacts and pastes clean
- A public visitor sees no email, phone, or payment amount on any route
- Committed and placed are computed independently and never conflated

## REPORT

Production URL, current totals, and screenshots of: the grid with team-colored axes, a scored game showing the winner reveal, `/blocks` in each filter mode, the season schedule, and `/admin/list`.
