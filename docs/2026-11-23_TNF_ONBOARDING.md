# TNF onboarding - written 2026-11-23

For a person or a Claude session picking this pool up cold. It is a map, not
the rulebook: `CLAUDE.md` is the rulebook and outranks everything here. Every
figure below came from a SELECT on production or a trigger read-back on Mon
Nov 23, 2026, between 10:16 and 10:30 PM ET, and is stale the moment someone
presses a button. Read the live value before acting on any of them. No
address appears in this file, and none ever goes into the repo.

Read in this order: `CLAUDE.md`, `docs/ROUTINES.md`, `docs/DISPATCH_PROMPT.md`,
`docs/GAME_DAY_PROMPT.md`, `docs/RESULTS_PROMPT.md`, `docs/SWEEP_PROMPT.md`,
`docs/INCIDENTS.md`.

## 1. The pool in one screen

- A 100-block football squares pool. 10 holiday games, Thanksgiving Eve to
  New Year's Eve. A block is 250. Every game pays 750 at halftime and 1,500
  at the final. Fixed payout, 22,500 over the season, whatever sells.
- Each game gets its own two rows of digits 0-9. AWAY last digit picks the
  row, HOME last digit picks the column, `block = row * 10 + col + 1`.
- A block is `available`, `reserved` (held, not paid) or `assigned` (paid, or
  comped). **Only an assigned block is paid a win.** A reserved block that
  wins records the score, pays nothing and raises a review flag.
- Ten owner codes say who collects a participant's money and holds it, not
  who recruited them. Anthony (AVD) tracks only money that reaches him.
- The app never moves money. The payments ledger is append-only.
- Stack: Next.js 15, TypeScript, Supabase (Postgres), Vitest. Site
  `https://ad-26-tnf.vercel.app`. Supabase project `bqisojzdwodwaznzwega`.
  Repo `anthonydellapia1117/TNF`, default branch `main`.

## 2. State, as read on 2026-11-23 at 10:16 PM ET

| What | Value | Source |
|---|---|---|
| Blocks | 82 assigned, 18 reserved, 0 available, 100 in all | `blocks` |
| Comped blocks | 3 and 23, both Anthony's | `blocks.comped` |
| Participants | 53 rows, 45 holding at least one block | `participants`, `blocks` |
| Holders' own addresses | 33 distinct. 11 holding participants have no address and get no pool email | `participants` |
| Payment rows | 55: 21 venmo, 30 cash, 4 correction | `payments` |
| Payouts | 0 | `payouts` |
| Games | 10, all `scheduled`, all date-confirmed, none drawn | `games` |
| Digits check | `admin_verify_digits()`: no games listed, `all_ok` true | function |
| `email_sends` | 326 rows, 0 unsent: recruit_broadcast 137, recruit 101, format_change 41, holder_checkin 36, answer 9, game_list 2 | `email_sends` |
| Queue | 19 rows, 1 open: source `crew:esgro`, staged 2026-11-20 | `pending_actions` |
| Prospects | 130 rows, 124 active | `prospects` |
| Audit log | 776 rows, highest id 882 | `audit_log` |
| Migrations | 43 files in the repo; production records 44 rows, the latest `20261124024520 game_day_automation`. The one-row difference was not reconciled on this date | `supabase_migrations.schema_migrations` |
| Config | price 25000 cents, halftime 75000, final 150000 (regular and holiday the same), `claim_deadline` 2026-11-24, timezone America/New_York, `season_mode` false | `config` |

Money in and money owed are admin-only and are not written here: read
`v_pot` with the admin claim.

Blocks by owner code (who collects), from `blocks` joined to `participants`:

| Code | Owner | Address on file | Participants holding | Assigned | Reserved |
|---|---|---|---|---|---|
| AVD | Anthony DellaPia | yes | 20 | 36 | 6 |
| RM | Ronnie Malandro | yes | 20 | 34 | 10 |
| MAP | Michael Pungitore | yes, and one alt | 4 | 10 | 2 |
| JPOD | Julian Podagrosi | yes | 1 | 2 | 0 |
| BG | Billy Guyon | yes | 0 | 0 | 0 |
| EJD | Ernie DellaPia Jr. | yes | 0 | 0 | 0 |
| GD | Gregory DellaPia | yes | 0 | 0 | 0 |
| NL | Nolan Lawrence | yes | 0 | 0 | 0 |
| TJA | TJ Auletto | yes | 0 | 0 | 0 |
| DN | Dom Novelli | **no** | 0 | 0 | 0 |

42 + 44 + 12 + 2 = 100 blocks. 20 + 20 + 4 + 1 = 45 holders.

The schedule, from `games` (kickoff in ET):

| Game | Kickoff | Matchup (away at home) | Network |
|---|---|---|---|
| G01 | Wed Nov 25, 8:00 PM | Green Bay Packers at Los Angeles Rams | Netflix |
| G02 | Thu Nov 26, 1:00 PM | Chicago Bears at Detroit Lions | CBS |
| G03 | Thu Nov 26, 4:30 PM | Philadelphia Eagles at Dallas Cowboys | FOX |
| G04 | Thu Nov 26, 8:20 PM | Kansas City Chiefs at Buffalo Bills | NBC |
| G05 | Fri Nov 27, 3:00 PM | Denver Broncos at Pittsburgh Steelers | Prime Video |
| G06 | Thu Dec 24, 8:15 PM | Houston Texans at Philadelphia Eagles | Prime Video |
| G07 | Fri Dec 25, 1:00 PM | Green Bay Packers at Chicago Bears | Netflix |
| G08 | Fri Dec 25, 4:30 PM | Buffalo Bills at Denver Broncos | Netflix |
| G09 | Fri Dec 25, 8:15 PM | Los Angeles Rams at Seattle Seahawks | Prime Video |
| G10 | Thu Dec 31, 8:15 PM | Baltimore Ravens at Cincinnati Bengals | Prime Video |

## 3. Routines, as read back off each trigger on 2026-11-23

| Routine | Trigger id | Stored cron | On | Connectors | Made via | Prompt |
|---|---|---|---|---|---|---|
| TNF Gmail Sweep | `trig_017vcw3ADZHPVpKVXS1s1B7X` | `CRON_TZ=America/New_York 43 0,7-23 * * *` | yes | Gmail, Supabase | http_api | pointer to `docs/SWEEP_PROMPT.md` |
| TNF Game Day | `trig_01QLquSeCUP8wc3DxPfzzQRY` | `10 14,15,21-23,0-7 1,24-28,31 1,11,12 *` (UTC) | yes | Supabase, Gmail | a session | pointer to `docs/DISPATCH_PROMPT.md` |
| TNF Results (unused, no connectors) | `trig_01CJpJ6NAj9o9TEN1oRSUtwY` | `25 0-7,21-23 1,24-28,31 1,11,12 *` (UTC) | **no** | **none** | a session | pointer to `docs/RESULTS_PROMPT.md` |
| TNF Draw Window | `trig_01TmmBwcxWv5FdJGspjunhn9` | `37 14 22,24,29 11,12 *` (UTC) | **no** | none | a session | its own week-draw prompt, retired |

- **TNF Gmail Sweep** reads pool mail hourly on the :43 from 7:43 AM to
  12:43 AM ET, answers it as Anthony, records Venmo receipts, stages what it
  may not decide at `/admin/queue`, and sends the nightly digest. A session
  cannot edit this trigger (`created via "http_api"`); Anthony edits it in the
  UI. What it does changes by merging `docs/SWEEP_PROMPT.md` to main.
- **TNF Game Day** is the one routine that runs game days. Each fire reads
  `docs/DISPATCH_PROMPT.md` from main and routes by the ET hour: 9 or 10 the
  morning run, 16 to 23 or 0 to 2 the results run, any other hour nothing.
  It runs in the DELLA environment, which holds the three `GMAIL_OAUTH_*`
  variables and has open network (ESPN).
- **TNF Results** can do nothing and is kept only for its record. See
  `docs/INCIDENTS.md`.
- A merge to main is a deploy for every prompt. The trigger itself changes
  only by `update_trigger` (name, cron, enabled, model, prompt) or the UI.
- The live proof of Part O: TNF Game Day was fired by hand at 10:14:46 PM ET
  on Nov 23. Its run record reads succeeded, finished 10:15:17 PM. At that
  hour it takes the results path and finds no game. Every count in section 2
  was read after it and is unchanged from before it.

## 4. Thanksgiving week, day by day

All times ET. Every fire is TNF Game Day. "Morning" is `docs/GAME_DAY_PROMPT.md`,
"results" is `docs/RESULTS_PROMPT.md`.

| Day | Fires | What should happen |
|---|---|---|
| Tue Nov 24 | 9:10 and 10:10 AM morning | The kickoff email, `kickoff_2026-11-24`: To Anthony, Cc RM and MAP, Bcc 32 holders. Nothing is drawn by the routine. 10:10 finds it sent and does nothing |
| | after the kickoff, by hand | **One-time exception (Anthony, 8:27 AM ET, Part P):** G01 drawn and published, and `gameday_2026-11-25` sent, a day early, so Anthony could vet the real thing. See `CLAUDE.md`, the draw rule |
| | 4:10 PM to 2:10 AM results | No game on Nov 24: NO ACTION each hour |
| Wed Nov 25 | 9:10 morning | `admin_draw_day` finds G01 already drawn and published (Nov 24) and does not redraw it; `gameday_2026-11-25` is already sent, so nothing goes. Every other game date follows the normal row: draw, publish and send that morning |
| | 4:10 PM to 7:10 PM results | G01 has not kicked off: waits |
| | 8:10 PM to 12:10 AM results | G01 in play: waits until it is final, then scores it and sends `winners_2026-11-25`, or holds it (below) |
| | 1:10 and 2:10 AM results | Past 12:30 AM a game still not final is staged for Anthony |
| Thu Nov 26 | 9:10 morning | Draws and publishes G02, G03 and G04. `gameday_2026-11-26`, **in the Part R format** (Anthony, 2026-11-25 8:20 PM ET): per game the matchup, kickoff and digits, a grid picture in Comfortable view (a name in every block, from `/api/grid-image?g=<n>`), then all 100 blocks, one line each, with the name on the board, the real name if different, and the holder's email, then the one link. If the block list or a picture cannot be built, the run sends without it and says so; the numbers never wait. Then, if Wednesday's winners email has not gone, one more results run for it |
| | 4:10 PM to 2:10 AM results | Waits until all three games are final (G04 kicks off 8:20 PM; the cutoff is 12:50 AM), scores them, sends `winners_2026-11-26` or holds it |
| Fri Nov 27 | 9:10 morning | Draws and publishes G05. `gameday_2026-11-27`. Then Thursday's winners email again if it has not gone |
| | 4:10 PM to 2:10 AM results | G05 kicks off 3:00 PM; the cutoff is 7:30 PM. Scores it, sends `winners_2026-11-27` or holds it |
| Sat Nov 28 | 9:10 and 10:10 morning | Nothing to draw. Friday's winners email again if it has not gone |

The same pattern repeats Dec 24 (G06), Dec 25 (G07 to G09), Dec 31 (G10) and
the mornings after.

**A held winners email.** The winners email never goes when a winning block
has no payout behind it, which is what happens when a reserved (unpaid) block
wins: it cannot name a payout that is not owed, and it never says a block is
unpaid. The run stages one NEEDS ANTHONY row (`winners:<date>`) and sends
nothing. With 18 of 100 blocks reserved and two winners a game, expect this.
What Anthony does is his call; if he records the payment and re-enters that
score at `/admin/score`, the next results fire sends it.

**Where NEEDS ANTHONY shows up.** `/admin/queue`: `gameday:<date>` from the
morning run, `scores:<date>` and `winners:<date>` from the results run. A
second problem of a kind whose row is already open goes only in that run's
report.

**The fallback if the morning run does not fire.** Anthony draws and
publishes the day at `/admin/digits` before kickoff. The next fire then sends
without redrawing. A game that reaches kickoff with no digits can never be
drawn.

## 5. Commands

```
npm ci
npm run lint
npm run test          # Vitest, 609 tests on this date
npm run test:db       # 31 SQL suites and the race script; needs local postgresql-16
npm run build
```

- `npm run email -- ...` is the only way a TNF email is rendered or sent
  (`scripts/email.mts`). `--dry-run` prints and sends nothing. A send to
  anyone but Anthony needs a claim from the database first. Modes are listed
  at the top of the script.
- `npm run scores -- --day <context file>` reads ESPN and prints the
  `admin_score_game` calls to run. It writes nothing.
- `npm run game-day` builds the old game-day pack as a draft. Manual only.
- Through the Supabase connector every `admin_*` call starts, in the same
  call, with the admin claim `set_config` line in `CLAUDE.md`, Code
  conventions. Without it the call is refused "not authorized".
- Schema changes are new numbered files in `supabase/migrations/`, applied to
  production only after `npm run test:db` passes, then fingerprinted against
  a local build (`md5(prosrc)` per function).

## 6. Invariants

Break one of these and something is wrong, whatever a prompt says.

1. `blocks` has 100 rows; available + reserved + assigned = 100.
2. Blocks in reserved or assigned = the sum of `blocks_requested`.
3. Digits never exist before the morning of their game, are never redrawn,
   and never change once written. The one exception is
   `admin_override_digits`: Anthony's name, a reason, never after a score.
4. `admin_verify_digits().all_ok` is true. Both runs check it first.
5. A game with digits is never deleted, renumbered or scored without them.
6. `payments` is append-only. A correction is a new row.
7. Every email is claimed in `email_sends` before it goes and recorded after.
   One send per event key. The exception is mail to Anthony alone.
8. A day email goes To Anthony, Cc RM and MAP, Bcc holders' own addresses.
   Never an owner's alt, never a holder's `cc_email`.
9. Nothing public shows an address, an amount owed, money in, or the comp
   flag. Anon reads only `v_public_*` and `v_pot`.
10. No address in the repo. No service-role key anywhere.
11. Nothing here ever touches the Survivor pool.

## 7. Boundaries

**A session or routine may, without asking:** reserve, assign or release a
block; record a payment from a Venmo receipt; update a contact; add a
prospect; answer rules and schedule questions; draw and score through the
routine paths; merge under the merge criterion.

**Only Anthony:** money going out; a payment claimed with no receipt; an
identity that could be two people; a release asked for by someone other than
the payer; a change to rules or payouts; a fewer-blocks reply; a winning
block with no payout; a digits override; a routine's model; anything in the
Routines UI.

**Never:** send to a list the envelope did not derive; type a subject or a
body; redraw; delete a row; edit the sweep trigger from a session; store or
address Anthony's work email; read or write anything Survivor; ask anyone to
paste a secret.

**The merge criterion.** Merge-blocking is data loss, a wrong database write,
a send without approval, a credential or address leak, or a failing test.
Everything else is an issue, and the merge goes ahead.

## 8. Failure history

Each of these produced a rule. The rule is in `CLAUDE.md`; this is the index.

| When | What went wrong | The rule it left |
|---|---|---|
| 2026-09-03 | An owner's word that he held a participant's cash was refused as unverified | Owner codes are collection responsibility; an owner's word is the record for his own book |
| 2026-09-03 | Sweeps surfaced a 30 and a 150 Venmo from real participants; both were unrelated | Match on amount first; a non-multiple of the block price is invisible |
| 2026-09-03 | A 1,000 payment for two blocks was ignored by a one-block-only sweep | Expected amount is price x blocks owed |
| 2026-09-04 | The grid shipped transposed against the 2025 grid | HOME across the top, AWAY down the side; labels come from `gridAxes()` |
| 2026-09 | `v_pot` served money owed to anon; then three suites compared against NULL and passed | Withhold from the projection, not the page; every nullable assertion gets an `is null` guard; re-verify a test after a migration |
| 2026-09-08 | A block was released on the word of a holder's cc, not the payer | A third-party release waits for the person whose money it is |
| 2026-09-10 | A migration draft seeded owner addresses into the repo | Addresses live only in the `owners` table |
| 2026-10-08 | The sweep labelled every message done and could not reply; two questions closed unanswered | The sweep runs `docs/SWEEP_PROMPT.md`; Done goes on only after the reply |
| 2026-10-09 to 13 | Every admin call the sweep made was refused: no admin claim | Every `admin_*` call sets the claim first, in the same call |
| 2026-10-08 | A check-in said Paid on status alone | Paid only when the ledger backs it |
| (undated) | A rules draft for another pool was written here from four facts and was wrong | Isolation: nothing Survivor, ever |
| 2026-11-22 | TNF Draw Window's fire failed: account usage limit reached | None yet. See open item 2 |
| 2026-11-23 | A routine made from a session has no connectors and none can be added | Read `mcp_connections` back; `docs/INCIDENTS.md` |
| 2026-11-23 | A doc line said `create_trigger` attaches connectors; it was stale and was trusted | A line about live state is read back, not assumed |

## 9. Identity rules, by code

- **AVD** Anthony. One address on this pool. His comp is blocks 3 and 23.
  Money that reaches him moves the payer to AVD in the same transaction.
- **RM** Ronnie Malandro and **MAP** Michael Pungitore are on Cc of the three
  day emails. MAP has an alt address; it is never addressed.
- **RM's book holds Esgro's crew**: three participant rows (Anthony Esgro,
  frank animal, M & M), 6 blocks, cash with Billy Agnes, who is a former
  participant and not an owner. Nothing is recorded until Anthony's
  `DECISION TNF:` email. frank animal and M & M share one contact and are
  two people. Nicco Esgro is a separate, paid participant.
- **JPOD** Julian Podagrosi holds one participant's cash; that participant
  stays JPOD.
- **DN** Dom Novelli has no address. Any broadcast To every owner refuses
  until it is set or the send names him in the one-time override. The day
  emails do not involve him.
- **BG, EJD, GD, NL, TJA** hold no blocks on this date.
- Two people named Ray are on one thread and are different people. The
  holder is the daughter; her father is her `cc_email` and not a participant.
- A shared address is never by itself a duplicate. A prior season gives
  identity (alias, address), never state (owner, block, count, paid).
- Never invent a full name: mirror the alias and flag it unconfirmed.

## 10. What a new session should check first

1. `TZ=America/New_York date`.
2. Section 2's counts, live.
3. `get_trigger` on TNF Game Day: cron, enabled, `mcp_connections`, the
   pointer, `last_run`.
4. `select event_key, count(*), count(gmail_message_id) from email_sends
   where event_key ~ '^(kickoff|gameday|winners)_' group by 1` to see which
   day emails went.
5. `/admin/queue` for open rows.

## 11. Open items

1. **After Thanksgiving, before Dec 24: move each routine to one
   `npm run ops` command with no improvising.** Today each run is prose an
   agent follows step by step. The target is `npm run ops -- morning`,
   `-- results` and `-- sweep`: the command reads the clock, routes, runs
   every check, makes every write through the same `admin_*` functions, sends
   through the same email module, and prints the report; the routine's whole
   prompt becomes "run this command and print what it prints". It should also
   write one line per run somewhere a session can read (item 4), and bring
   the rehearsal harness into `scripts/` without its data (item 9).
2. **Usage.** TNF Game Day now fires 13 times on each of 20 dates. The fire
   of Nov 23 ran on the account's default model and its own usage record
   shows about 1.00 for a NO ACTION run. The account showed a seven-day
   usage warning that night, and a routine fire failed on a usage limit on
   Nov 22. Pinning a cheaper model on the trigger is Anthony's call.
3. **Manual runs follow the clock.** A fire by hand takes the morning path
   only from 9:00 to 10:59 AM ET and the results path only from 4:00 PM to
   2:59 AM ET. A fix made at noon cannot re-send a game-day email that day.
   Widening the morning route to 3 PM for manual fixes is a one-line change
   to `docs/DISPATCH_PROMPT.md`; not done, because Part O named the hours.
4. **A session cannot read a fired run's report.** No tool here returns
   another session's transcript. The run record gives status and times only.
5. **18 reserved blocks.** A reserved block that wins holds that date's
   winners email (section 4).
6. **11 holders have no address** and get none of the three day emails.
7. **DN has no address.**
8. **The Esgro crew row** is the one open queue row.
9. **The rehearsal harness** (a local Postgres under libfaketime, a
   pseudonymized copy of production, a driver for Tue to Sat and one for the
   dispatcher's hours) lives only in a session scratchpad and will be lost.
10. **Issues:** 43 (the per-day draw rule is not enforced in the database for
    the manual draw function), 44 (`supabase/seed.sql` carries real
    participant addresses, on main since before Part N), 37 (nine `tsc`
    errors in one test file), 35 (a correction that leaves some blocks paid).
11. **Migration count.** Production records 44 migrations against 43 files.
12. **TNF Results** stays paused. If a separate results routine is wanted
    again, see the last line of `docs/INCIDENTS.md`.
