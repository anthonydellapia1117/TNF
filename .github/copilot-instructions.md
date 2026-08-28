# TNF — instructions live in CLAUDE.md

**Read [`../CLAUDE.md`](../CLAUDE.md) before working in this repo.** It is
the single source of truth for this pool: the standing operating rules
(payment sweeps, money, public surfaces, data, isolation), the stack and
commands, and the code conventions.

This file is deliberately a pointer, not a second copy. Two instruction
files drift from each other; one drifts from nothing.

Two corrections, because the earlier version of this file got them wrong
and the errors were expensive ones:

- **Money is stored in CENTS, not whole dollars.**
  `price_per_block_cents = 50000` is $500. Treating a `_cents` column as
  dollars is a 100x error.
- **Payouts are FIXED at $44,250 regardless of how many blocks sell.**
  `v_pot` does not compute a pot from blocks sold — it reports counts plus
  collected, due, paid out and owed. Never imply that payouts scale with
  sales, anywhere in the UI.
