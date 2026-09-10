# Intake grammar

How a text or a spoken note becomes an applied change without Anthony at a
keyboard. He says it, the relay turns it into a self-addressed email, the
hourly `TNF Sweep` reads it and applies or stages it.

The sweep is the only thing that writes. This file is the contract it
validates against. `docs/SWEEP_PROMPT.md` sections 4 and 1b are the
enforcement; if the two disagree, this file is right.

## The three prefixes

| Subject begins | Means | What the sweep may do |
|----------------|-------|-----------------------|
| `UPDATE TNF:` | Anthony relaying a roster fact he got by text, call or in person | Applies it. Roster is always writable. |
| `DECISION TNF:` | Anthony making a money, identity, release or refund call | Applies it, and only this prefix carries that authority. |
| `NOTE TNF:` | Context for the record | Appends to notes. Never touches a state field. |

Authority is checked on the envelope, not the words. A `DECISION TNF:`
message carries authority only when it is **from `anthonydellapia@gmail.com`
to `anthonydellapia@gmail.com`**. From anyone else, or addressed to anyone
else, it has no authority: the sweep stages it and says so. The colon is
part of the prefix.

## Body shape

- `KEY: VALUE`, one per line. Keys are case-insensitive, values are not.
- The first line is always `ACTION: <name>`.
- **One action per message.** Two `ACTION:` lines is malformed, not two
  actions. Send two messages.
- A blank line ends the block. Anything after it is ignored, so a phone's
  signature is harmless.
- An unknown key is malformed. Silence is not a value: omit the line.

## The field set, per action

**The menu is `ACTIONS` in `src/lib/intake-grammar.ts`, and that file is the
only copy.** It carries, per action: the prefix it is legal under, the required
fields, the optional ones, the `oneOf` group that identifies the person, the
`admin_*` RPC it applies or the queue kind it stages instead, and a one-line
description. Read it there.

This section used to restate all of that as three tables. They are gone
deliberately. A second copy of a contract does not stay a copy: by the time the
parser shipped, the tables had drifted into naming a field called `WHO` that the
parser has never accepted - it identifies a person by `NAME` or
`PARTICIPANT_ID` - and into putting `note` under `UPDATE TNF:` when the parser
allows it only under `NOTE TNF:`. Both would have been read as the contract by
anyone following this document, and neither would have parsed.

What this document is for is the part the code cannot carry: why a rule exists,
what it cost to learn, and what to do when a message does not fit.

### admin_upsert_participant is not a patch

Five actions call it: `participant`, `contact`, `owner`, `identity`, and a
`note` that names a person. **Its UPDATE sets every column from its arguments**,
so an argument left out is not "unchanged", it is overwritten:

| Column | What omitting it does |
|---|---|
| `email`, `cc_email`, `phone`, `display_alias`, `shared_group_id`, `source_ref`, `notes` | `nullif(arg,'')` - written as NULL, the value is gone |
| `owner_group` | `coalesce(nullif(arg,''),'AVD')` - **silently moves them into Anthony's book** |
| `blocks_requested` | `coalesce(arg,0)` - **sets the commitment to zero and wipes what they owe** |
| `source` | defaults to `email` |

So a `contact` message carrying only an email, or a `note` carrying only a note,
would destroy the rest of that person's record - and the audit row would read as
an ordinary `update_participant`, with the old values recoverable only from its
`before` payload. **Read the row, change the one field, send all of them.**

### `applies` is a default, not the whole routing

`ACTIONS[...].applies` names ONE RPC per action. One action does not have one:

**`queue` routes on `VERDICT`.** `applies` says `admin_approve_pending`
unconditionally, and the parser never branches on the verdict - it only checks
that the value is `approve` or `dismiss`. So a `VERDICT: dismiss` message,
applied through `applies` as written, calls **approve**. On a `payment` or
`reserve_blocks` row that records the payment or reserves the blocks: it does
the exact thing Anthony sent the message to refuse.

    VERDICT: approve  ->  admin_approve_pending
    VERDICT: dismiss  ->  admin_dismiss_pending

This is the one piece of routing the deleted action tables carried that
`ACTIONS` cannot express, and deleting them lost it for one commit. The parser
still wins on the field set; it just does not decide this.

### The three checks the parser CANNOT make

`parseIntake` returns them in `deferred` for the sweep to run against live data.
**A caller that ignores `deferred` has not validated the message.**

| Rule | Check | Why it cannot be static |
|------|-------|------------------------|
| 11 | `who_resolves_to_exactly_one` | Needs the roster. **What zero means depends on the action**: on `participant` with a `NAME` it means CREATE, and everywhere else - including a `participant` naming a `PARTICIPANT_ID` - it is malformed. Two matches is always malformed - never a guess, and never a new row created to make it fit. See rule 11. |
| 5 | `amount_equals_due_cents` | Needs that participant's live balance. A multiple of $500 is not enough on its own: a two-block holder owes $1,000, and `AMOUNT: 500` for him is CLAUDE.md's second sweep outcome, a non-matching multiple that goes to Anthony as a question. |
| 12 | `queue_row_is_open` | Needs the queue. A resolved row is malformed. |

## Validation rules

Every one of these is checked before anything is applied. A failure makes
the whole message malformed.

1. `OWNER` is one of `AVD` `RM` `MAP` `JPOD` `EJD` `NL` `GD` `BG`, upper
   case, exact. `DIRECT` was retired 2026-08-28 and is rejected.
   - `COLLECTED_BY` on a `payment` is from that same list and means **who is
     holding the $500**, never who introduced anyone. Leave it out when the
     money reached Anthony: that is the common case and it is the null the
     column stores. Name an owner only when that owner has said he is holding
     his own participant's cash. `admin_record_payment` reads this one field
     to decide the AVD move and reads nothing else, so `SOURCE_REF` does not
     stand in for it - a `payment` naming JPOD there and nowhere else still
     moves the participant to AVD.
2. `BLOCK` is an integer 1 to 100. `BLOCKS` is a comma-separated list of
   those, each 1 to 100, no duplicates.
3. `COUNT` is an integer, 0 to 100, and belongs to the `participant` action
   ONLY: it is that person's commitment count, `participants.blocks_requested`.
   It is not a claim field - a claim names its numbers in `BLOCKS` - and it
   never appears together with `BLOCKS` in the same message.
4. `AMOUNT` is **whole dollars**, digits only, optional leading `$`, no
   cents and no decimal point. `500` and `$1500` are fine, `500.00` is
   malformed. A thousands separator is NOT digits: `$1,500` is malformed
   too, and this rule carried it as a worked example until 2026-09-10,
   which would have had the sweep reject a message written exactly as the
   grammar told the sender to write it. The sweep converts to cents; money is stored in cents
   everywhere.
5. `AMOUNT` on a `payment` must be a multiple of 500 AND must equal that
   participant's live `due_cents`. A multiple of 500 is not enough on its
   own: a two-block holder owes $1,000, and a `DECISION TNF:` carrying
   `AMOUNT: 500` for him is the second of CLAUDE.md's three sweep outcomes,
   a non-matching multiple that goes to Anthony as a question. Stage
   `non_matching_multiple` and record nothing. Anything that is not a
   multiple of 500 at all is not a block payment and is invisible.
6. `PAID_ON` is `YYYY-MM-DD`, not in the future in America/New_York, and not
   before 2026-08-01 (the season floor).
7. **`METHOD` means two different columns and the two lists do not overlap.**
   Reading it as one list is how this rule was wrong in both directions on
   2026-09-10, first accepting values the ledger rejects and then "fixing" a
   correct example into a broken one.
   - On a `payment` it is `payments.method`, constrained to `venmo` `cash`
     `check`. `cash` says nothing about who holds it - it can be cash in
     Anthony's hand - so when it is an owner holding it, name him in
     `COLLECTED_BY`. `SOURCE_REF` is prose beside that and decides nothing.
     The column also allows `correction` and `comp`, and intake may use
     NEITHER: a correction needs the id of the payment it corrects, and a
     comp is an admin action, not something a text message asks for. `zelle`
     and `other` are NOT values - the CHECK constraint rejects them, so the
     insert would fail and a valid-looking instruction would retry forever.
   - On a `claim` it is `blocks.assignment_method`, constrained to `requested`
     `carryover` `random` `admin`, and it records HOW THE BLOCK WAS CHOSEN,
     not how anyone intends to pay. `requested` is the normal value for a
     phone claim and is the default when `METHOD` is absent. A payment method
     here fails the constraint on Approve.
8. `SOURCE` is one of `email` `text` `in_person` `import`.
9. `NAME`, `ALIAS`, `DISPLAY_NAME` and `NOTE` go in **verbatim**. No case
   fixing, no trimming beyond the leading and trailing space, no expanding
   an initial, no guessing a surname. Never invent a full name: if it is
   unknown, mirror the alias and flag it unconfirmed.
10. `EMAIL` and `CC_EMAIL` contain one address each. A shared email between
    two participants is worth noting and is never by itself a duplicate
    signal.
11. The person named - `NAME`, or `PARTICIPANT_ID` where the parser accepts
    it - must resolve to exactly one live participant, **except on
    `participant` carrying a `NAME`, where zero matches means CREATE.** That
    action exists to add someone: `admin_upsert_participant` takes a null id
    and inserts. The parser emits `who_resolves_to_exactly_one` for every
    action carrying a `NAME`, so it is the sweep that decides what zero means,
    and it means different things on different actions. Read as a blanket rule
    it made the creation path in `SWEEP_PROMPT.md` 1a unreachable through
    intake, which is how it read until 2026-09-10. On every other action, zero
    matches or two matches is malformed - never a guess, and never a new row
    created to make it fit.
    - **The exception is `NAME` only, and a `PARTICIPANT_ID` never creates
      anything.** `admin_upsert_participant` inserts only when the id it is
      handed is NULL; hand it a well-formed uuid that names no row and it
      raises `participant not found`. So a `participant` action carrying a
      `PARTICIPANT_ID` that resolves to nothing is malformed like any other -
      reject it and stage `unparsed_intake`, rather than calling the RPC and
      letting it throw.
12. `ID` on a `queue` action is a uuid that is an open row in
    `pending_actions`. A resolved row is malformed.
13. `VERDICT` is `approve` or `dismiss`, lower case.
14. An action name not in the tables above is malformed. An action used
    under the wrong prefix is malformed: `payment` under `UPDATE TNF:` is
    rejected, it is not silently downgraded.

## What happens to a malformed message

The sweep **rejects it and does not guess**. It stages one queue row of kind
`unparsed_intake` carrying the message id, the subject, the exact lines it
could not parse quoted, and the specific rule above that each line broke.
Then it labels the thread `Pool-TNF-Done` and moves on. It never partially
applies a message: an eight-line body with one bad line applies nothing.

## Worked examples

A block request relayed from a text:

```
Subject: UPDATE TNF: Colavita claim

ACTION: claim
NAME: Mike Colavita
BLOCKS: 62
METHOD: requested
NOTE: texted 2026-09-10, asked for 62 by number
```

A payment Anthony is stating himself:

```
Subject: DECISION TNF: Colavita paid

ACTION: payment
NAME: Mike Colavita
AMOUNT: $500
METHOD: venmo
PAID_ON: 2026-09-10
TXN: 4678217450148051522
NOTE: hit my Venmo, moves him to AVD
```

Cash another owner is holding, which moves nobody:

```
Subject: DECISION TNF: JPOD holding McGrorty

ACTION: payment
NAME: Konnor McGrorty
AMOUNT: $500
METHOD: cash
PAID_ON: 2026-09-10
SOURCE_REF: JPOD
COLLECTED_BY: JPOD
NOTE: Julian confirmed he is holding it, code stays JPOD
```

Clearing a queue row from a phone:

```
Subject: DECISION TNF: clear queue row

ACTION: queue
ID: 806526bf-7d90-41a5-9119-8785ebc3ffa3
VERDICT: approve
NOTE: refund sent by Venmo, ledger row added by hand
```

Two actions in one message, which is malformed and applies nothing:

```
Subject: UPDATE TNF: two things

ACTION: claim
NAME: Mike Colavita
BLOCKS: 62
ACTION: contact
NAME: Mike Colavita
EMAIL: mike@example.com
```
