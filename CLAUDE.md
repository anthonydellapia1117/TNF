# 1622 TNF Block Pool — operating rules

Standing rules for anyone (human or agent) working on this pool. These are
Anthony's calls, not inferences. Do not relax one without him saying so.

## Payment sweeps

**A TNF block costs $500 flat. Only a $500 amount is a candidate block
payment.** Anything that is not $500 is not a block payment, and must not
be surfaced, flagged, or recorded as a partial one — unless Anthony says
otherwise for a specific transaction.

This rule exists because it was learned the hard way: two sweeps surfaced a
$30 and a $150 Venmo from people who *are* participants, and both turned
out to be unrelated (a Survivor entry fee and personal money). Reporting
them cost Anthony two round trips to chase nothing.

- Match on **amount first**. $500 in, from a person, is worth checking.
- A participant's name on a non-$500 transaction is **not** a signal.
- There are no partial payments. A block is paid or it is not.
- Resolved false positives are recorded in the participant's notes with the
  transaction ID and "do not re-flag." Honour those notes.
- Sweep by fetching threads in full (`get_thread`), never from search
  previews — previews show only the ~5 oldest messages of a thread and have
  hidden real commitments before.

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
