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
- A specific block number only goes to someone who specifically asked for
  it. A prior season's number is carryover, not a request.
- A shared email between two participants is worth noting but is never by
  itself a duplicate signal.
- Never invent a full name. If it is unknown, mirror the alias and flag it
  unconfirmed.

## Isolation

The Survivor pool is a **separate system**. Never reference it, link it, or
mix its money or participants into this one.

## Security

No service-role key anywhere. The anon key plus RLS is the security
boundary; the committed fallbacks in `src/lib/env.ts` are safe by design.
