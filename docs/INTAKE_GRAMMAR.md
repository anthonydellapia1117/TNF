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

`R` required, `O` optional. `WHO` means either `NAME:` (matched against the
live roster by full name, then alias, then email) or `PARTICIPANT_ID:` (the
uuid, exact).

### Under `UPDATE TNF:`

| ACTION | Fields | Effect |
|--------|--------|--------|
| `participant` | `NAME` R, `ALIAS` O, `EMAIL` O, `CC_EMAIL` O, `PHONE` O, `OWNER` O, `SOURCE` O, `COUNT` O, `NOTE` O | `admin_upsert_participant`. A blank `OWNER` falls back to `AVD`. **`COUNT`, never `BLOCKS`.** `p_blocks_requested` is a scalar commitment, and `BLOCKS` is a list of block NUMBERS: `BLOCKS: 62` on this action reads either as block 62 or as sixty-two blocks requested, which is $31,000 due. The grammar carried that ambiguity until 2026-09-10 and gave no conversion rule. Numbers are chosen by a `claim`; this action only records how many. |
| `claim` | `WHO` R, **`BLOCKS` R**, `METHOD` O, `NOTE` O | Stages a `reserve_blocks` row. A specific block number only goes to someone who specifically asked for it. `COUNT` is NOT an accepted alternative: `admin_reserve_blocks` raises `no block numbers given` on an empty array, so a `COUNT`-only claim stages a row whose Approve fails and leaves Anthony a dead button. Someone who wants a block without naming one gets T2 and picks from the board. |
| `contact` | `WHO` R, and at least one of `EMAIL`, `CC_EMAIL`, `PHONE` | `admin_upsert_participant`, contact fields only. |
| `block_name` | `BLOCK` R, `DISPLAY_NAME` R | `admin_set_block_name`. |
| `note` | `WHO` R **or** `BLOCK` R, `NOTE` R | Appends a dated note. |

### Under `DECISION TNF:`

| ACTION | Fields | Effect |
|--------|--------|--------|
| `payment` | `WHO` R, `AMOUNT` R, `METHOD` R, `PAID_ON` R, `TXN` O, `SOURCE_REF` O, `COLLECTED_BY` O, `NOTE` O | `admin_record_payment`, then `admin_promote_if_paid`. Money that reached Anthony also moves the participant to `AVD` in the same operation, and `COLLECTED_BY` is the only thing that stops it. |
| `owner` | `WHO` R, `OWNER` R, `REASON` R | `admin_upsert_participant`, owner code only. |
| `release` | `BLOCK` R, `REASON` R | `admin_release_block`. Prior holder kept in the block's notes. The participant row is never deleted. **Set `blocks_requested` to what he still holds, not to 0.** Zero is right only when the released block was his last one. Seven people hold more than one today and Ed D holds three: releasing one of his and zeroing the count would erase $1,000 of his own remaining commitment and leave him holding two numbered blocks against a commitment of none, which is the state self-check 7b now reports as an error. |
| `refund` | `WHO` R, `BLOCK` R, `AMOUNT` R, `TXN` R, `REASON` R | Stages a `refund_needed` row. **The app never moves money.** The Venmo is Anthony's, the ledger row is his, later. |
| `queue` | `ID` R, `VERDICT` R (`approve` or `dismiss`), `NOTE` O | `admin_approve_pending` or `admin_dismiss_pending` on that row. This is how a queue row gets cleared from a phone. |
| `identity` | `KEEP` R, `OTHER` R, `NOTE` R | Records the call as a dated note on both participants and dismisses the open `identity_conflict` row. Never merges or deletes a row. |

### Under `NOTE TNF:`

| ACTION | Fields | Effect |
|--------|--------|--------|
| `note` | `WHO` R **or** `BLOCK` R, `NOTE` R | Appends a dated note. Nothing else, whatever else the body says. |

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
11. `WHO` must resolve to exactly one live participant. Zero matches or two
    matches is malformed, never a guess and never a new row created to make
    it fit.
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
