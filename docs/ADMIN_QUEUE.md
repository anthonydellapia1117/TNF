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
   | `payment` | `admin_record_payment` with the payload's `participant_id`, `amount_cents`, `method`, `paid_on`, `venmo_txn_id`, `source_ref`, `note`. Refused before the RPC if `participant_id` or `paid_on` is missing or `amount_cents` is not a positive whole number of cents. Promotes the block if that settles it, as the ledger always has. |
   | `reserve_blocks` | `admin_reserve_blocks` with `block_numbers`, `participant_id`, `method`, `ref`. |
   | anything else | Records `resolution = approved` and applies nothing. Anthony does it from the relevant admin page. |

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
- Payload shapes the summary understands: `payment` carries
  `participant_id`, `participant_name`, `amount_cents`, `method`, `paid_on`,
  `venmo_txn_id`, `source_ref`, `note`; `reserve_blocks` carries
  `participant_id`, `participant_name`, `block_numbers`, `method`, `ref`.
  Any other kind is free-form and its scalar fields render as `key: value`.
- The sweep's prompt is owned by the routine, not by this file. Until it
  stages, the queue is empty and the page says so.

## Tests

- `tests/unit/pending.test.ts`: the dispatch table and the payload summary.
- `tests/sql/17_pending_actions.sql`: RLS denies anon, the RPCs refuse a
  non-admin, stage then approve resolves and writes both audit rows, a
  refused approve leaves the row open, dismiss resolves without applying.
  Runs under `npm run test:db`, which needs a local Postgres.
