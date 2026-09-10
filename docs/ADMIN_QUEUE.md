# The NEEDS ANTHONY queue (`/admin/queue`)

Built 2026-09-05 as migration 23 (`pending_actions`). The migration is not
applied to production until `npm run test:db` passes on a machine with local
Postgres; until then `/admin/queue` says the table is missing and nothing
can be staged.

## What it is

The hourly sweep finds things it is not allowed to decide: a Venmo that
matches a participant's expected amount, a clean multiple of $500 that
matches nobody, a block request in a thread, an identity conflict. Each of
those used to be a line in a report and a round trip. The queue is where
those lines live now: one row per item, staged by the sweep, resolved by
Anthony with one click.

Staging is not deciding. A staged row changes nothing about the pool.

## Flow

1. The sweep calls `admin_stage_pending(p_kind, p_payload,
   p_source_message_id, p_actor)` once per item, as the admin session.
   `p_payload` is a JSON object holding what it found; `p_source_message_id`
   is the Gmail message it read; `p_actor` is who is calling, and goes into
   the audit row (every RPC in this schema takes it last; the app's server
   actions fill it from the signed-in session, a script passes its own
   label). Kind and message id are stored trimmed. The same kind and message
   cannot be open twice, so an hourly re-read does not pile up duplicates.
2. Anthony opens `/admin/queue`: kind, when it was staged, the message id,
   a one-line summary, the raw payload, and two buttons.
3. **Approve** calls `admin_approve_pending(p_id, p_note, p_actor)`. What
   that does depends on the kind:

   | kind | Approve does |
   |------|--------------|
   | `payment` | `admin_record_payment` with the payload's `participant_id`, `amount_cents`, `method`, `paid_on`, `venmo_txn_id`, `source_ref`, `note`, `collected_by`. Refused before the RPC if `participant_id` or `paid_on` is missing or `amount_cents` is not a positive whole number of cents. Promotes the block if that settles it, as the ledger always has. |
   | `reserve_blocks` | `admin_reserve_blocks` with `block_numbers`, `participant_id`, `method`, `ref`. |
   | anything else on the stageable list | Records `resolution = approved` and applies nothing. Anthony does it from the relevant admin page. The row now stores `applied = false` and `/admin/queue` says so. |

   If the dispatched RPC refuses (block not available, duplicate Venmo txn,
   participant missing) the row stays open and the error reaches the screen.
4. **Dismiss** calls `admin_dismiss_pending(p_id, p_note, p_actor)`:
   resolved, nothing applied.

## Rules

- All three RPCs check `is_admin()` first and write their `audit_log` row in
  the same transaction: `stage_pending`, `approve_pending`,
  `dismiss_pending`.
- Approve never writes a base table itself. Its only writes are the existing
  `admin_*` RPCs in the table above, which re-check `is_admin()` and audit
  themselves. The dispatch table in `src/lib/pending.ts` mirrors the `CASE`
  in the migration; change both together.
- Nothing in the queue can mark a payout paid, release or hold a block,
  resolve an identity, or delete anything. Those stay deliberate actions on
  their own admin pages.
- The table is admin-only (RLS on `is_admin()`, anon has no access) and takes
  no direct writes from any client role. The three RPCs are `security
  definer` so they can write a table their caller cannot; every other RPC in
  this schema is invoker because its table lets the admin session write
  under RLS. The queue is fed by an automated sweep, so here the
  writes-only-through-RPCs convention is enforced by grants.
- **The kind string is a closed list** (migration 26). `admin_stage_pending`
  refuses anything not on it: `payment`, `reserve_blocks`, `refund_needed`,
  `identity_conflict`, `non_matching_multiple`, `unparsed_intake`,
  `unclassified_mail`. The list is duplicated as `STAGEABLE_KINDS` in
  `src/lib/pending.ts`; change both together, exactly as `DISPATCH` mirrors the
  `CASE`. The guard rejects only what is on neither group, so the deliberately
  dispatcher-less kinds keep working.
- **`applied` is stored on the row, not just returned** (migration 26). Null
  while open, `false` on a dismissal and on an approve of a dispatcher-less
  kind, `true` when an RPC actually ran. `/admin/queue` lists the last seven
  days of resolved rows and marks an approve that applied nothing in the
  destructive colour with a line saying nothing was written. A row resolved
  before the migration has `applied = null` and reads "Approved, applied
  unknown", never "applied".
- Payload shapes the summary understands: `payment` carries
  `participant_id`, `participant_name`, `amount_cents`, `method`, `paid_on`, `collected_by`,
  `venmo_txn_id`, `source_ref`, `note`; `reserve_blocks` carries
  `participant_id`, `participant_name`, `block_numbers`, `method`, `ref`.
  Any other kind is free-form and its scalar fields render as `key: value`.
- The sweep's prompt is owned by the routine, not by this file. Until it
  stages, the queue is empty and the page says so.


### `collected_by` on a payment payload

An owner code, or absent. **Absent means Anthony collected it**, and that is the
normal case: the sweep only ever sees money that reached his Venmo or his mail.
Set it only when an owner has said he collected and is holding his own
participant's cash, and set it to that owner's code.

It decides one thing: `admin_record_payment` moves the participant to `AVD`
when this is absent or `AVD`, and leaves the owner alone when it names one. So
a payment staged with the wrong code here puts a block in the wrong owner's
book, and a payment staged without one for cash an owner is holding takes his
participant off him. Neither would show up until season-end reconciliation,
which is why the row on this page **names the holder** - `(held by JPOD)` after
the transaction - whenever the code is set to anything but `AVD`. A row with no
such note is a row that will move the participant into Anthony's book, and that
is the only reading it has.

Migration 30 backfilled the 48 historical rows from the prose already in
`source_ref`: 29 resolved to an owner (RM 21, MAP 7, JPOD 1), and 19 stayed
absent, every one of them a Venmo receipt or an instruction from Anthony. That
19 is not a gap to close - absent is the correct value for all of them.

## Tests

- `tests/unit/pending.test.ts`: the dispatch table and the payload summary.
- `tests/unit/pending-kinds.test.ts`: the closed kind list and the outcome
  label, including that an approve with `applied = null` reads as unknown.
- `tests/sql/20_pending_kind_guard.sql`: every off-list kind refused and not
  stored, all seven allowed kinds accepted, `applied` persisted true on
  dispatch and false on both no-dispatch and dismiss, and `applied` paired with
  `resolved_at` on every row.
- `tests/sql/17_pending_actions.sql`: RLS denies anon, the RPCs refuse a
  non-admin, stage then approve resolves and writes both audit rows, a
  refused approve leaves the row open, dismiss resolves without applying.
  Runs under `npm run test:db`, which needs a local Postgres.

## Kinds without a dispatcher

- `owner_owes_refund` was staged once, on 2026-09-10, and is **retired**. It
  said Mike Pungitore owed Billy Agnes $500 back after block 28 was released.
  Dismissed the same day as "owner-held cash, out of scope per 2026-09-10":
  Anthony tracks his own money only, so an owner's debt to his own participant
  is that owner's business. The kind is not on the stageable list, so it cannot
  be staged again.
- `payment_candidate` is **not a kind** and never was a working one. The sweep
  staged Tom Nataloni's $500 under it on 2026-09-08; no dispatcher handles it,
  so Approve would have gone green and written nothing. Nobody pressed it,
  which is the only reason the money stayed findable: the row sat open for two
  days while block 23 was reserved and the $500 was already in Anthony's Venmo.
  Recorded by hand 2026-09-10, and the closed list now refuses the kind.
- `refund_needed` (first staged 2026-09-08 for nerdz, block 1): a released
  participant with a payment on file. Approve records the decision only; the
  refund itself is a Venmo Anthony sends and a ledger row he adds later,
  never the app. The payload carries participant_name, block, amount_cents,
  venmo_txn_id, payment_id and a one-line text.

- The shortcut parser (`src/lib/shortcut-grammar.ts`) stages only kinds on
  `STAGEABLE_KINDS`. A unit test asserts every action it can stage names a
  member of that list, and that every kind it marks as dispatching names a real
  key of `DISPATCH`. Rename a kind on either side and the suite goes red
  instead of the queue going quiet.
