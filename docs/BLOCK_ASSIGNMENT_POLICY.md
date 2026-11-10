# Block assignment policy (2026 season, set 2026-08-24)

Owner: Anthony DellaPia. These rules govern how block numbers are handed
out. They were set after the 2025 grid reconciliation and apply to all
future assignment work in this pool.

1. **Carryover from a prior season is not a request.** Nobody keeps last
   year's number automatically. Anyone who wants a specific block this year
   has to ask this year. (Applied 2026-08-24: the four 2025 carryover
   numbers 8, 17, 27, 47 were released and their holders redrawn.) This is
   one instance of the general rule that prior-season data is a source of
   identity, never of state — see `PARTICIPANT_DATA_RULES.md`.

2. **New participants get a randomly assigned block by default**, method
   `random`. Random draws are deterministic and auditable: a published seed
   string is hashed (FNV-1a) into a mulberry32 PRNG driving a Fisher–Yates
   shuffle of the free numbers. Seeds used so far:
   - `tnf-2026-blockdraw-01` — the original 12-recipient pool draw
   - `tnf-2026-blockdraw-02` — replacement draw for the released carryovers
     (8→58, 17→63, 27→70, 47→43; a drawee cannot randomly land back on
     their own prior number)
   - `tnf-2026-blockdraw-27` — the 250 format (Anthony, 2026-11-10): one new
     block per held block, drawn from the open numbers by
     `admin_double_holdings`; the free list and the shuffle are in its
     `double_holdings` audit row

   Seeds 03 to 26 were single draws recorded in each block's `requested_ref`.
   Those ran from a script that was never committed, so they cannot be
   replayed bit for bit (seed 26 against the 43 numbers open on 2026-09-17
   does not give block 32). From migration 40 the draw is committed code:
   `block_draw_order()` in SQL, which the database runs, and
   `src/lib/block-draw.ts`, its TypeScript twin; tests/sql/28 and
   tests/unit/block-draw.test.ts assert the same vector, so the two cannot
   drift. The i-th block placed takes the i-th number of the shuffle, and a
   seed is printable ASCII and never reused.

3. **A specific request beats a random assignment.** If someone requests
   block N and N is held by a `random` assignment, the random holder moves
   to a new random block and the requester gets N. The displaced holder
   gets an audit row and a participant note saying which block they came
   from and why.

4. **A request never displaces another request.** Two people asking for the
   same number is a conflict for the owner to resolve — flag it, write
   nothing.

5. **Method is public.** Every block shows plainly whether its number was
   `requested` or `random` — on /admin/blocks, on /block/[n], and in
   `v_public_blocks.assignment_method`.

Standing rule restated from earlier in the season: a specific block number
only ever goes to someone who specifically asked for it.
