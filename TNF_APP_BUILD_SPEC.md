# TNF BLOCK POOL APP - COMPLETE BUILD SPECIFICATION

Repo: `tnf`
Owner: Anthony DellaPia
Pool: 1622 TNF Block Pool, 2026 season
Sibling project: the Survivor app (`anthonydellapia1117/Survivor`) - same architecture, same aesthetic, same security model. Read it if you need a reference implementation.

---

## 0. MISSION AND OPERATING RULES

Build a live Thursday Night Football block pool tracker. A 10x10 grid, 100 blocks at $500 each, 23 games, $44,250 in payouts. Players get an anonymous read-only link. Anthony gets an admin surface.

**This must be beautiful.** The grid is the product. Players will open it on their phone during a game, at halftime, and right after the final whistle. If the winning block is not instantly obvious, the app has failed at the one moment it matters.

**Work autonomously inside this repo, its Supabase project, and its Vercel deployment.** Everything is scoped to those three. Do not stop for file creation, migrations, components, or deploys. Stop only for a decision this spec does not answer.

**Commit continuously.** Small descriptive commits, pushed to `main`.

**Done means deployed.** Each phase ends with a live URL that renders correctly on a phone and a laptop.

---

## 1. STACK

Identical to the Survivor app so the two share a mental model.

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| Styling | Tailwind v4 + shadcn/ui |
| Database | Supabase Postgres |
| Auth | Supabase Auth, single admin account, `anthonydellapia@gmail.com` |
| Charts | Recharts, dynamically imported |
| Tables | TanStack Table v8 |
| Excel | `xlsx-js-style` |
| Images | `satori` + `resvg` for winner share cards |
| Deploy | Vercel, push-to-main |

**No service-role key.** Admin reads and writes run as the signed-in session; RLS `is_admin()` enforces at the database. Env vars:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
ADMIN_EMAIL
```

Node 22 pinned in `engines`.

---

## 2. DATA MODEL

### 2.1 Core principle

**Nothing derived is ever stored.** No `amount_paid` column, no `blocks_assigned` count, no cached totals. Every figure is a view computed at read time. This is not a preference - the previous system stored derived money and produced three different totals for the same question in a single report.

### 2.2 Schema

```sql
-- PARTICIPANTS
create table participants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  display_alias text,                  -- what Anthony calls them in the group chat: "Gurt", "Breeze", "Bo-Gang"
  email text,                          -- nullable; text and in-person signups are legitimate
  phone text,
  owner_group text not null default 'AVD'
    check (owner_group in ('AVD','MAP','RM','JPOD','EJD','NL','GD')),
  shared_group_id text,                -- e.g. 'SG-CUGINOS' for Virga + Fowler
  source text not null default 'email' check (source in ('email','text','in_person','import')),
  source_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BLOCKS: exactly 100 rows, seeded 1-100, never inserted or deleted
create table blocks (
  block_number int primary key check (block_number between 1 and 100),
  participant_id uuid references participants(id) on delete set null,
  status text not null default 'available'
    check (status in ('available','reserved','assigned','held')),
  assignment_method text check (assignment_method in ('requested','carryover','random','admin')),
  requested_ref text,                  -- source of the request
  assigned_at timestamptz,
  notes text
);

-- PAYMENTS: append-only. Corrections are new rows. Never edit, never delete.
create table payments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id),   -- null = unmatched, quarantined
  amount_cents int not null,                          -- negative allowed for corrections
  method text not null check (method in ('venmo','cash','check','correction','comp')),
  paid_on date not null,
  venmo_txn_id text unique,                           -- UNIQUE is the dedupe, enforced by the database
  source_ref text,
  note text,
  corrects_payment_id uuid references payments(id),
  created_at timestamptz not null default now()
);

-- GAMES
create table games (
  id uuid primary key default gen_random_uuid(),
  game_no int unique not null,          -- G01..G23
  week int not null,
  kickoff_at timestamptz,
  date_confirmed boolean not null default false,
  game_type text not null check (game_type in ('regular','holiday')),
  holiday_label text,                   -- 'Thanksgiving', 'Christmas Day', "New Year's Eve"
  home_team text not null,
  away_team text not null,
  network text,

  -- digits: each is a 10-element permutation of 0-9
  row_digits int[],                     -- indexed by HOME score last digit
  col_digits int[],                     -- indexed by AWAY score last digit
  digit_seed text,
  digits_assigned_at timestamptz,
  digits_published_at timestamptz,

  -- scoring
  live_home int, live_away int, live_updated_at timestamptz,
  halftime_home int, halftime_away int, halftime_block int, halftime_scored_at timestamptz,
  final_home int, final_away int, final_block int, final_scored_at timestamptz,

  status text not null default 'scheduled'
    check (status in ('scheduled','digits_assigned','published','in_progress','halftime','final','void')),
  notes text
);

-- PAYOUTS: one row per winning event
create table payouts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id),
  payout_type text not null check (payout_type in ('halftime','final')),
  block_number int not null references blocks(block_number),
  participant_id uuid references participants(id),
  amount_cents int not null,
  status text not null default 'owed' check (status in ('owed','paid','void')),
  paid_on date,
  method text,
  note text,
  created_at timestamptz not null default now(),
  unique (game_id, payout_type)
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null, action text not null,
  target_table text not null, target_id text,
  before jsonb, after jsonb, note text
);

create table config (
  id int primary key default 1 check (id = 1),
  price_per_block_cents int not null default 50000,
  blocks_total int not null default 100,
  regular_halftime_cents int not null default 75000,
  regular_final_cents int not null default 100000,
  holiday_halftime_cents int not null default 75000,
  holiday_final_cents int not null default 150000,
  claim_deadline date not null default '2026-09-04',
  timezone text not null default 'America/New_York',
  season_status text not null default 'open'
);
```

### 2.3 Views

```sql
-- Per-participant finance, computed
create view v_participant_finance as
select
  p.id as participant_id,
  count(b.block_number) filter (where b.status in ('reserved','assigned')) as blocks_held,
  count(b.block_number) filter (where b.status = 'assigned') as blocks_assigned,
  count(b.block_number) filter (where b.status in ('reserved','assigned')) * c.price_per_block_cents as amount_due_cents,
  coalesce((select sum(pay.amount_cents) from payments pay where pay.participant_id = p.id), 0) as amount_paid_cents
from participants p
left join blocks b on b.participant_id = p.id
cross join config c
group by p.id, c.price_per_block_cents;

-- Pot
create view v_pot as
select
  (select count(*) from blocks where status = 'available') as available,
  (select count(*) from blocks where status = 'reserved')  as reserved,
  (select count(*) from blocks where status = 'assigned')  as assigned,
  (select coalesce(sum(amount_cents),0) from payments)     as collected_cents,
  (select coalesce(sum(amount_due_cents),0) from v_participant_finance) as due_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'paid') as paid_out_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'owed') as owed_out_cents;

-- Public projection: names only, no contact or money
create view v_public_blocks as
select b.block_number, b.status,
       coalesce(p.display_alias, p.full_name) as display_name
from blocks b left join participants p on p.id = b.participant_id;
```

**Invariant, tested:** available + reserved + assigned + held = 100, always.

### 2.4 RLS

Public reads: `games`, `v_public_blocks`, `payouts` (winner and amount only), `config`. **Never** `participants` raw, `payments`, or `v_participant_finance`. Admin gate is `auth.jwt() ->> 'email' = ADMIN_EMAIL` inside a `SECURITY DEFINER` view, same pattern as the Survivor app - the gate evaluates against the requester's token, so the definer semantics are safe.

---

## 3. BUSINESS RULES - LOCKED

| Rule | Value |
|---|---|
| Price | $500 per block, 100 blocks |
| Payout mode | **FIXED.** $44,250 total regardless of blocks sold. No sellout floor, no contingent scaling. Never mention sellout risk anywhere in the UI |
| Regular game | $750 halftime, $1,000 final. 15 games |
| Holiday game | $750 halftime, $1,500 final. 8 games: 3 Thanksgiving, 1 Christmas Eve, 3 Christmas Day, 1 New Year's Eve |
| Claim deadline | September 4, 2026 |
| Reserved vs Assigned | **Reserved is a hold. Assigned is paid-for.** Only an Assigned block can receive a payout |
| Promotion | Full payment promotes ALL of a participant's Reserved blocks to Assigned in one transaction. Partial payment promotes nothing |
| Payment verification | Never marked paid from a claim. A Venmo transaction ID, or Anthony's explicit cash/check entry. Ledger append-only, corrections are new rows |
| Digits | Row and column are each a permutation of 0-9 with every digit exactly once. **Immutable once written.** Re-randomized fresh for every game |
| Digit gates | Never assign when `date_confirmed = false`. Never assign after kickoff. Never score before `digits_published_at` is set |
| Winning block | `row_index_of(home_last_digit) * 10 + col_index_of(away_last_digit) + 1` |
| Worked example | rows `3,7,1,9,0,5,2,8,4,6`; cols `8,2,4,0,6,1,9,3,7,5`; home 27, away 14 → **block 13.** This is a unit test |
| Score entry | Admin only. Echo-confirm in away-at-home order before processing: `Confirm G01 final: Patriots 14 at Seahawks 27?` |
| Invalid winner | If the winning block is Available, Reserved, or Held: record the score, create **no payout**, raise a review flag. Never pay an unassigned block |
| Payout settlement | Rows start `owed`. Only Anthony marks `paid`. **The app never moves money** |
| Winner message | Any generated winner text contains exactly this line: `I'll get you paid this week - Venmo or cash.` |
| Owner groups | AVD, MAP, RM, JPOD, EJD, NL, GD. No other values. DIRECT was retired 2026-08-28 and folded into AVD (migration 13) |
| Names | Stored verbatim. `display_alias` is what shows publicly when set |

---

## 4. SCREENS

### 4.1 `/grid` - THE CENTERPIECE

Build this first and get it right before anything else exists.

**Navigation**

Week tabs across the top, horizontally scrollable on mobile, with the current week auto-selected. A week containing multiple games (Thanksgiving has three) shows **game sub-tabs beneath the week tabs** - labeled by matchup, not by number: `DAL @ WAS`, `KC @ DET`. Both grids live under that week; switching sub-tabs swaps the grid with no page load.

**Game header** - above every grid:

```
    G12  ·  THANKSGIVING  ·  Thu Nov 26, 4:30 PM ET  ·  CBS
    
    DALLAS COWBOYS          at          WASHINGTON COMMANDERS
         14                                      27
       [away]                                   [home]
       
    Halftime $750  ·  Final $1,500
```

Scores render large. **The last digit of each score is visually emphasized** - full opacity while the leading digits sit at 60% - because the last digit is the only part that matters and showing that teaches the game.

**The grid itself**

```
                    AWAY  →  DALLAS
              8    2    4    0    6    1    9    3    7    5
        ┌───┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
    3   │   │  1 │  2 │  3 │  4 │  5 │  6 │  7 │  8 │  9 │ 10 │
H   7   │   │ 11 │ 12 │[13]│ 14 │ 15 │ 16 │ 17 │ 18 │ 19 │ 20 │
O   1   │   │ 21 │ 22 │ 23 │ ...
M   9   │   │ 31 │ ...
E   ...
```

- **Row header** = home digits, pinned left, never scrolls away
- **Column header** = away digits, pinned top
- Team name and color run along each axis so it is unmistakable which axis is which
- Each cell holds the **block number** and, when space allows, the owner's `display_alias`
- Cell states:

| State | Treatment |
|---|---|
| Available | Dim, dashed border, no name |
| Reserved | Neutral fill, name in muted text |
| Assigned | Solid surface, name in full text |
| Halftime winner | **Amber ring, `HALF $750` badge** |
| Final winner | **Gold fill, trophy glyph, `FINAL $1,500` badge** |
| Both | Split diagonal fill, both badges stacked |
| Live leader | Pulsing blue outline, `IF IT ENDED NOW` label |
| Near miss | The eight cells adjacent to the final winner get a faint 8% accent wash |

**The winner reveal is the moment this app exists for.** When a game is scored, the winning row and winning column both light at 12% opacity across their full length, converging on the winning cell at 100%. Anyone glancing at the phone sees *why* that block won, not just that it did. Animate the convergence over 600ms on first paint, then hold. Respect `prefers-reduced-motion`.

**Winner panel** - directly beneath the grid, before the fold on mobile:

```
  🏆  FINAL       Block 13  ·  Breeze          $1,500
  🥈  HALFTIME    Block 47  ·  Ant Astorga     $750
```

Names use `display_alias`. Amounts in tabular numerals. Tapping a row opens that block's page.

**Pre-publish state.** Before `digits_published_at`, the axes render `?` in every position and the cells show ownership only. This is deliberate - it builds anticipation and prevents anyone from knowing their digits early. When digits publish, they animate in position by position, 40ms apart, left to right.

**Responsive.** At 10 columns the grid needs roughly 360px of cell width. On a 380px phone: 32px cells, block number only, tap for owner. A **fit / comfortable toggle** switches between shrink-to-fit and horizontal-scroll-with-larger-cells. Never collapse the grid to a list - the grid *is* the thing.

### 4.2 `/` - Dashboard

**Hero: next game.** Matchup, kickoff countdown ticking live, network, payout amounts, and a state chip - `DIGITS NOT ASSIGNED` amber, `DIGITS PUBLISHED` green, `LIVE` pulsing blue.

**Four stat cards:** Blocks `26/100` with a progress bar · Collected `$1,500` · Payouts remaining `$44,250 of $44,250` · Next deadline countdown.

**Panels:**
- **Recent winners** - last five payouts, game, block, name, amount
- **Season payout progress** - horizontal stacked bar, paid vs owed vs remaining against $44,250
- **Blocks remaining** - while any block is available, a prominent card: `74 blocks open · $500 each · claim by Sep 4` with a link to `/blocks`. Sales pressure, publicly visible
- **Hot digits** - which digits have produced the most winners this season. Pure fun, no stakes

### 4.3 `/blocks` - The Board

The full 100-block grid at a glance, laid out 10x10 in block-number order (1-10 across the top row). Available blocks are visually loud - dashed, bright, inviting. Taken blocks are quiet, showing the owner's alias.

Toggle between **color by status** and **color by owner group**. Big counter at the top: `74 AVAILABLE`. This screen doubles as the sales tool Anthony pastes into a group chat.

### 4.4 `/block/[n]` - Personal Block Page

One block's whole season. Owner, status, and then every game: this block's digits for that game, whether it hit halftime or final, and what it won. Running total of winnings at the top. Bookmarkable - a player keeps this open all season.

### 4.5 `/schedule` - All 23 Games

Every game: number, week, date, matchup, network, type, and payout amounts. **Holiday games render distinctly** - a warm accent border and the label, because the $1,500 final is the reason people care about Thanksgiving. Digit and score state per row. Unconfirmed dates flagged amber.

### 4.6 `/winners` - Leaderboard

Season standings by total winnings. Every payout listed, game by game. Public sees winner name and amount; **paid vs owed status is admin-only** - nobody needs to know who Anthony has settled with.

### 4.7 Admin

`/admin` overview with alerts, in priority order:
- **Red:** a game kicks off within 24 hours and digits are not published
- **Red:** a game is final and has no payout recorded
- **Amber:** unconfirmed game dates (G19, G23 ship unconfirmed)
- **Amber:** Reserved blocks unpaid within 7 days of the claim deadline
- **Blue:** payouts owed and unpaid

Sub-screens:

| Route | Purpose |
|---|---|
| `/admin/participants` | Add, edit, alias, group, source. Phone-first, same shape as the Survivor `/admin/quick` |
| `/admin/blocks` | Reserve, assign, release. Promote all Reserved to Assigned on a participant when paid. Bulk assign for a multi-block buyer |
| `/admin/payments` | Append-only ledger. Add payment, add correction. Computed balance shown beside the raw ledger so drift is impossible to hide |
| `/admin/games` | Schedule, dates, confirm dates, teams, network |
| `/admin/digits` | Assign digits for a game, preview the grid, then publish as a separate deliberate step |
| `/admin/score` | Enter halftime and final scores with echo-confirm. Live-score mode for in-game updates |
| `/admin/payouts` | Mark owed → paid. Generate the winner message |
| `/admin/list` | The group-chat copy-paste export |

**`/admin/score` deserves care.** Two number inputs, away and home, each labeled with the team name and its color. As digits are typed, the grid preview live-highlights the cell that would win. A confirm step restates it in away-at-home order and will not proceed without an explicit yes. A **LIVE toggle** pushes the current score to the public grid as `IF IT ENDED NOW` - this is the single highest-engagement feature in the app, and it costs one boolean.

**`/admin/list`** outputs exactly this, plain text, no markdown, ready to paste:

```
1622 2026 TNF Block Pool List

Update the list. If multiple entries, put multiple times please. Thank you.

1. Rob Gambino
2. Gurt
3. Stephen Tomiselli - #34
...
```

One numbered line per block. Two blocks means two lines. `- #N` appended only when a block number is assigned. Uses `display_alias`.

### 4.8 Winner share card

`GET /api/card/[gameId]/[type].png` renders a 1200x630 image via satori: matchup, final score with the last digits emphasized, the winning block number large, the winner's alias, the amount, and a miniature grid with the winning cell lit. One tap from the winner panel copies it. This is what gets pasted into the group chat, and it is free marketing for the next season.

---

## 5. DESIGN SYSTEM

**Premium Executive.** Dark first. Dense, sophisticated, no gradient buttons, no decorative shadows.

```css
--bg:         #0B0D0F;
--surface:    #14171A;
--surface-2:  #1C2024;
--border:     #262B31;
--text:       #E8EAED;
--text-muted: #8A9099;

--available:  #3F4650;   /* dim, dashed */
--reserved:   #4A5560;
--assigned:   #1C2024;
--halftime:   #F59E0B;   /* amber */
--final:      #FBBF24;   /* gold */
--live:       #3B82F6;   /* pulsing blue */
--holiday:    #C2410C;   /* warm accent for holiday games */
--accent:     #4F7CFF;
```

**Type:** Inter or Geist. `tabular-nums` on every number without exception - a grid of misaligned digits looks broken. Scale 11 / 12 / 13 / 14 / 16 / 20 / 28 / 40 / 56. The 56 is reserved for live scores.

**Team colors.** Ship a lookup of all 32 NFL primary colors and use them on the grid axes and score display. It costs nothing and makes every game instantly identifiable.

**Density:** 8px base. Grid cells 44px comfortable, 32px fit. Table rows 40px desktop, 48px mobile.

**Borders, not shadows.** 1px `--border` defines every surface. Shadows only on real overlays.

**Motion:** 150ms hover, 200ms layout, 600ms on the winner reveal, 40ms stagger on the digit publish. Nothing else animates. `prefers-reduced-motion` disables the reveal and the stagger, keeping the end state.

**Mobile first everywhere except `/grid`**, which is designed for the grid and adapted down with a pinned first column.

---

## 6. SEED DATA

### 6.1 Config

`price_per_block = $500` · `blocks_total = 100` · `regular = $750/$1,000` · `holiday = $750/$1,500` · `claim_deadline = 2026-09-04` · `timezone = America/New_York`

### 6.2 Games - 23 total

15 regular, 8 holiday. Total payouts must sum to exactly **$44,250** - assert this in a test.

`G01` · Week 1 · **Wed Sep 9, 2026, 8:20 PM ET** · New England Patriots at Seattle Seahawks · NBC · regular

Seed the remaining 22 from `05_SCHEDULE_2026_TNF.csv` if it is in the repo. If not, seed placeholders with `date_confirmed = false` and let Anthony fill them in `/admin/games`.

**`G19` and `G23` ship with `date_confirmed = false`.** G23's `holiday_label` is `New Year's Eve` - the apostrophe has broken string handling in a previous system, so escape it properly and add a test that round-trips it.

### 6.3 Participants and blocks - 26 blocks committed

| Participant | Alias | Blocks | Group | Notes |
> **Historical:** the DIRECT values in this import table are as loaded in August 2026.
> DIRECT was retired on 2026-08-28 and every one of these participants now reads AVD.

|---|---|---|---|---|
| Robert Gambino | Rob Gambino | 1 (#99) | DIRECT | Payment disputed - see below |
| Konnor McGrorty | Gurt | 1 | DIRECT | |
| Stephen Tomiselli | Stephen Tomiselli | 1 (#34) | DIRECT | Carryover from 2025 |
| Marc Virga | Team Cuginos.1 | 1 | AVD | shared_group_id `SG-CUGINOS` |
| Nick Fowler | Team Cuginos.2 | 1 | AVD | shared_group_id `SG-CUGINOS` |
| Jr/Diz | Jr/Diz.1 | 1 (#36) | RM | No email. Identity unresolved |
| Jr/Diz | Jr/Diz.2 | 1 (#38) | RM | Same participant, second block |
| Eric Nards | Eric Nards | 1 (#7) | RM | `En927898@gmail.com` |
| Brian Yost | Brian Yost | 1 | AVD | `brianyost25@gmail.com` |
| Billy Agnes | Breeze (Agnes) | 1 (#28) | DIRECT | `bagnes28@gmail.com` |
| Jerry Gialloreto | Jerry G | 1 | DIRECT | `jpgialloreto@comcast.net` |
| Anthony Astorga | Ant Astorga.1 | 1 | DIRECT | `aastorga44@gmail.com` |
| Anthony Astorga | Ant Astorga.2 | 1 | DIRECT | Second block |
| Anthony Garbarino | Ant Gab | 1 | DIRECT | `anthonygab@comcast.net` |
| Gregory DellaPia | Bo-Gang | 1 | DIRECT | `gregster88@aol.com` |
| Anthony Giletto | Ant Giletto | 1 | DIRECT | `acgiletto@gmail.com` · **PAID** |
| Billy Fulg | Billy Fulg | 1 | DIRECT | No email, committed by text |
| Nicco Esgro | Nicco Esgro | 1 (#15) | DIRECT | `esgro6@gmail.com` · **PAID** |
| Anthony Esgro | Anthony Esgro | 1 (#5) | DIRECT | `anthonye@mmmail.net` · aka "Scro" |
| frank animal | frank animal | 1 (#17) | DIRECT | via Anthony Esgro |
| M & M | M & M | 1 (#27) | DIRECT | via Anthony Esgro |
| Mike capelli | Mike capelli | 1 (#47) | DIRECT | via Anthony Esgro · `mcapellitcb@gmail.com` unverified |
| Tony capelli | Tony capelli | 1 (#8) | DIRECT | via Anthony Esgro |
| Marc Massimino | Marc Massimino | 1 | DIRECT | `mmassimino@msn.com` |
| Anthony Messina | Ant Messina | 1 (#22) | DIRECT | `vafangul@comcast.net` |
| Mario Tropea | Mario Tropea | 1 | DIRECT | `mariocentercity@gmail.com` |
| Nick DiVirgilio | Nick DiVirgilio | 1 | DIRECT | `nicholasdivirgilio125@gmail.com` |

Blocks with a number are **reserved**. Blocks without one are **reserved with no number** - model this by leaving `participant_id` set on no block and tracking the commitment on the participant. **Simplest correct approach: give every committed participant a `blocks_requested` integer, and treat a block row as reserved only when a number is actually chosen.** Add `blocks_requested int not null default 0` to `participants` and compute due from `greatest(blocks_requested, blocks_held)`.

### 6.4 Payments

| Who | Amount | Date | Transaction ID |
|---|---|---|---|
| Nicco Esgro | $500 | 2026-08-21 | `4668875750736929799` |
| Anthony Giletto | $500 | 2026-08-21 | *(pull from Venmo mail)* |

**Do not seed a payment for Rob Gambino.** A $500 Venmo from him exists on Aug 17 (`4665850241799398643`) but its memo is a gas-pump emoji, and no second $500 from him exists. Seed him as **reserved and unpaid**, with a note flagging the dispute for Anthony to resolve.

Block 99 is currently assigned to Gambino from a test in the previous system. Seed it **reserved**, not assigned, since payment is unproven.

---

## 7. LESSONS ENCODED AS TESTS

Each of these is a real failure from the system this replaces. Write a test for every row.

| Failure | Test |
|---|---|
| Stored balance drifted; three totals in one report | No code path writes a derived total. Assert `v_participant_finance` is the only source |
| 14 ledger rows for 3 real payments | `venmo_txn_id UNIQUE` rejects a duplicate at the database, not in app code |
| Corrections double-counted, blank owner IDs | Corrections reference `corrects_payment_id`. Ledger sum equals the pot view exactly |
| Reserved treated as Assigned for payout | A winning block that is not `assigned` produces zero payout rows and raises a review |
| Digits changed after assignment | Update to `row_digits` or `col_digits` when `digits_assigned_at` is set raises an exception |
| Score processed before digits published | Scoring RPC refuses when `digits_published_at` is null |
| Digits assigned for an unconfirmed date | Assignment RPC refuses when `date_confirmed = false` |
| A permutation with a repeated digit | Both arrays must contain 0-9 exactly once; constraint plus test |
| Apostrophe in "New Year's Eve" broke a script | Round-trip test on `holiday_label` |
| Names normalized on write | `display_alias` and `full_name` round-trip verbatim, case preserved |
| Block count drifted from 100 | `available + reserved + assigned + held = 100` after every mutation |
| Contact data leaked to public | A public read of every public route returns no email, phone, or payment amount |
| The H2 worked example | rows `3,7,1,9,0,5,2,8,4,6`, cols `8,2,4,0,6,1,9,3,7,5`, home 27, away 14 → block 13 |

---

## 8. BUILD ORDER

1. **Foundation.** Scaffold, Supabase project, migrations, RLS, seed config and 100 blocks. Deploy an empty shell. Confirm the URL loads.
2. **Data.** Seed games, participants, blocks, payments. Verify the pot view. Write the finance and invariant tests.
3. **The grid.** `/grid` with week tabs, game sub-tabs, all cell states, the winner reveal, mobile pinned column. Nothing else until this is beautiful.
4. **Public.** `/`, `/blocks`, `/block/[n]`, `/schedule`, `/winners`.
5. **Admin.** Auth, participants, blocks, payments, games.
6. **Digits and scoring.** Assignment, publish, echo-confirm scoring, live mode, payout creation. Full test coverage on section 3.
7. **Payouts and exports.** Mark paid, winner message, share card, group-chat list, Excel export.
8. **Polish.** Loading and empty states, error boundaries, Lighthouse ≥ 90 mobile on both `/` and `/grid`.

---

## 9. ACCEPTANCE

1. `/grid` renders a full 10x10 on a 380px phone, legible, with a pinned home-digit column
2. Week tabs work; a week with three games shows three game sub-tabs, each with its own grid
3. Home and away teams are unmistakable on their axes, with team colors
4. A scored game lights the winning row and column, converging on the winner, with the amount visible without scrolling on mobile
5. Halftime and final winners are distinguishable at a glance, including when they are the same cell
6. Pre-publish, digits render `?` and no player can learn their numbers early
7. The H2 worked example returns block 13
8. Assigning digits to a game with `date_confirmed = false` is refused by the database
9. Scoring before publish is refused by the database
10. A winning block that is not `assigned` creates no payout and raises a review
11. Blocks always sum to 100
12. A duplicate `venmo_txn_id` is rejected by the database
13. `/admin/list` output pastes into a group chat with no markdown artifacts
14. A public visitor sees no email, phone, or payment amount on any route
15. Every rule in section 3 has a passing test
16. Lighthouse mobile ≥ 90 performance and 100 accessibility on `/` and `/grid`
