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
| `participant` | `NAME` R, `ALIAS` O, `EMAIL` O, `CC_EMAIL` O, `PHONE` O, `OWNER` O, `SOURCE` O, `BLOCKS` O, `NOTE` O | `admin_upsert_participant`. A blank `OWNER` falls back to `AVD`. |
| `claim` | `WHO` R, `BLOCKS` R **or** `COUNT` R, `METHOD` O, `NOTE` O | Stages a `reserve_blocks` row. A specific block number only goes to someone who specifically asked for it. |
| `contact` | `WHO` R, and at least one of `EMAIL`, `CC_EMAIL`, `PHONE` | `admin_upsert_participant`, contact fields only. |
| `block_name` | `BLOCK` R, `DISPLAY_NAME` R | `admin_set_block_name`. |
| `note` | `WHO` R **or** `BLOCK` R, `NOTE` R | Appends a dated note. |

### Under `DECISION TNF:`

| ACTION | Fields | Effect |
|--------|--------|--------|
| `payment` | `WHO` R, `AMOUNT` R, `METHOD` R, `PAID_ON` R, `TXN` O, `SOURCE_REF` O, `NOTE` O | `admin_record_payment`, then `admin_promote_if_paid`. Money that reached Anthony also moves the participant to `AVD` in the same operation. |
| `owner` | `WHO` R, `OWNER` R, `REASON` R | `admin_upsert_participant`, owner code only. |
| `release` | `BLOCK` R, `REASON` R | `admin_release_block`. Prior holder kept in the block's notes. The participant row is never deleted; it stays with `blocks_requested = 0` and a dated note. |
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
2. `BLOCK` is an integer 1 to 100. `BLOCKS` is a comma-separated list of
   those, each 1 to 100, no duplicates.
3. `COUNT` is an integer 1 or more, and never appears together with
   `BLOCKS`.
4. `AMOUNT` is **whole dollars**, digits only, optional leading `$`, no
   cents and no decimal point. `500` and `$1,500` are fine, `500.00` is
   malformed. The sweep converts to cents; money is stored in cents
   everywhere.
5. `AMOUNT` on a `payment` must be a multiple of 500. Anything else is a
   question for Anthony, not a payment.
6. `PAID_ON` is `YYYY-MM-DD`, not in the future in America/New_York, and not
   before 2026-08-01 (the season floor).
7. `METHOD` is one of `venmo` `cash` `check` `zelle` `other`, on a `payment`
   and on a `claim` alike. `cash` names the owner holding it in `SOURCE_REF`.
   On a `claim` it is how he INTENDS to pay and nothing is recorded from it;
   the list is still closed, so `requested` is not a value (the worked claim
   example used it, and the sweep would have staged that message as
   `unparsed_intake` rather than reserving the block).
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
COUNT: 1
METHOD: venmo
NOTE: texted 2026-09-10, no specific block asked for
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
COUNT: 1
ACTION: contact
NAME: Mike Colavita
EMAIL: mike@example.com
```
