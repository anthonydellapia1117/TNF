# 1622 TNF Block Pool — operating rules

Standing rules for anyone (human or agent) working on this pool. These are
Anthony's calls, not inferences. Do not relax one without him saying so.

## Owner codes and how money is actually collected

**The seven owner codes — AVD, RM, MAP, JPOD, EJD, NL, GD — are collection
responsibility, not provenance.** They do not record who introduced someone
or who they emailed. They record *which owner collects that participant's
$500 and holds it*.

How the pool actually runs:

- Each owner collects from his own participants and **holds that cash**.
- Each owner **pays his own winners out of what he is holding**, first.
- If an owner runs dry, the other owners cover it between them.
- At season end it reconciles per owner: participants × $500 against what
  that owner paid out.

Three things follow, and getting them wrong is expensive:

1. **An owner's word IS the payment record for his own book.** When JPOD
   says he has Konnor's money, Konnor is paid — the money is in the pool,
   JPOD is holding it, and if block 51 hits, JPOD pays it. No other owner is
   exposed. This is an honour system among the seven and has always worked
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
code records who collects and holds the $500. If Anthony collected it, the
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
owner collects and holds his own participant's $500, that owner is doing the
collecting and keeps the code — Konnor McGrorty stays JPOD because Julian is
holding his money. Only money that actually reached Anthony moves anyone.

**Read the exception by who SENT it, not by whose name is in the memo.** A
$500 Venmo from the participant is Anthony collecting. A $500 Venmo from
another *owner*, forwarding what he already collected, is that owner
collecting and does not move the participant — it is the Konnor case
arriving by Venmo instead of by hand. If the sender is an owner rather than
the participant, ask Anthony rather than moving anyone.

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

**A block costs $500 flat, so the candidate amount for a participant is
$500 x the blocks he actually owes for.** One block is $500, two is $1,000,
Ed D's three is $1,500. A comped block owes $0 and is excluded from that
count — the expected amount is his `due_cents`, not his headcount.

For the forty-odd single-block holders this is exactly the old
$500-only rule and nothing about them changes. It exists to stop the pool
losing a real payment: Anthony Astorga settled both his blocks with one
$1,000 Venmo on 2026-09-03, a full and unambiguous payment that a
$500-only sweep is instructed to ignore. Anthony had to point it out by
hand.

Three outcomes, and only three:

1. **Matches a participant's expected amount** — a real candidate. Verify
   the receipt and record it.
2. **Matches no participant's expected amount, but is a clean multiple of
   $500** — surface it as **"non-matching multiple, needs review"** and
   stop. Do not record it and do not guess who it belongs to. This is
   someone paying for a friend, or a two-block holder sending $500 for one
   of them. It needs Anthony, not a decision.
3. **Not a multiple of $500** — not a block payment. Invisible. Do not
   surface it, flag it, or record it as a partial one, whatever name is on
   it, unless Anthony says otherwise for that specific transaction.

Rule 3 is the one learned the hard way: two sweeps surfaced a $30 and a
$150 Venmo from people who *are* participants, and both turned out to be
unrelated (a Survivor entry fee and personal money). Reporting them cost
Anthony two round trips to chase nothing. Neither is a multiple of $500, so
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

- `payout_mode` is **FIXED at $44,250** regardless of blocks sold. Never
  surface sellout risk or contingent payouts anywhere in the UI.
- The app never moves money. The payments ledger is append-only; corrections
  are new rows, never edits.
- Committed is a real **count** of blocks, never money divided by price — a
  comped block owes $0 but is still committed.
- Break-even is **89 paying blocks**. Comped blocks are excluded from that
  count. This lives on /admin only and is never public.

## The claim deadline

The claim and payment deadline is **Friday September 4, 2026**. It governs
who has settled, and nothing else. In particular it does not move blocks.

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
  surfaces at all — they live on `/admin` only. `DashboardPanel` in
  `src/lib/season-mode.ts` has no name for them, so a public panel for
  collected money or a headcount cannot be returned by construction.
  Viewer widgets answer fan questions instead: hot and never-won digits,
  close calls, score patterns, the next holiday game. Nothing about money
  owed, payment status, or how many people are in.
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
  OPEN/CLAIMED filter counts. Showing what is open is that page's purpose.
  The same number was removed from the *home* page, where it read as a pool
  that did not fill. These two are not in conflict; do not "fix" one to
  match the other.
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
- **Digits are assigned to the two axes, not to blocks.** Each axis is a
  permutation of 0-9, so all 100 cells receive numbers regardless of how many
  blocks are sold or paid. The claim deadline never gates digit assignment.
  What the deadline governs is how many cells are *payable*, since only an
  Assigned block produces a payout. This is a mechanical statement about how
  digits are assigned — it is not a statement about pool health, and nothing
  here is a reason to surface one.
- **Digits are drawn one week at a time, the week they are needed.** This is
  a rule about the data, not a convenience of the screen. Digits that exist
  months early are digits someone could see or alter; under this model they
  do not exist until their week comes up. Anthony considered pre-generating
  the whole season on 2026-09-03 and decided against it for that reason.
  - A game more than **7 days** from kickoff cannot be drawn, from any
    surface. The gate lives in `src/lib/week-digits.ts` and is re-checked in
    the server action against games read from the database, so a stale page
    cannot get past it. Both `/admin/digits` surfaces ask the same question.
  - A week is drawn as a unit, so the *furthest* game it would draw sets the
    gate. A game the draw would skip anyway — void, unconfirmed date, past
    kickoff, already drawn — never holds a week back.
  - Every game is its own independent draw: a separate `admin_assign_digits`
    call, a separate permutation of each axis, no shared seed and no
    relationship to any prior game or week. Never batch them into one draw.
  - Drawing and publishing stay two deliberate clicks, with the numbers shown
    for review in between. Each reveal is scheduled for **8:00 AM ET on that
    game's own date** — never one shared instant for a week.
- **Owner groups are AVD, MAP, RM, JPOD, EJD, NL and GD.** Nothing else.
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

- **Money is stored in CENTS, everywhere.** `price_per_block_cents = 50000`
  is $500; `regular_final_cents = 100000` is $1,000. Never treat a `_cents`
  column as dollars — that is a 100x error waiting to happen. Format for
  display with the helpers in `src/lib/format.ts`, never by hand.
- Server components by default; `"use client"` only where there is real
  interactivity.
- Every write goes through an audited `admin_*` RPC that re-checks
  `is_admin()`. Server actions shape arguments and revalidate; they are not
  the security boundary.
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
