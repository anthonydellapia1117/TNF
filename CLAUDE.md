# 1622 TNF Block Pool — operating rules

Standing rules for anyone (human or agent) working on this pool. These are
Anthony's calls, not inferences. Do not relax one without him saying so.

## The season (restructured 2026-09-08)

- **The 2026 pool is the 10 holiday games only**, Thanksgiving Eve through
  New Year's Eve: G01 Wed Nov 25, G02-G04 Thanksgiving Day, G05 Black
  Friday, G06 Christmas Eve, G07-G09 Christmas Day, G10 New Year's Eve.
  Weeks 12, 16 and 17. Every game is `game_type = 'holiday'`. The 23-game
  Thursday slate that ran from Sep 9 is gone; nothing happens before
  November 25.
- **One payout tier.** $750 halftime, $1,500 final, every game, since the
  250 format (2026-11-10; $1,500 and $3,000 before). The four config keys
  still exist and all carry the same numbers (`admin_set_format`, migration
  40), so the regular/holiday split is harmless wherever an older path still
  reads it. `payoutCents()` in `src/lib/pool.ts` ignores `game_type`.
- **$250 a block since 2026-11-10.** 100 x $250 = $25,000 in. 10 x $2,250 =
  $22,500 out. House $2,500. Break-even 90 paying blocks. Expected payout
  per block $225. None of these is stored; each derives from the games
  table and config. tests/sql/28 asserts the $22,500 after the switch; the
  older unit and SQL fixtures still run at $500, which is their fixture.
- **The 250 format (Anthony, 2026-11-10, Part J).** The pool was cut to 50
  held blocks (62 and 64 released, the Cuginos removed and excluded from
  every send list; 32, 5, 25 and 93 released; Dennis Bell removed), then the
  price went from $500 to $250 and every holder's block count doubled for
  the same money: one new block per held block, same holder, same status
  (assigned stays assigned, reserved stays reserved), never comped, drawn by
  `admin_double_holdings` with seed `tnf-2026-blockdraw-27`, the seed and
  the free list in its audit row. Never run the doubling again: a second
  one would leave every assigned block short, and the function refuses it.
- **Poultry and PAAA M (Anthony, 2026-11-10, Part K).** Block 25, first
  placed on Anthony's row for his father, moved to the **Ernie DellaPia Sr**
  row, assigned on his $500 (2 x $250). Ernie and Vincent Angiolillo swapped
  12 and 14, Ernie's 66 went to Perry T (MAP), and Perry's 23 came to Anthony
  as **"PAAA M", comped**. Each move was a release (prior holder kept in the
  block's notes) and a reserve, method `requested` with a Part K ref, and
  status followed the participant. No `blocks_requested` changed.
  - Anthony's comp was blocks 3 ("AAA") and 23 ("PAAA M"), both comped:
    his original free $500 block, two blocks at $250. **It ended 2026-11-26
    (Part S): both went to Mark/Santos, paid. No block is comped now.** Ernie
    Sr holds 12 and 25, both rendering "Philadelphia Poultry" (25 by its own
    name, 12 by his alias).
- **Mark/Santos on 3 and 23 (Anthony, 2026-11-26 12:41 PM ET, Part S, his
  words in the Ron/Mike group text).** "Mark / santos is on me. I said done
  but never added them in. They never were put on the board." Ron confirmed
  they paid him. "Ok they can take my two spots 3 and 23." One RM row, board
  name **Mark/Santos**, full name "Mark Galasso / Santos": **Santos's full
  name is unknown; never guess it.** Two blocks, 500 cash held by RM (owner-
  held, like the Sep 4 RM rows, so the row stays RM). Blocks 3 and 23 were
  released from Anthony (notes keep "was comped" and the old names),
  reserved to Mark/Santos and promoted on the payment, all at 12:43 PM ET,
  before G02's 1:00 PM kickoff, so they count from G02. Anthony's row stays
  with `blocks_requested` 0 and a dated note (the F Chili precedent); it had
  no payment rows. Mark got one note email (`note_2026-11-26_mark-santos`,
  below) with that day's three grids.
- **The format email (Anthony, 2026-11-10, Part L).** Sent once, approved by
  Anthony at 12:38 PM ET in the TNF PM chat (the approval is on its claim's
  audit row). It told every holder that a block is now $250, that $500 buys
  2 blocks, and that **a holder who wants fewer blocks replies by Sunday,
  Nov 15 and gets $250 back (or owes $250 less) per block dropped.** Every
  such reply, a holder who wants none included, is Anthony's call: the sweep
  stages it to `/admin/queue` as NEEDS ANTHONY (`docs/SWEEP_PROMPT.md` 8b)
  and never releases a block, changes a count, stages a refund or sends T4
  for it.
- **Esgro's crew (Anthony, 2026-11-20, Part M).** Three RM participant
  rows, **all on file**: **Anthony Esgro** ("Scro", blocks 11 and 28),
  **frank animal** (63 and 80) and **M & M** (70 and 77). 6 blocks, $1,500
  at $250. The cash is held by **Billy Agnes**, a former participant and not
  an owner, for Anthony to collect. Until Anthony's `DECISION TNF:` email
  records it, nothing is recorded and no block is promoted, whatever Esgro or
  Billy writes.
  - **Nicco Esgro is a separate participant** (blocks 15 and 24), paid $500
    by Venmo on 2026-08-21. That payment covers his own two blocks and
    nobody else's.
  - **The sweep reads any Esgro mail as about all three rows and keeps at
    most one open queue row for the crew's money** (`docs/SWEEP_PROMPT.md`
    8c): "Esgro crew 1,500 with Billy Agnes - Anthony to collect; DECISION
    email records it." The six per-message rows it staged from Oct 26 to Nov
    18 were dismissed as superseded by that one on 2026-11-20. A Venmo
    receipt, a fewer-blocks request or a release asked for by someone else is
    a different decision and gets its own row, as it would for anyone. The
    money is recorded by one `DECISION TNF:` payment per crew member, each
    for that member's own balance ($500 each today; the grammar takes no
    combined amount, and one Venmo transaction id can sit on only one
    payment row). The crew row's source is the fixed key `crew:esgro`, so
    the database refuses a second open one. Once none of the three owes anything, crew mail goes
    back to the ordinary steps. Crew money mail stays unlabelled while the
    crew row is open, as 8b does with fewer-blocks mail.
  - The sweep's "two of whom are not on file" was wrong: frank animal and
    M & M are on file. They share one contact address and are two people
    (Anthony, 2026-08-24).
- **Thanksgiving game-day automation (Anthony, 2026-11-23, Part N).**
  Digits are drawn and published per day by the morning run, scores come in
  from ESPN's public scoreboard through `admin_score_game`, and the kickoff,
  game-day and winners emails go out on their own, once each. The rules are
  under *Data* (digits) and *Email to the pool* below; the routines are in
  `docs/ROUTINES.md`. Scores are taken only when ESPN says final and every
  period adds up to the total. Only a game not final (or not yet kicked off),
  or ESPN not answering, waits: until 4 hours 30 minutes after the date's last
  kickoff the results run tries again at the next fire, and after that it is
  NEEDS ANTHONY. Any other problem is NEEDS ANTHONY at once. Either way
  nothing is sent, and for a score problem Anthony enters the scores at
  `/admin/score`. Each routine stages its NEEDS ANTHONY at `/admin/queue`, a failed clone or install
  included: the results run one row per problem class and date
  (`scores:<date>`, `winners:<date>`), saying what he does for that problem,
  and the morning run one row per date (`gameday:<date>`) on a game date or
  the claim deadline. A game that reaches kickoff with no digits can never be
  drawn; it is Anthony's call.
- **One routine runs both runs (Anthony, 2026-11-23, Part O, approved in the
  TNF PM chat at 9:59 PM ET).** TNF Game Day fires at 9:10 and 10:10 AM ET
  and hourly from 4:10 PM to 2:10 AM ET on the game dates and the nights
  after, and `docs/DISPATCH_PROMPT.md` routes each fire by the ET hour and by
  nothing else: hour 9 or 10 is the morning run (`docs/GAME_DAY_PROMPT.md`),
  hour 16 to 23 or 0 to 2 is the results run (`docs/RESULTS_PROMPT.md`), and
  any other hour does nothing. After the morning run, the 9:10 and 10:10
  fires also follow the results run when yesterday had a game and its winners
  email has not gone. A fire by hand follows the same clock.
  - **Why: a routine made from a session came out with no connectors, and
    none can be added.** TNF Results was made that way on 2026-11-23, with
    `create_trigger`. It is
    paused, renamed "TNF Results (unused, no connectors)" and never deleted.
    Before relying on a routine, read `mcp_connections` back off its trigger.
    `docs/INCIDENTS.md` has the incident.
- **The September digits are void and live only in the archive.** The
  digits drawn and published for the September G01 and G02 were archived
  by migration 24 as `audit_log` rows with action
  `season_restructure_archive`, one full game row each, 23 rows, before the
  games were deleted. Digits are still immutable: nothing edited them, the
  rows went whole. Never rewrite those audit rows; never reuse those digits.
- **Claim and payment deadline is Tuesday November 24, 2026** (`config.
  claim_deadline`). The September 4 deadline is history.
- **Removing a participant at their own request** (precedent 2026-09-08,
  F Chili on block 78): release the block the way
  `admin_release_block` does, prior holder kept in the block's notes; the
  participant row is never deleted and the schema has no inactive flag, so
  the row stays with `blocks_requested = 0` and a dated note. A payment on
  file is never touched: the refund is Anthony's call, staged as a
  `refund_needed` row at `/admin/queue` with the amount and the Venmo
  transaction id. Audit rows: `participant_removed` on the block and on the
  participant, `stage_pending` on the queue row.
- **A release asked for by a THIRD PARTY is provisional until the person
  whose money it is confirms it.** Ask them first. Until they answer, the
  block stays where it is: do not release it, do not stage a refund, do not
  let the roster move on somebody else's say-so.
  - The precedent is nerdz, block 1, and it is why the line above no longer
    names her. On 2026-09-08 Ray Vassallo, the `cc_email` on her
    participant row, asked
    Anthony to release "the box you were holding for us", believing there
    were two blocks and one was his. There was only ever one and it was his
    daughter's: **Raychel Neil**, whose own address is on her
    participant row, asked for one
    block under nerdz on 2026-09-03 and paid $500 the same day, venmo txn
    4678217450148051522. Block 1 was released on 2026-09-09 and a
    `refund_needed` row staged. She wrote on 2026-09-09 saying she never
    went in with her father, and by then she had also been dropped from the
    roster before the season-change announcement, so she was never told the
    pool had changed. Reversed 2026-09-10: block 1 restored and assigned,
    refund row dismissed, **no new payment row** (hers was never removed and
    the ledger is append-only), and she was written to directly.
  - Ray Vassallo is **not** a TNF participant and never was. He is her
    `cc_email` and nothing more. **Two Rays are on that thread and they are
    different people**: never merge them, and never read a request from the
    cc as a request from the holder.
  - The tell is money. The person who paid is the person whose block it is,
    whatever the relationship. If the request comes from an address that is
    not the payer's, that is a question, not an instruction.

## Owner codes and how money is actually collected

**The ten owner codes — AVD, RM, MAP, JPOD, EJD, NL, GD, BG, TJA, DN — are
collection responsibility, not provenance.** They do not record who introduced someone
or who they emailed. They record *which owner collects that participant's
block money and holds it*.

How the pool actually runs:

- Each owner collects from his own participants and **holds that cash**.
- Each owner **pays his own winners out of what he is holding**, first.
- If an owner runs dry, the other owners cover it between them.
- At season end it reconciles per owner: his participants' blocks × the
  block price against what that owner paid out.

Three things follow, and getting them wrong is expensive:

1. **An owner's word IS the payment record for his own book.** When JPOD
   says he has Konnor's money, Konnor is paid — the money is in the pool,
   JPOD is holding it, and if block 51 hits, JPOD pays it. No other owner is
   exposed. This is an honour system among the owners and has always worked
   that way. Record it: method `cash`, `source_ref` naming the owner.
2. **`collected_cents` means collected by the pool, not cash in Anthony's
   hand.** Money held by RM or JPOD is collected. Do not reason about the
   house position as though only Anthony's own receipts count.
3. **An owner code is not evidence of how someone joined.** Asking "did this
   person come to Anthony directly?" is a different question from "who
   collects from them", and the code answers only the second.

**This does not weaken the rule against inventing data.** A relaying *owner*
confirming his *own* participant paid is a source. A guess is not, and
neither is a third party's word about someone else's book. The line is
whether the person confirming is the owner responsible for collecting that
participant's money.

Precedent (2026-09-03): Julian Podagrosi (JPOD) told Anthony he was holding
Konnor McGrorty's $500. It was first refused as an unverified claim, on the
assumption that owner codes were provenance and only Anthony's own receipts
counted as collected. Both assumptions were wrong. It was recorded as cash
held by JPOD, and block 51 promoted to assigned.

### When someone pays Anthony instead of their own owner

**Money that reaches Anthony moves the participant to AVD. Automatically, in
the same transaction as the payment, with no confirmation step.** The owner
code records who collects and holds the money. If Anthony collected it, the
block is in Anthony's book, and AVD is what that means. The money and the
book are never apart, so there is never a gap to flag.

- Recording a payment that came into Anthony's Venmo for a participant who
  is not already AVD: **move them, in the same operation. Audit both.**
  Do not ask first. Tell Anthony it was done.
- Because the two never separate, there is **no reconciliation flag** for
  this case any more. Don't write one, and don't re-raise a cleared one.
- The losing owner is not short. His headcount drops by exactly the block
  that left, at the same moment. Recruiting is not collecting.

**The exception: cash held by another owner does not move anyone.** When an
owner collects and holds his own participant's money, that owner is doing the
collecting and keeps the code — Konnor McGrorty stays JPOD because Julian is
holding his money. Only money that actually reached Anthony moves anyone.

**Read the exception by who SENT it, not by whose name is in the memo.** A
block payment by Venmo from the participant is Anthony collecting. The same
Venmo from another *owner*, forwarding what he already collected, is that owner
collecting and does not move the participant — it is the Konnor case
arriving by Venmo instead of by hand. If the sender is an owner rather than
the participant, ask Anthony rather than moving anyone.

### Anthony tracks his own money only (2026-09-10)

**The pool's money scope is Anthony's own money: what reaches or leaves his
Venmo, cash in his hand, or a check made out to him. Nothing else.**

- **An owner holding cash for his own book is that owner's business.** Do not
  chase it, do not compute what an owner owes a participant, do not stage a
  queue row about it, and do not put it in the digest. Assume every
  owner-to-participant payment and refund has already happened.
- Precedent, the row this rule retired: a queue row said Mike Pungitore owed
  Billy Agnes $500 back after block 28 was released. Dismissed 2026-09-10,
  "owner-held cash, out of scope per 2026-09-10". MAP's ledger was not touched
  and no refund row was written. `owner_owes_refund` is no longer a kind the
  sweep may stage.
- **An owner code still does not decide whose money it is.** A Venmo receipt
  into Anthony's account from a participant in ANY book is Anthony's money: it
  gets recorded, and the participant moves to AVD under the rule above. That
  behaviour is unchanged.
- **Outstanding, due and collected stay whole-pool figures.** Never filter them
  by owner code. What narrows is the chasing and the notifications, not the
  arithmetic: `collected_cents` still means collected by the pool, cash an
  owner holds included.

Supersedes the confirm-with-the-owner-first version of this rule, set
2026-09-03 and replaced the same evening. Anthony's reasoning for the
change: the code means collection responsibility, so if he collected it, it
is his; asking the other owner first was ceremony, not control.

Precedent (2026-09-03): five participants moved to AVD for this reason.
Vincent Angiolillo (RM) and Joe Longo (JPOD) were moved under the older
confirm-first version, after Anthony spoke to Ronnie and Julian. Eric
Nardini (RM), Dan DeSilvio (MAP) and Anthony Astorga (MAP, two blocks) were
moved under this one, on the payments alone. Astorga is the worked example
of the whole rule: he had been moved AVD -> MAP that same day on Anthony's
call, explicitly because the ledger showed no money from him in Anthony's
book — and when his $1,000 arrived hours later, the condition that made MAP
right had flipped, so the code followed the cash back. RM went 23 to 21,
JPOD 2 to 1, MAP 10 to 7, AVD 20 to 26.

## Payment sweeps

**A block costs `config.price_per_block_cents` flat, $250 since the 250
format (2026-11-10, $500 before), so the candidate amount for a participant
is the price x the blocks he actually owes for.** Two blocks is $500, four
is $1,000. A comped block owes $0 and is excluded from that count — the
expected amount is his `due_cents`, not his headcount. Every holder's block
count doubled for the same money on 2026-11-10, so a holder owes what he
owed before.

For the single-block holders it replaced, this was exactly the old
$500-only rule. Since the doubling every holder holds two or more, so a
payment for part of a holding (250 from a two-block holder) is outcome 2,
a question, never a payment. The rule exists to stop the pool
losing a real payment: Anthony Astorga settled both his blocks with one
$1,000 Venmo on 2026-09-03, a full and unambiguous payment that a
$500-only sweep is instructed to ignore. Anthony had to point it out by
hand.

Three outcomes, and only three:

1. **Matches a participant's expected amount** — a real candidate. Verify
   the receipt and record it.
2. **Matches no participant's expected amount, but is a clean multiple of
   the block price ($250)** — surface it as **"non-matching multiple, needs
   review"** and stop. Do not record it and do not guess who it belongs to.
   This is someone paying for a friend, or a four-block holder sending $500
   for two of them. It needs Anthony, not a decision.
3. **Not a multiple of the block price ($250)** — not a block payment. Invisible. Do not
   surface it, flag it, or record it as a partial one, whatever name is on
   it, unless Anthony says otherwise for that specific transaction.

Rule 3 is the one learned the hard way: two sweeps surfaced a $30 and a
$150 Venmo from people who *are* participants, and both turned out to be
unrelated (a Survivor entry fee and personal money). Reporting them cost
Anthony two round trips to chase nothing. Neither is a multiple of $250, so
both stay invisible under the amounts rule above — widening it to block
count reopens nothing.

- Match on **amount first**. A name on a non-multiple transaction is still
  not a signal.
- There are no partial payments. A block is paid or it is not — a part
  payment lands in outcome 2 and goes to Anthony as a question.
- Resolved false positives are recorded in the participant's notes with the
  transaction ID and "do not re-flag." Honour those notes.
- Sweep by fetching threads in full (`get_thread`), never from search
  previews — previews show only the ~5 oldest messages of a thread and have
  hidden real commitments before.
- **A sweep only sees money that reached Anthony.** Cash held by another
  owner never appears in his Venmo or his mail, and its absence from a
  sweep is not evidence that a participant is unpaid. See *Owner codes and
  how money is actually collected* above.

## Money

- `payout_mode` is **FIXED at $22,500** regardless of blocks sold (10 games
  x $2,250 since 2026-11-10; $45,000 from 2026-09-08). Never surface sellout risk or contingent
  payouts anywhere in the UI.
- The app never moves money. The payments ledger is append-only; corrections
  are new rows, never edits.
- **A correction that leaves an assigned block unpaid moves it back.**
  Anthony asked, 2026-10-26 (Part H2), for blocks 11, 63 and 70 to go from
  assigned to reserved with their holders kept once their RM rows were
  reversed. Migration 39 does it with `admin_demote_if_unpaid`, and
  `admin_record_payment` calls it after every row that takes money away, a
  correction or any negative amount, and refuses a correction booked on a
  participant other than the one whose row it corrects (that wiring and the
  check came from the review of PR 31, so the /admin/payments form is covered
  too). Only
  his assigned, non-comped blocks are judged, against the whole blocks his
  payment rows pay for: if they pay for none, every one goes back to
  reserved, holder and name kept; if some but not all, the correction is
  refused, because which block keeps its payout is Anthony's call (release
  the block that goes, then record it again; keeping both is open as issue
  35); a block with a payout to him is refused too. A reserved or requested
  block never makes a paid one look short. Never release and re-reserve a
  block to the same holder to demote it: release writes "Released from" into
  the block's notes.
- Committed is a real **count** of blocks, never money divided by price — a
  comped block owes $0 but is still committed.
- Break-even is **90 paying blocks** ($22,500 / $250). Comped blocks are
  excluded from that count. This lives on /admin only and is never public.

## The claim deadline

The claim and payment deadline is **Tuesday November 24, 2026**, the day
before the first game (it was September 4 until the 2026-09-08
restructure). It governs who has settled, and nothing else. In particular
it does not move blocks.

- **Unpaid Reserved blocks are NOT released at the deadline.** They stay
  Reserved and they get chased. There is no automatic release, expiry, or
  reassignment on any date, and no scheduled job that performs one.
- **An unpaid block at kickoff records the score, produces no payout, and
  raises a review flag.** That is the existing Reserved-versus-Assigned rule
  operating normally — only an Assigned block receives a payout. It needs no
  new logic and no new code path. Do not write one.
- Participants were told before the deadline that only a paid block wins.
- **Releasing a block stays a deliberate admin action** through
  `admin_release_block`, taken case by case. Never triggered by a date.

## Public surfaces

- Never expose email, phone, or amounts owed. Names and block numbers only.
- Total payout liability never appears on a public route.
- The comp flag is admin-only and appears in no public projection.
- Green means one thing on the public grid: **a winner.**
- **The viewer side is for a TNF fan, not an administrator.** Collection
  status, the committed-blocks count and the claim CTA are not viewer
  surfaces at all — they live on `/admin` only. So do the price line, the
  claim-by date and the claimed/unclaimed split that `/blocks` carried until
  2026-09-04: claimed versus unclaimed is Anthony's paid-versus-unpaid
  tracker, and `/blocks` is not where he keeps it. `DashboardPanel` in
  `src/lib/season-mode.ts` has no name for them, so a public panel for
  collected money or a headcount cannot be returned by construction.
  Viewer widgets answer fan questions instead: hot and never-won digits,
  close calls, score patterns, the next holiday game. Nothing about money
  owed, payment status, or how many people are in.
- **`/grid` is the one link (Anthony, 2026-11-24, Part Q).** Every template
  and every reply links `https://ad-26-tnf.vercel.app/grid` and nothing else
  (`GRID_URL` in `src/lib/email/copy.ts`); `/grid?g=N` links already sent keep
  working. Without `?g=` it opens on a game being played, else today's game in
  ET, else the next one (`defaultGridGame` in `src/lib/grid-search.ts`). It has
  a live name search: any part of the name the board shows, any case, every
  match filled yellow, a count and each block's digits under the box. It
  searches only `v_public_blocks.display_name`, never a full name the board does
  not show. Names never depend on hover: Comfortable shows them in the block,
  and a tap in either view shows the block's name above the grid. Why: holders
  could not find their own name on a phone, where the old title tooltip never
  shows, and three different links had gone out.
- **The plain-text list is admin-only** (`/admin/list`). There is no public
  `/list` route and no List item in the public nav — it is a chase tool.
  `/players` stays public as the roster.
- **`season_mode` (config, admin toggle, default off)** now governs only the
  remaining pre-season surfaces: the claim-by deadline card on the home
  page, the block-is-open nudge on `/block/[n]`, the "BLOCKS OPEN" headline
  on the og image, and two meta descriptions. On, the home page also leads
  with a grid panel. The decision lives in `src/lib/season-mode.ts`; no
  surface should ask the question itself.
- **`/blocks` is the availability board and keeps its counts in both
  modes** — the big AVAILABLE figure, the legend tallies and the
  Open/Taken filter counts. Showing what is open is that page's purpose.
  The same number was removed from the *home* page, where it read as a pool
  that did not fill. These two are not in conflict; do not "fix" one to
  match the other.
- **`/blocks` shows placement, never collection.** Open and Taken are the
  only status words on the public board: no price, no claim-by date, no call
  to action, and the word "claim" appears nowhere in its public DOM. An open
  tile is a number with no name. The board filter's mode value is `taken`,
  not `claimed`, so a remembered `claimed` from an older visit falls back to
  ALL. Set 2026-09-04; before that the page carried "$500 each - claim by
  Sep 4" and an OPEN/CLAIMED toggle, which read as a payment tracker.
- **A number withheld from the public must be withheld from the
  projection, not just the page.** `v_pot` is a definer view readable by
  anon, so anything left in it is public whether or not a page renders it —
  it was serving `due_cents` ($24,000 owed) and `owed_out_cents` to anyone
  who curled the REST endpoint. Money in and money owed
  (`collected_cents`, `due_cents`, `owed_out_cents`) are all null for a
  non-admin caller, in either mode. Money OUT (`paid_out_cents`) stays
  public — it is the same winner history `/winners` publishes by name.
  Block counts stay public because `/blocks` computes "51 open" from them
  and the per-cell statuses are public anyway.
- **There is no gate on any public route, by design.** No invite code, no
  password, no Vercel deployment protection (password, SSO and trusted-IP
  are all off, verified 2026-09-03). `/admin` is the only gated surface.
  If anyone reports being asked for a code, it is not this app.

## Data

- Never delete. Releasing a block preserves the prior holder in its notes;
  retiring a value keeps the history that referenced it. The audit log
  records what was true at the time and is never rewritten.
- Digits are immutable once written, never assigned when `date_confirmed`
  is false or after kickoff, and never scored before publication.
- **Grid orientation: HOME across the top, AWAY down the left side.** The
  AWAY last digit selects the row, the HOME last digit selects the column,
  and `block = row*10 + col + 1` numbering left to right then top to bottom
  (so block 11 is row 2, column 1).
  - **The reason is the 2025 grid.** Anthony built it by hand, every prior
    season looked the same, and 47 people read it from habit without
    checking the axis labels. Neither orientation is more correct
    arithmetically; the app was simply the newcomer and it shipped
    transposed. Reversed 2026-09-04 by migration 17, with 0 of the 23
    games then on the slate drawn, 0 published, 0 scored and 0 payouts —
    there was no history to invalidate, and there will be after the first
    draw.
  - **Do not flip it back reasoning from an older spec or an older comment.**
    The pre-reversal formula was `row_index(home) * 10 + col_index(away) + 1`
    and its worked example returned block 13; that example now returns 89.
    If you find a copy still saying 13, it predates the reversal.
  - `row_digits` and `col_digits` are named for the AXIS, not the team:
    `row_digits` is the vertical axis (away), `col_digits` the horizontal
    (home). Same for the `rowDigits`/`colDigits` arguments in `src/lib/pool.ts`.
  - The rendered labels come from `gridAxes()` in `src/lib/pool.ts`, which is
    unit-tested against `winningBlock`. Hardcoding home/away in the grid
    component is how the screen and the payout drift apart: the money would
    still be right while every player read the wrong digit pair. Swapping the
    labels inside the component broke no test until `gridAxes` existed.
- **Digits are assigned to the two axes, not to blocks.** Each axis is a
  permutation of 0-9, so all 100 cells receive numbers regardless of how many
  blocks are sold or paid. The claim deadline never gates digit assignment.
  What the deadline governs is how many cells are *payable*, since only an
  Assigned block produces a payout. This is a mechanical statement about how
  digits are assigned — it is not a statement about pool health, and nothing
  here is a reason to surface one.
- **Digits are drawn one day at a time, on the morning they are needed**
  (Anthony, 2026-11-23, Part N; they were drawn a week at a time). This is a
  rule about the data, not a convenience of the screen. Digits that exist
  early are digits someone could see or alter; under this model they do not
  exist until the morning of their game. Anthony considered pre-generating the
  whole season on 2026-09-03 and decided against it for that reason.
  - **A game is drawn only on its own kickoff date in ET, before kickoff.** On
    each game date the 9:10 AM ET morning run (TNF Game Day,
    `docs/GAME_DAY_PROMPT.md`) calls `admin_draw_day` once (migration 43). It
    draws only that date's games, each its own independent draw with fresh
    randomness (`gen_random_uuid`, a strong source), and **publishes them at
    once**: the two-click review and the 8:00 AM ET reveal slot are retired.
    A drawn game is never redrawn, and a repeat call changes nothing.
  - The draw days: Nov 25 (G01), Nov 26 (G02, G03 and G04, whose 8:20 PM ET
    kickoff is Nov 26 in ET), Nov 27 (G05), Dec 24 (G06), Dec 25 (G07-G09),
    Dec 31 (G10). Nothing is drawn before Nov 25, with one exception below.
  - **The one exception: G01, Tue Nov 24, 2026 (Anthony, 8:27 AM ET, Part P,
    approved in the TNF PM chat).** So he had a full day to vet the real
    thing, G01 was drawn and published, and its game-day email
    (`gameday_2026-11-25`) sent, one day early, on Nov 24, after the kickoff
    email went. Once only. From G02 on every game is drawn and sent on its own
    morning, as above. The draw went through `admin_assign_digits` and
    `admin_publish_digits` with the admin claim; `admin_draw_day`, the routine
    prompts and the per-day gate on `/admin/digits` did not change. The send
    needed one narrow exception for that one key on that one ET date, in the
    renderer (`EARLY_SENDS` in `src/lib/email/registry.ts`) and in the claim's
    `email_day_not_ready` (migration 44). It expires by itself, since the
    database date is never Nov 24, 2026 again; there is no flag and no revert.
    The morning run of Nov 25 found G01 drawn and the email sent and did
    neither again; `winners_2026-11-25` goes after the game as usual. Never
    add a second early key without Anthony saying so for that game.
  - **The manual fallback stays.** Anthony can draw and publish a day at
    `/admin/digits`: the same per-day gate lives in `src/lib/week-digits.ts`
    and is re-checked in both server actions against games read from the
    database (the per-game one did not re-check before Part N). The morning
    run then publishes anything he drew and left unpublished and sends
    without redrawing. The screen still groups games by week; that is
    navigation only.
  - Every game is its own independent draw: no shared seed and no
    relationship to any prior game. Never batch them into one draw.
  - **The lock.** `games_digits_immutable` keeps rows, columns, seed and
    assigned-at fixed once drawn, from every role and path, a raw UPDATE
    included, and keeps a revealed reveal time fixed, so a past grid cannot
    be hidden again. The single exception is `admin_override_digits`:
    Anthony's alone, with a reason, writing its own `digits_override` audit
    row (before and after hashes) in the same transaction, and never once a
    game is scored.
  - **Every draw's audit row carries `digits_sha256`** (sha256 of the rows
    and columns), and `admin_verify_digits` re-checks every drawn game against
    its latest draw or override row. The morning run and the results run call
    it first; a mismatch sends nothing and is NEEDS ANTHONY.
- **Owner groups are AVD, MAP, RM, JPOD, EJD, NL, GD, BG, TJA and DN.**
  Nothing else. `TJA` is TJ Auletto and `DN` is Dom Novelli, both added
  2026-10-08 (migration 34), code and name only, the way migration 19 added
  BG. `BG` is Billy Guyon, added 2026-09-04 (migration 19). He is an owner on the
  same footing as the rest: he collects from his own participants and holds
  that cash. Before this existed his people had to be filed under someone
  else's code, which attributed his money to an owner who never touched it —
  wrong in two books at once, and invisible until season-end reconciliation.
  What the code *means* — collection responsibility, not provenance — is in
  *Owner codes and how money is actually collected* above.
  `DIRECT` was retired 2026-08-28 (migration 13) and its seventeen
  participants folded into AVD — it was Anthony's own book under a generic
  name, and AVD is the same book under his code. The value is now rejected
  on insert and on update, the column default is `AVD`, and
  `admin_upsert_participant` falls back to `AVD` on a blank group. History
  was deliberately not rewritten: audit rows still carry `DIRECT` in their
  `before` payloads, which is correct — the ledger records what was true at
  the time, and the constraint has never reached into jsonb.
  **Every code now has a person attached** (migration 25, `owners` table,
  2026-09-10). `NL` is Nolan Lawrence and `BG` is Billy Guyon, both named
  2026-09-09; until then those two codes existed in the schema with no name
  anywhere, so reconciling either book at season end meant asking Anthony who
  the code belonged to. The table is the mapping only: what a code *means* is
  the rule above it and is unchanged. `docs/OWNERS.md` is its readable copy.
- **Owner email addresses live in the `owners` table, never in the repo.**
  The table is admin-only on the same footing as `pending_actions`: RLS on
  `is_admin()`, `anon` holds no privilege, no `v_public_*` view selects from
  it. `docs/OWNERS.md` carries the codes and the names and no addresses.
  - **The reason is not that the repo is public, and the rule will not relax
    when it stops being.** Three things hold at any visibility. Git history is
    permanent and a delete does not reach it, so an address committed once is
    committed for good. Visibility is a setting and settings get changed back,
    by a fork, a transfer, or a contractor added for an afternoon. And a repo
    has no row-level access control at all, while the table has exactly that.
  - Private would remove only the *urgency*. The first draft of migration 25
    seeded all eight addresses while the repo was public, and seven of them
    were not in it before; that was caught in review. Private would have made
    it quieter, not better.
  - The standing rule that a public surface never exposes email applies to
    repo files too. That is the thing to check before writing any contact
    detail into one.
- **A prior season is a source of identity, never of state.** Alias and
  email carry forward; owner group, block number, block count and payment
  status never do — each needs a 2026 source. A prior-season value can go in
  notes as context, never into a state field on its own authority. Full rule
  and precedents in `docs/PARTICIPANT_DATA_RULES.md`.
- A specific block number only goes to someone who specifically asked for
  it. A prior season's number is carryover, not a request — the block-number
  instance of the rule above.
- A shared email between two participants is worth noting but is never by
  itself a duplicate signal.
- Never invent a full name. If it is unknown, mirror the alias and flag it
  unconfirmed.

## Email to the pool

- **Every broadcast email carries every owner in To**, except the format
  email (`format_change_<date>`, Part L), which Anthony addressed To himself
  alone with every other owner on Cc and each holder's own address in Bcc
  (never a holder's `cc_email`, which can be someone else), and the three
  game-day emails (Part N, below), which go To Anthony, Cc RM and MAP. Those
  four are the pool emails with a Cc (`ownersOnCcEnvelope` and `dayEnvelope`
  in `src/lib/email/envelope.ts`, migrations 41 and 43). A broadcast is one
  body to many recipients in Bcc (the recruit broadcast, and the game-day
  pack when Anthony runs it; the format and game-day emails are broadcasts
  on their own envelopes, as above). Its To is
  Anthony's address first, then each other owner's primary address, read at
  send time from the admin-only `owners` table: RM, MAP, JPOD, GD, EJD, NL,
  BG, TJA and DN, ten addresses in all. Never an owner's `alt_email`, on To
  or in Bcc. Its Bcc is the derived recipient list minus every address
  already on To and minus every owner's `alt_email`, so an owner who also
  holds a block, or whose second address is a prospect or a holder's, gets
  one copy, at his primary (Anthony, 2026-10-14; MAP's is the one alt on
  file). Nothing goes in Cc, the format email and the game-day emails aside. Anthony's rule, set 2026-10-07; it replaced the
  2026-09-09 version, which read the owner addresses from a routine variable.
  `src/lib/email/envelope.ts` builds it, and `tests/unit/email/envelope.test.ts`
  holds it.
  - **An owner with no address makes every broadcast refuse**, unless one send
    passes an explicit one-time override naming that owner (`--omit-owner
    <CODE>`). The claim before the send (`admin_email_claim_broadcast`,
    migration 37) refuses unless the codes named are exactly the owners with no
    address, and writes one `broadcast_owner_omitted` audit row per code. The
    default never changes. The recruit broadcast of 2026-10-13 left DN off
    this way (Anthony, Part G4).
  - **The game-day emails (Anthony, 2026-11-23, Part N, approved in the TNF
    PM chat at 2:53 PM ET; the approval is on every claim's audit row and on
    its own `approval_recorded` row).** Three templates in
    `src/lib/email/events/day.ts`, each one send per event key: the kickoff
    email (`kickoff_<date>`, the claim deadline: the board, how a block wins,
    the schedule, unpaid pay by the deadline), the game-day email
    (`gameday_<date>`, each game date's morning: that day's games, kickoff
    times, each game's drawn rows and columns, each grid) and the winners
    email (`winners_<date>`, once that day's games are final: per game, the
    halftime and final score, winning block, name and amount, the grid;
    nothing about payment status). **To Anthony, Cc RM and MAP, Bcc every
    holder's own address**, no other owner: an owner who holds a block gets
    it in Bcc as a holder, and an owner's alt never. DN having no address
    does not touch these. The claim refuses a game-day email whose games are
    not drawn and published, and a winners email whose games are not scored
    or whose winning block has no payout behind it: an unpaid winning block
    is Anthony's call, so nothing goes. TNF Game Day sends all three (Part O):
    the first two on its morning run and the third on its results run
    (`docs/RESULTS_PROMPT.md`); the sweep sends none.
    Sweep replies keep their one-to-one rule and copy no one.
  - **The game-day email carries pictures and the block list from Thu Nov 26
    (Anthony, 2026-11-25, Part R, approved in the TNF PM chat at 8:20 PM
    ET; the approval string is `0e` in `docs/GAME_DAY_PROMPT.md`).** Wed
    Nov 25's G01 grid went out by hand that evening, in the same format, two
    messages because the Gmail connector caps a message with an attachment at 25
    addresses; those two are not in `email_sends` and are never resent or
    backfilled. From `gameday_2026-11-26` on, the 9:10 morning run sends one
    message through `npm run email` with `--block-list /tmp/blocks.json`: per
    game the matchup, kickoff and digits, a picture of that game's grid in
    **Comfortable view, names in every block, never Fit**
    (`/api/grid-image?g=<n>`, `src/app/api/grid-image/route.tsx`, fetched at
    dry run and again at send, inline by Content-ID), then **all 100 blocks in
    ascending order, one line each**: `<block> - <board name> (<real name, only
    if different>) - <email, or no email on file>`, built from the database at
    send time (the block list query in `docs/ROUTINES.md`), then the one link.
    **The list includes every holder's email address and every holder who has
    an address sees all of them.** Anthony was told so and chose it, 2026-11-25
    6:52 PM. Recipients are unchanged (To Anthony, Cc RM and MAP, Bcc every
    holder's own address) and the Gmail API takes all 35 with the picture
    (verified 2026-11-25). **The repo is public: addresses live only in the
    `/tmp` file the routine writes, never in a repo file, a fixture, a log or
    a report.** The dry run prints the email with every address masked, and
    the tests use fake `.test` addresses. Without `--block-list` the command
    renders the Part N email unchanged, which is the fallback: the run drops
    the list, or with `--arg images=off` the pictures, rather than delay the
    numbers, and says so in its report.
  - **The game-day pack** (`game_day_g<NN>`, a draft with the grid) is a
    manual command since Part N (`npm run game-day`): no routine drafts or
    sends it, and TNF Game Day's prompt never runs it.
  - **The game-day pack leaves DN off the same way** (Anthony, 2026-11-20,
    Part M), when Anthony runs it. It is a draft he sends himself, so it has
    no claim: its audit row comes from
    `admin_email_omit_owners('game_day_g<NN>', ...)` (migration 42), the
    claim's own check and the same `broadcast_owner_omitted` row, once per
    game and nothing in `email_sends`, and then
    `npm run game-day -- --omit-owner DN`. That holds only while DN is the
    one owner with no address; any other blank owner still stops the draft.
  - **The recruit broadcast** (`recruit_broadcast_<date>`, Anthony
    2026-10-13): one message, To every owner with an address, Bcc every active
    prospect and every holder address (email and cc_email), deduped, minus To,
    minus anything recruit-excluded, blocklisted, an owner's alt or Anthony's.
    `admin_email_broadcast_plan` derives it and prints P + H - O - T - X =
    Bcc; every recipient is ledgered in `email_sends` under the one key. It
    replaced a separate holder check-in: holders are on it.
- **Per-recipient email never carries an owner** on To or Cc: a holder
  check-in, the recruit send, a T1-T7 reply, the digest, a status report. Its
  To is its one recipient.
- **The note (Anthony, 2026-11-26, Part S, migration 45).**
  `note_<YYYY-MM-DD>_<name>` is a new email to one holder in Anthony's own
  words, when nothing came in to answer (`answer_<id>` needs an inbound
  message). Dated, per recipient, claimed like any per-recipient send. The
  database allows only a holder's own address (never a cc, never Anthony's),
  and the context refuses any other. Every block number the words name must
  be one the recipient holds. `--arg grids=2,3,4` adds a grid picture per
  game, only for that date's games with published, verified digits, fetched
  at the dry run into `--picture-cache` and read back at the send. The lint
  still applies: no relative date, so "the grids for Thu Nov 26", never
  "today's grids". The name in the key is lower case, never an address.
- **A holder check-in says Paid only when the ledger backs it.** Anthony,
  2026-10-08 (Part E4). `email_holder_facts()` (migration 36) marks an
  assigned block `ledger_paid` when the participant's payment rows,
  corrections included, total at least the block price for every assigned block of theirs
  that is not comped, or when the block is comped: a comp is reconciled, basis
  comp (Part F2; Anthony's comp, blocks 3 and 23 from Part K, ended 2026-11-26 in Part S, so no block is comped now). Any other assigned block
  renders "On file, payment not found - reply if that's wrong". Status alone
  never makes a block Paid. Every check-in closes with "If anything here is
  off, reply and I'll fix it."
  - **An owner's cash confirmation is a payment row and counts.** The rule
    catches an assigned block with nothing behind it; it does not second-guess
    an owner's word about his own book. Block 50, the case that prompted it,
    would still have read Paid on Oct 7: RM's confirmation was on file, for a
    holder who told Anthony he had never paid. He was released and the row
    reversed on Oct 8. Anthony's call, made 2026-10-13: an owner-held cash
    row keeps reading Paid, because an owner's word is the payment record for
    his book.
- **The owners, by code.** AVD Anthony DellaPia, one address, RM Ronnie
  Malandro, MAP Michael Pungitore, JPOD Julian Podagrosi, GD Gregory
  DellaPia, EJD Ernie DellaPia Jr., NL Nolan Lawrence, BG Billy Guyon, TJA TJ
  Auletto, DN Dom Novelli. DN has no address on file yet (2026-10-08), so
  every broadcast To every owner refuses until it is set unless the send
  names him in the one-time override (the game-day pack does, each game it
  is run, since Part M), and the nightly digest carries one NEEDS ANTHONY
  line saying so. The game-day emails name no owner but Anthony, RM and MAP,
  so DN does not touch them.
- **Anthony's work email is never stored, written, or addressed anywhere in
  this pool.** Anthony, 2026-10-08. He has one address on this pool. AVD's
  `alt_email` was cleared that day and nothing replaced it. Migration 35 makes
  the database refuse it: `blocked_address_hashes` holds its sha256, seeded by
  hand and never committed, and a trigger on `owners`, `participants` and
  `prospects` rejects any write that hashes to a row.
- **An owner is never a prospect.** The recruit send excludes every owner's
  address (migration 34); an owner's prospect row is removed with
  `admin_remove_prospect`, audited without the address.
- **The addresses live only on the `owners` table, never in this repo, an
  environment variable or a routine setting.** A routine exports the table
  through the Supabase connector at send time (the owners query in
  `docs/ROUTINES.md`) and hands the file to the command.
- **A link in a pool email is the bare URL and nothing else**, for example
  `https://ad-26-tnf.vercel.app/grid`. No tracking wrapper, no second
  URL. The Gmail connector rewrites the href of any link it is handed into a
  google.com/url redirect and rewrites the plain-text part the same way; the
  only control left is the visible text, so hand it an HTML anchor whose
  text is the bare URL. Verified 2026-09-09 on two test drafts.

## Handoff

`docs/2026-11-23_TNF_ONBOARDING.md` is the map for anyone new: the state on
that date, the routines as read back, Thanksgiving day by day, the invariants
and the open items. `docs/INCIDENTS.md` is the record of what went wrong.
Neither outranks this file.

## The code status email (Anthony, 2026-11-23, Part O)

**Every Claude Code session that works on this pool ends by sending Anthony
one status email, to his address alone.** Subject `TNF CODE STATUS - <session
name>`, the session's own name as the app shows it. Plain text, under ten
lines, exactly these fields in this order, one `KEY: value` line each:
SESSION, RAN, MERGED, APPLIED, BLOCKED, NEXT, WATCHING.

- It goes through the email module like every other TNF email:
  `npm run email -- --event status_<date> --context <a context> --to-admin
  --arg session="<session name>" --lines "<the seven lines>"`. The template
  (`src/lib/email/events/status.ts`) refuses a missing or reordered field, a
  tenth line, a line too long to sit on one line (69 characters) or a missing
  session name.
- It is a send to Anthony alone, so it is not claimed and adds no row to
  `email_sends`. No owner, no holder, no Cc.
- BLOCKED says "none" when nothing is. A session that changed nothing still
  sends it, with RAN saying so.

## Replies (Anthony, 2026-10-08)

**Claude has full authority to answer pool mail as Anthony.** The standing
rule, for any session or routine that reads the mail:

- **Read every inbound reply in full** (`get_thread`, never a search
  preview): every thread whose message id is in `email_sends`, everything
  labelled Pool-TNF, and any message from a participant, prospect or owner
  address, whatever its label. A reply to a pool send carries that send's own
  label and not Pool-TNF: the Pool-TNF filter's negated terms match Anthony's
  address quoted in every reply, so the filter skips it.
- **A question or an ask gets an in-thread reply in Anthony's voice, with the
  task done in the same run.** Do the write, confirm it committed, then reply
  that it is done.
- **An acknowledgement gets no reply.** Mark it read and label it
  Pool-TNF-Done (`npm run email -- --no-reply <message id>`).
- **Voice: a text to a buddy.** First name and a comma, one to three short
  sentences, a small table only when listing data, signed Anthony. Hyphens
  only, no emojis, no dollar sign, no filler, never "let me know if". The
  lint in `src/lib/email/lint.ts` refuses the mechanical ones.
- **Allowed without asking:** reserve, assign or release blocks; record a
  payment, only from a Venmo receipt; update contacts; add a prospect; answer
  rules and schedule questions from the database.
- **NEEDS ANTHONY only for:** money going out, a payment claimed with no
  receipt, an identity that could be two people, or a change to rules or
  payouts. A release asked for by a third party is the identity case (see
  *The season* above).
- **Every reply goes through the email module**, is claimed in `email_sends`
  before it goes and recorded after, and is audited: `npm run email --
  --reply-to <message id>`, as `game_list_<message id>` for the game list,
  `answer_<message id>` for anything else, or a T1-T6 sweep template. The
  database allows one game_list or answer reply per inbound message and one
  template reply per thread; across the two, the command's check for a later
  message from Anthony to the sender is the guard, so every reply goes out
  with `--reply-to`.
- **Before each send**, skip if Anthony already wrote to the holder in the
  thread after the holder's message, and delete every unsent draft in the
  thread first. The command does both, and refuses on the first.
- **Pool-TNF-Done goes on only after the reply is sent or the message is
  classed no-reply.** Never on a question still waiting for an answer: a
  labelled thread is not read again. The command applies it after the send.
- **What the live sweep runs:** `docs/SWEEP_PROMPT.md`, since 2026-10-09.
  The routine's prompt is a pointer to the file and each run reads it from
  main, so a merge to main changes the next run. Until then it ran an older
  inline prompt that labelled every message Pool-TNF-Done and could not reply,
  which is how two holders' questions were closed unanswered on Oct 8.

## Isolation

The Survivor pool is a **separate system**. Never reference it, link it, or
mix its money or participants into this one.

**This chat and this repo never produce content for the Survivor pool.**
Not code, not rules, not drafts, not suggestions, not "here is what I would
write." If Anthony asks for something Survivor-related here, refuse and
tell him it belongs in the other chat. Refusing is the correct answer even
when he asks directly and even when the request sounds harmless.

The reason is not tidiness. Work produced here about that pool is built on
whatever few facts happen to be in this conversation, and it comes out
looking as confident as work that is actually grounded. That has already
happened once: a rules draft written here from four facts in a chat message
contained two rules that were factually wrong, and it was one step from
being sent. Plausible and wrong is worse than absent.

Reading that pool's code for a pattern is not the same as writing for it,
and is still not an invitation to write for it.

## Stack and commands

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · Supabase
(Postgres) · Vitest · ESLint flat config (`eslint.config.mjs`).

```
npm run dev        # local dev server
npm run build      # production build
npm run lint       # ESLint
npm run test       # Vitest unit suite
npm run test:db    # the SQL suites against a local Postgres — run these too
```

`npm run test` alone is not a green light. Schema, RLS, and RPC behaviour
are covered by `npm run test:db` (tests/sql/*.sql), and that is where the
money rules are actually enforced.

## Code conventions

- **Money is stored in CENTS, everywhere.** `price_per_block_cents = 25000`
  is $250; `holiday_final_cents = 150000` is $1,500. Never treat a `_cents`
  column as dollars — that is a 100x error waiting to happen. Format for
  display with the helpers in `src/lib/format.ts`, never by hand.
- Server components by default; `"use client"` only where there is real
  interactivity.
- Every write goes through an audited `admin_*` RPC that re-checks
  `is_admin()`. Server actions shape arguments and revalidate; they are not
  the security boundary.
- **Through the Supabase connector, every `admin_*` call carries the admin
  claim**, set in the same `execute_sql` call first:
  `select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);`.
  `is_admin()` reads Anthony's email from the JWT claims and the connector
  sends none, so without it the call is refused "not authorized". Every
  routine prompt that calls an `admin_*` function says so. The sweep's did
  not, and from 2026-10-09 to 2026-10-13 every admin call it made was refused:
  no digest, nothing staged, recorded or replied to. Fixed 2026-10-13.
- Public pages read only the `v_public_*` / `v_pot` projections. Never
  compute block status client-side, and never query base tables from a
  public route.
- Schema changes are new numbered migrations in `supabase/migrations/`,
  applied to production only after the local SQL suites pass. A
  `create or replace view` can only APPEND columns — new columns go last.
- **A migration that changes a column an assertion reads means that
  assertion must be RE-VERIFIED, not just re-run.** A green suite is not
  evidence the assertion still tests anything. Break the thing on purpose and
  confirm the test fails; if it still passes, the assertion is dead.
  - Gating a column on `is_admin()` is the case that already bit us.
    Migrations 15 and 16 wrapped `v_pot.collected_cents`, `due_cents` and
    `owed_out_cents` in `case when is_admin()`. Three SQL suites read those
    columns with no role and no `request.jwt.claims`, so every value came
    back NULL, every `if money <> expected` compared against NULL, and the
    IF never fired. `npm run test:db` reported 14/14 PASS while
    `collected_cents` was asserted to be $9,999,999.99 and a $2,000 swing in
    `due_cents` went unnoticed.
  - **NULL is the danger, because in SQL it passes silently.** Any assertion
    reading a nullable or conditionally-visible column needs an explicit
    `is null` guard that raises, so losing visibility fails loudly instead of
    turning the test into a no-op. The three fixed suites each carry one.
  - This is the same discipline as the mutation testing already required
    below for money and winner logic; a migration is just another way to
    silently delete a test.
- A `security_invoker` view nested inside a `security definer` view still
  evaluates RLS as the session user. `v_pot` therefore inlines all of its
  computation from base tables; do not refactor that into nested views.
- Pure logic lives in `src/lib/` with unit tests. Anything that decides
  money or a winner gets a test before it ships.

## Security

No service-role key anywhere, client or server. The anon key plus RLS is
the security boundary; the committed fallbacks in `src/lib/env.ts` are safe
by design. Never add an auth library without first checking whether
Supabase Auth already covers it.
