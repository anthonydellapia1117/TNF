# The shortcut grammar

One message, one action, no prose. Anthony writes it from his phone in about
fifteen seconds; the hourly sweep parses it into exactly one row on
`/admin/queue` and never guesses at the rest.

The parser is `src/lib/shortcut-grammar.ts`. Every rule below is enforced
there and covered by a fixture in `tests/unit/shortcut-grammar.test.ts`, so
the doc and the behaviour cannot drift apart quietly.

## The shape

```
Subject: <PREFIX> TNF: <action> - <target>

KEY: VALUE
KEY: VALUE
```

- **Prefix** is `UPDATE`, `DECISION` or `NOTE`, uppercase.
- ` TNF: ` is literal. One space after the colon, no more.
- **action** is lowercase kebab-case, from the menu below.
- ` - ` is a plain hyphen with a space each side. Never an em dash: phone
  keyboards substitute one, and the parser refuses it on purpose so the
  substitution is caught at the door rather than halfway through a payload.
- **target** is who or what this is about, 1-80 characters. It is a label for
  the queue row, not a lookup key.
- The **body** is `KEY: VALUE` lines and nothing else. No blank lines, no
  greeting, no sign-off, no second action.

## What each prefix may do

| Prefix | May mark paid | May settle identity | May release a block |
|---|---|---|---|
| `UPDATE` | no | no | no |
| `DECISION` | **yes** | **yes** | **yes** |
| `NOTE` | no | no | no |

`UPDATE` states a fact that arrived. `DECISION` is Anthony making a call.
`NOTE` is context for the record and changes nothing, ever. The parser checks
the prefix against the action, so `UPDATE TNF: payment - ...` is refused with
that reason rather than downgraded.

## The menu

Ten actions. Anything else is refused by name.

| Prefix | Action | Required keys | Optional | Approve applies |
|---|---|---|---|---|
| UPDATE | `block-request` | PARTICIPANT, BLOCKS, ASSIGN | OWNER, REF, NOTE | **`admin_reserve_blocks`** |
| UPDATE | `new-participant` | FULL_NAME, ALIAS, OWNER, COUNT, SOURCE, SOURCE_DATE | SOURCE_REF, NOTE | nothing |
| UPDATE | `owner-move` | PARTICIPANT, FROM_OWNER, TO_OWNER, REASON | NOTE | nothing |
| UPDATE | `contact` | PARTICIPANT, CONTACT_FIELD, SOURCE_MSG | NOTE | nothing |
| DECISION | `payment` | PARTICIPANT, AMOUNT, BLOCKS_COVERED, PAY_METHOD, PAID_ON | VENMO_TXN, OWNER_HOLDING, SOURCE_MSG, NOTE | **`admin_record_payment`** |
| DECISION | `release-block` | BLOCKS, TO_STATUS, REASON | PARTICIPANT, NOTE | nothing |
| DECISION | `hold-block` | BLOCKS, TO_STATUS, REASON | NOTE | nothing |
| DECISION | `comp` | PARTICIPANT, BLOCKS, COMPED, REASON | NOTE | nothing |
| DECISION | `identity` | PARTICIPANT, OTHER, SAME_PERSON, REASON | NOTE | nothing |
| NOTE | `note` | SUBJECT_TYPE, SUBJECT, NOTE | SOURCE_MSG | nothing |

### "Approve applies nothing" is the normal case, and it is not a bug

`pending_actions.kind` has no enum. The column check is `length(kind) between
1 and 64` and nothing more, so a kind the `CASE` in `admin_approve_pending`
has never heard of inserts perfectly happily, sits in the queue looking
exactly like a real item, and applies **nothing** when Anthony presses
Approve. There is no error. The row just goes green.

Two kinds dispatch, and only two: `payment` runs `admin_record_payment`, and
`reserve_blocks` runs `admin_reserve_blocks`. Every other action here records
Anthony's decision and waits for him on the relevant admin page. That is the
right design - releasing a block and settling an identity both want a human
on the right screen - but it only works when it is said out loud.

So the parser returns `dispatch` on every action, `/admin/queue` prints one
line saying what Approve will do, and a unit test asserts that every non-null
`dispatch` names a real key of `DISPATCH` in `src/lib/pending.ts`. Rename a
kind on one side and the suite goes red instead of the queue going quiet.

## Values

| Key | Rule |
|---|---|
| `AMOUNT` | Whole dollars. No `$`, no cents, no sign, no thousands separator. `500`, not `$500.00`. |
| `BLOCKS_COVERED` | How many blocks this money settles. `AMOUNT` must equal $500 x this. |
| `BLOCKS` | Block numbers 1-100, comma separated. No repeats. |
| `COUNT` | A whole number of blocks, 1-100. |
| `OWNER`, `FROM_OWNER`, `TO_OWNER`, `OWNER_HOLDING` | `AVD` `MAP` `RM` `JPOD` `EJD` `NL` `GD` `BG`. Nothing else - `DIRECT` was retired by migration 13. |
| `SOURCE` | `email` `text` `in_person` `import`. |
| `SOURCE_DATE` | `YYYY-MM-DD`, and a real date. Separate key from `SOURCE`. |
| `ASSIGN` | `requested` `carryover` `random` `admin`. |
| `TO_STATUS` | `available` `reserved` `assigned` `held`. `release-block` must end at `available`, `hold-block` at `held`. |
| `PAY_METHOD` | `venmo` `cash` `check`. Never `correction` or `comp`: those never arrive by note. |
| `PAID_ON` | `YYYY-MM-DD`, and a real date. |
| `COMPED`, `SAME_PERSON` | `yes` or `no`. Not `true`. |
| `SUBJECT_TYPE` | `participant` `block` `game` `pool`. |
| `CONTACT_FIELD` | `email` or `phone` - the field that changed, never the value. |
| `SOURCE_MSG` | A Gmail message id. |

Money is stored in cents everywhere in this app. The body is whole dollars
because that is what a person types at a traffic light; the one conversion
happens inside the parser and nowhere else.

**$500 x blocks covered is checked, not assumed.** A two-block holder sending
$500 is a part payment, and a part payment is a question for Anthony, not a
row in an append-only ledger. The parser refuses it and says so.

## What a body may never carry

Refused by the parser, not merely discouraged here:

- **Email addresses and phone numbers.** Neither the key (`EMAIL`, `PHONE`,
  `CC_EMAIL`, `MOBILE`) nor a value that looks like one. This is why `contact`
  names the field that changed and points at the Gmail message: the new
  address is read from the message, never copied into an audit payload that
  nobody can delete.
- **Passwords, passcodes, PINs, tokens.**
- **Totals, money collected, money owed, the pot, margin, house, profit,
  break-even, payout liability.** None of these belongs in a message, and
  several are admin-only numbers on purpose.
- **Digits, drawn or undrawn.** Digits live in the database, are immutable
  once written, and are drawn one week at a time so they do not exist early.
  A digit in an email is a digit someone could see or alter.
- **Anything about the other pool.** The Survivor pool is a separate system.
  A body mentioning it is refused.

A Venmo transaction id is 19 digits and passes. The phone check is bounded to
10 and 11 digits precisely so it does not eat one - checked against a real
transaction id, not assumed.

## Examples

Reserving a block someone specifically asked for:

```
Subject: UPDATE TNF: block-request - Konnor McGrorty

PARTICIPANT: Konnor McGrorty
BLOCKS: 51
ASSIGN: requested
REF: text 2026-11-02
```

Money in, two blocks settled with one Venmo:

```
Subject: DECISION TNF: payment - Anthony Astorga

PARTICIPANT: Anthony Astorga
AMOUNT: 1000
BLOCKS_COVERED: 2
PAY_METHOD: venmo
PAID_ON: 2026-11-03
VENMO_TXN: 4681784574292679976
```

Cash an owner is holding. The owner keeps the code - only money that actually
reached Anthony moves anyone to `AVD`:

```
Subject: DECISION TNF: payment - Konnor McGrorty

PARTICIPANT: Konnor McGrorty
AMOUNT: 500
BLOCKS_COVERED: 1
PAY_METHOD: cash
PAID_ON: 2026-11-04
OWNER_HOLDING: JPOD
```

Killing a false positive for good:

```
Subject: NOTE TNF: note - Vincent Angiolillo

SUBJECT_TYPE: participant
SUBJECT: Vincent Angiolillo
NOTE: the $30 Venmo on 2026-11-01 was unrelated, do not re-flag
```

## When it does not parse

The sweep replies with the reasons and stages nothing. There is no partial
parse and no best guess. A message Anthony rewrites costs fifteen seconds; a
message the sweep half-understood costs a wrong row in a ledger that is
append-only by design.
