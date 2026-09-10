# Routines

Three routines run this pool. One writes, two report. Rewritten 2026-09-10
from a set of six, of which all six were disabled and three had a stored cron
that did not match what this file claimed.

| # | Name | Trigger | Stored cron (UTC) | Writes | Connectors on it |
|---|------|---------|-------------------|--------|------------------|
| 1 | TNF Sweep | `trig_017vcw3ADZHPVpKVXS1s1B7X` | `43 11-23,0-4 * * *` **target, not applied** | yes, the only one | Gmail, Supabase |
| 2 | TNF Game Day | `trig_01QLquSeCUP8wc3DxPfzzQRY` | `10 14 1,24-28,31 1,11,12 *` | files only, and a draft | Gmail, Supabase |
| 3 | TNF Draw Window | `trig_01TmmBwcxWv5FdJGspjunhn9` | `37 14 22,24,29 11,12 *` | no | none needed |

**The sweep is the one thing this rebuild could not finish.** It is still
named `TNF Gmail Sweep`, still disabled, and still carries `43 11-23,0-2 * * *`
and its old prompt. It was created through the HTTP API rather than by an agent,
and the platform refuses an agent update on such a routine: `update_trigger:
this routine was created via "http_api", not by an agent`. Three edits by hand
finish it, and they are listed under **Blocked: the sweep** below.

Retired the same day, disabled and kept for their run history:

| Name | Trigger | Retired | Absorbed by |
|------|---------|---------|-------------|
| TNF Chase List | `trig_016ZLMsWxbcejrQK2XdJkTza` | 2026-09-10 | TNF Sweep, the 10:43 PM digest |
| TNF Game Day Digits | `trig_01EptwvxHH2mdctyMzsaH9XC` | 2026-09-10 | TNF Game Day, phase A step 1 |
| TNF Post-Game Check | `trig_01HJ81a3TUtwMozA32vaqMLN` | 2026-09-10 | TNF Game Day, phase B |

Never delete one of these. A delete loses the run history and, for the three
live ones, the repo source and the connectors, which `update_trigger` cannot
put back.

## Blocked: the sweep

Three edits, in the UI, by hand. Nothing else in this file is waiting on
anything.

**claude.ai > Code > Routines > TNF Gmail Sweep**

| Field | Set it to |
|-------|-----------|
| Name | `TNF Sweep` |
| Schedule / cron | `43 11-23,0-4 * * *` |
| Prompt | the whole fenced block in `docs/SWEEP_PROMPT.md`, replacing what is there |
| Enabled | on |

You should see the routine listed as `TNF Sweep`, enabled, next run within the
hour, with Gmail and Supabase still on its connector list. Its connectors and
its repo source are already correct and must not be re-added; **do not delete
and recreate it**, because a delete loses the run history, the repo source and
both connectors, and `update_trigger` cannot put any of those back.

Until those edits are made: no mail is being swept, no payment candidate is
being staged, nothing is being labelled `Pool-TNF-Done`, and there is no
nightly digest. `Pool-TNF` has 0 unread today, so nothing is currently piling
up, but a payment that arrives before the edits lands in mail and stays there.

## How this file was verified

Every line about a routine's live state was read back off the trigger record
after the change, not assumed from the call that made it. The two prompts that
a session could write are byte-identical to their source in this repo:

| Routine | Stored prompt vs repo | Checked |
|---------|----------------------|---------|
| TNF Game Day | identical, 7,903 chars, against the fenced block below | 2026-09-10 |
| TNF Draw Window | identical, 3,100 chars, against the fenced block below | 2026-09-10 |
| TNF Sweep | not written, the update was refused | 2026-09-10 |

The read-back is the same server-side record the Routines UI renders; there is
no second store behind the screen. It was **not** confirmed by opening the UI in
a browser: this rebuild ran in a Linux container with no claude.ai session, and
signing one in would have meant typing a password, which is not something a
session does.

## Standing rules, every routine

- Step 0 is always `TZ=America/New_York date`. That output is the clock.
  Ignore any date injected into the conversation.
- CLAUDE.md outranks the prompt. A prompt restates a rule only so the session
  knows where to look.
- Only TNF Sweep writes to the database, and only within the authority in
  `docs/SWEEP_PROMPT.md`. The other two read the public projections through
  the anon key in `src/lib/env.ts`, RLS-bounded by design.
- **Email is a closed list of two, and only TNF Sweep holds it.** It may send
  a reply drawn verbatim from the T1-T7 allowlist to the sender only, and the
  nightly digest to Anthony's own address alone (he authorised that one send on
  2026-09-10, because it goes to him and he is not watching a screen). Nothing
  else: no free-form mail, no reply outside the allowlist, no second recipient.
  **TNF Game Day still sends nothing** - its pack is a draft Anthony presses
  send on himself, and that is one of the three things he kept. Until
  2026-09-10 this line read "no routine ever sends an email", which contradicted
  the two sends the sweep prompt already authorised; `docs/SWEEP_PROMPT.md` 1d
  is the same list and the two are meant to be read together.
- No routine marks a payout Paid, moves money, draws or publishes digits,
  confirms a date, scores a game, or resolves an identity.
- The Survivor pool is never read, referenced or mentioned.
- A report is a `NEEDS ANTHONY` section, one line per item with the admin
  route where he acts, or the two words `NO ACTION`.

## The cron lines, and the arithmetic

Stored crons are UTC. The season is entirely after the November 1 clock
change, so every game date reads as EST, UTC-5. Today is EDT, UTC-4.

### TNF Sweep: `43 11-23,0-4 * * *`

Intent: hourly on the :43, 7 AM to 11 PM ET, which is 17 runs.

Neither of the two values that existed on 2026-09-10 matched that intent, and
they did not match each other. **Both were changed.**

| Where | Value | UTC hours | In EDT | In EST |
|-------|-------|-----------|--------|--------|
| this file, before | `43 7-23 * * *` | 7 to 23 | 3:43 AM to 7:43 PM | 2:43 AM to 6:43 PM |
| the routine, before | `43 11-23,0-2 * * *` | 16 hours | 7:43 AM to 10:43 PM | 6:43 AM to 9:43 PM |
| both, now | `43 11-23,0-4 * * *` | 18 hours | 7:43 AM to 12:43 AM | 6:43 AM to 11:43 PM |

A single cron line cannot be right in both offsets, so the stored line is the
union: it covers the whole 7 AM to 11 PM ET band in EST and in EDT, at the
cost of one idle run per day at one end. 18 runs, of which 17 are the intent
and 1 is the overlap. An idle sweep costs a session and finds nothing; a
missing hour can miss a payment, so the union is the cheap side of the trade.

The nightly digest is chosen by the **ET clock**, not by the cron: the run
whose America/New_York hour is 22. That is 02:43 UTC in EDT and 03:43 UTC in
EST, and both are in the set, so the digest fires exactly once a day in either
offset.

### TNF Game Day: `10 14 1,24-28,31 1,11,12 *`

9:10 AM EST. Nine dates matter: the six game dates and the three mornings
after that are not themselves game dates.

| Date | Phase A, games today | Phase B, scored last night |
|------|----------------------|----------------------------|
| Wed Nov 25 | G01 | - |
| Thu Nov 26 | G02, G03, G04 | G01 |
| Fri Nov 27 | G05 | G02, G03, G04 |
| Sat Nov 28 | - | G05 |
| Thu Dec 24 | G06 | - |
| Fri Dec 25 | G07, G08, G09 | G06 |
| Sat Dec 26 | - | G07, G08, G09 |
| Thu Dec 31 | G10 | - |
| Fri Jan 1 | - | G10 |

A 5-field cron holds one minute and one hour, so the two times in the brief
(9:10 AM for the pack, 10:07 AM the next morning) cannot both be stored on one
routine. **One time is stored, 9:10 AM EST, and one run does both phases.** On
Nov 26, Nov 27 and Dec 25 that is strictly better: one session does the
morning-after check and the pack for that day's games together. The cost is
that the morning-after check runs 57 minutes earlier than the retired
TNF Post-Game Check did; a score not yet entered by 9:10 AM produces the
"G<xx> is not final" line, which is the line that job existed to produce.

Days `1,24-28,31` across months `1,11,12` is 20 fires a year: 7 in January
(Nov has no 31st, so 6 in November, and 7 in December). Nine are the dates
above. The other 11 read the games table, find no game today and none scored
last night, and report `NO ACTION`.

### TNF Draw Window: `37 14 22,24,29 11,12 *`

9:37 AM EST on the three draw Tuesdays: Nov 24 for G01-G05 (week 12), Dec 22
for G06-G09 (week 16), Dec 29 for G10 (week 17). Each is inside the 7-day
window and never ahead of it, since the furthest game of the week sets the
gate.

The brief keeps two lines, `37 14 24 11 *` and `37 14 22,29 12 *`. One routine
takes one line, so the stored line is the smallest union containing both:
days 22, 24 and 29 across November and December, 6 fires.

| Fire | What it finds |
|------|---------------|
| Nov 22 | week 12 is already inside the window on Nov 22, so it names the draw two days early. Early, not wrong. |
| **Nov 24** | the draw day for G01-G05. |
| Nov 29 | week 16 is 25 days out. `NO ACTION`. |
| **Dec 22** | the draw day for G06-G09. |
| Dec 24 | week 16 should be drawn and published by now, so `NO ACTION`, and a safety net if it is not. Week 17 is 7 days 10 hours out, outside the window. |
| **Dec 29** | the draw day for G10. |

## Connectors, and what can and cannot be changed from a session

Every routine below was created from a Claude Code session. Two things about
that path matter and the older version of this file had both wrong.

- **`create_trigger` does take a `connectors` list.** The claim that the org
  rejects it was stale. All three live routines already carry the connectors
  they need, verified 2026-09-10 by reading `mcp_connections` back off each
  trigger.
- **`update_trigger` cannot change a connector, a repo source, an allowed
  tool or an environment variable.** It takes `name`, `cron_expression`,
  `enabled`, `model` and `prompt`, and nothing else. So a connector change on
  an existing routine is a UI job: claude.ai > Code > Routines > (name) >
  Connectors. If the UI cannot do it either, **say so and stop.** Do not
  delete and recreate to work around it: that loses the run history, the repo
  source and the environment.

| Routine | Gmail | Supabase | Repo source | Environment |
|---------|-------|----------|-------------|-------------|
| TNF Sweep | yes | yes | `anthonydellapia1117/TNF` | - |
| TNF Game Day | yes | yes | `anthonydellapia1117/TNF` | `ADMIN_PASSWORD` **missing**, `TNF_OWNER_EMAILS` **missing** |
| TNF Draw Window | - | - | none, the prompt clones | - |

TNF Game Day runs without either variable and says so in its report: no
`ADMIN_PASSWORD` means the grid is not uploaded and the draft carries the live
grid link instead of two file links; no `TNF_OWNER_EMAILS` means the owners are
not on the To line. Both are set by hand at **claude.ai > Code > Routines >
TNF Game Day > Environment variables**, field name on the left, value on the
right. No session can set them, and no session should ever print
`ADMIN_PASSWORD`.

## 1. TNF Sweep

- **When:** hourly on the :43. See the cron table above.
- **Trigger:** `trig_017vcw3ADZHPVpKVXS1s1B7X`
- **Prompt:** `docs/SWEEP_PROMPT.md` is the source of truth. The copy stored
  on the routine is a copy. Edit the file, commit it, then push the same text
  onto the routine.
- **Write authority:** level B. Roster always. Money, identity, release and
  refund only on mail from `anthonydellapia@gmail.com` to
  `anthonydellapia@gmail.com` with a subject beginning `DECISION TNF:`.
  Everything else stages at `/admin/queue`.
- **Intake grammar:** `docs/INTAKE_GRAMMAR.md`, and the iMessage relay that
  feeds it is `scripts/imessage-relay/`.

This routine absorbed TNF Chase List. The chase list was a daily roll-up of
Reserved blocks with no payment recorded; it is now the first section of the
10:43 PM digest, on the routine that already reads the same mail.

## 2. TNF Game Day

- **When:** 9:10 AM EST on the nine dates in the table above.
- **Stored cron (UTC):** `10 14 1,24-28,31 1,11,12 *`
- **Trigger:** `trig_01QLquSeCUP8wc3DxPfzzQRY`
- **Absorbed:** TNF Game Day Digits (phase A step 1) and TNF Post-Game Check
  (phase B). It was TNF Game Day Pack.

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only, never an em dash or an en dash.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. The repo anthonydellapia1117/TNF is this routine's source. If it is not in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it, then npm ci. Live game state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/<view> with headers "apikey: <key>" and "Authorization: Bearer <key>". Views: v_public_games?order=game_no, v_public_blocks, v_public_payouts. Anon reads only, bounded by RLS. Never look for another key. If the clone, the install or a read fails, the report is one NEEDS ANTHONY line naming the failed step. Never guess state.
0b. Hard limits: never send an email, only create a draft. Never write to the database. Never enter or correct a score, never create, void, settle or mark a payout Paid, never draw, publish or alter digits, never confirm a date, never resolve an identity conflict, never move, release or assign a block, never move money, never delete anything. Email addresses and ADMIN_PASSWORD are secrets: addresses go into the draft's BCC and nowhere else, never into the report and never into a file in the repo; the password is never printed or copied anywhere. The Survivor pool is a separate system: never read its mail, labels, repo or database, never mention it.
0c. This run has two phases and does both. Phase A is for games whose kickoff, in America/New_York, falls on today's date. Phase B is for games whose final_scored_at or kickoff falls on yesterday's date. A date can have both, neither, or one. If both phases have nothing, the entire report is the words NO ACTION.

PHASE A, games today.
A1. The 8:00 AM ET reveal has already passed, so row_digits and col_digits must both be non-null in the projection. One NEEDS ANTHONY line per failure, then continue:
    - digits null and digits_assigned false: "G<xx> <away> at <home> kicks off <time> ET today and digits are not drawn. Draw and publish now at /admin/digits."
    - digits null and digits_assigned true: "G<xx> kicks off <time> ET today and digits are not live. Publish now at /admin/digits, it goes out immediately."
    - digits_reveal_at later than kickoff_at: "G<xx> reveal is scheduled after kickoff. Fix at /admin/digits."
A2. Recipients. Through the Supabase connector, run the read-only SQL in docs/ROUTINES.md under "The recipient query" and write the rows as a JSON array to a file OUTSIDE the repo, for example /tmp/participants.json: full_name, display_alias, email, cc_email, blocks. If the Supabase connector is not available, skip to A5 with the line "Supabase connector missing on this routine, no recipient list. Add it at claude.ai/code > Code > Routines > TNF Game Day > Connectors."
A3. For each game today run: npm run game-day -- --game <N> --participants /tmp/participants.json --upload when ADMIN_PASSWORD is set in the environment, and --link-only instead of --upload when it is not. Exit 0 prints the subject, the counts, the holders with no email, the file paths and, with --upload, the two public links. Exit 2 means the digits are not live: do NOT pass --allow-undrawn, add "G<xx> digits are not live, grid not rendered. Publish at /admin/digits, then rerun npm run game-day -- --game <N> --upload." and continue with the next game. Exit 4 means the admin sign-in or an upload failed after retries; the message says whether nothing was replaced or the PDF was replaced and the PNG was not. Rerun once with --upload; if it fails again rerun with --link-only and add "Grid upload failed (exit 4): <the message>. Check ADMIN_PASSWORD in this routine's environment variables and that migration 22 (bucket game-day) is applied."
A4. One Gmail DRAFT per game, never a send: subject and body verbatim from the manifest, To as the manifest's to list, Bcc as the manifest's bcc list, no Cc, no attachments. If the to list is Anthony alone, TNF_OWNER_EMAILS is not set: still create the draft and add "TNF_OWNER_EMAILS is not set on this routine, the owners are not on the To line. Add it at claude.ai/code > Code > Routines > TNF Game Day > Environment variables." When the body carries a link, write it as the bare URL and nothing else: no tracking wrapper, no second URL. If a draft with that subject already exists in Drafts, update it in place instead of creating a second one. If Gmail is not available, add "Gmail connector missing on this routine, draft not created. Add it at claude.ai/code > Code > Routines > TNF Game Day > Connectors." and report the manifest path instead.
A5. Phase A lines, per game: "G<xx> draft is in Gmail Drafts: <distinct> recipients (<withEmail> holders with an address, <cc> cc addresses, <shared> shared), <withoutEmail> holders with no email: <names with block numbers>. <links line>. Review and send." The links line is "Links: <png url>, <pdf url>" when the manifest's links field is set, and "Links: none, the body carries the live grid link only" when it is null. Never invent a URL.

PHASE B, the morning after.
B1. Unscored games. Every game whose kickoff is in the past and whose status is not final and not void: "G<xx> <away> at <home> kicked off <day> <time> ET and is not final. Enter halftime and final at /admin/score, echo-confirm away at home." Report it whether it was last night or a week ago.
B2. For every game with final_scored_at in the last 26 hours:
    a. Recompute both winners from the projection, per the CLAUDE.md grid orientation: HOME across the top, AWAY down the left. row = index of the AWAY score's last digit in row_digits, col = index of the HOME score's last digit in col_digits, block = row * 10 + col + 1. Do it for the halftime score and for the final. If your result differs from halftime_block or final_block: "G<xx> <halftime or final>: computed block <b>, projection says <b2>. Review at /admin/score." Never guess which is right.
    b. Look up each winning block in v_public_blocks. If its status is not assigned: "G<xx> <halftime or final> hit block <b> (<display_name>, <status>). No payout by rule, review flag at /admin/payouts." Only an Assigned block receives a payout. This is the existing Reserved-versus-Assigned rule operating normally; it needs no new logic.
    c. If a winning block is assigned, v_public_payouts must hold a row for that game_id and payout_type. Missing: "G<xx> is final with no <type> payout recorded. Review at /admin/payouts."
    d. For each payout row present, search Gmail read-only for a Venmo receipt from Anthony to that winner, subject or body "You paid", for exactly that amount, dated after final_scored_at. Every game is one payout tier: $1,500 halftime, $3,000 final. Fetch matches in full with get_thread, never a search preview. Found: "G<xx> <type> block <b> <display_name> $<amount>: Venmo receipt <date>. Mark paid at /admin/payouts if not already." Not found: "G<xx> <type> block <b> <display_name> $<amount>: no Venmo receipt in mail. If paid by cash or elsewhere, mark paid at /admin/payouts." Paid versus owed is admin-only and invisible here, so this is a reminder, not a finding. If Gmail is not available, skip the search and add "Gmail connector missing on this routine, receipts not checked."
B3. Older finals. For every game final more than 26 hours ago, run only B2c. A missing payout row for an assigned winner stays reported until it is fixed.

REPORT. One section titled NEEDS ANTHONY: the phase A lines, then the phase B lines. Nothing else. Never print an email address or a password. If both phases are empty, the entire report is the words NO ACTION.
```

### The recipient query

Read-only, run through the Supabase connector as the admin. Email is a secret:
it goes to `/tmp/participants.json` and into the draft's Bcc, never into the
report and never into the repo.

```sql
select p.full_name, p.display_alias, p.email, p.cc_email,
       array_agg(b.block_number order by b.block_number) as blocks
from participants p
join blocks b on b.participant_id = p.id and b.status in ('reserved','assigned')
group by p.id, p.full_name, p.display_alias, p.email, p.cc_email
order by p.full_name;
```

## 3. TNF Draw Window

- **When:** 9:37 AM EST on Nov 22, 24, 29 and Dec 22, 24, 29. See the table
  above for which three matter.
- **Stored cron (UTC):** `37 14 22,24,29 11,12 *`
- **Trigger:** `trig_01TmmBwcxWv5FdJGspjunhn9`
- **Connectors:** none. It does not read mail and does not need Supabase; the
  prompt clones the repo and reads the anon projection.

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only, never an em dash or an en dash.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. If the repo anthonydellapia1117/TNF is not already checked out in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. Live state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/v_public_games?order=game_no with headers "apikey: <key>" and "Authorization: Bearer <key>". Anon reads only, bounded by RLS. Never write to the database, never look for another key. If the clone or the read fails, the report is a single NEEDS ANTHONY line naming the failed step. Do not guess state.
0b. Hard limits: never draw, publish, schedule or alter digits, never confirm a date, never mark anything Paid, never resolve an identity conflict, never send or reply to email, never move money. The two clicks at /admin/digits (draw, then publish) are Anthony's. Gmail is not needed for this job; do not read mail. The Survivor pool is a separate system: never read its mail or labels, never mention it.

1. Rules from CLAUDE.md and src/lib/week-digits.ts: digits are drawn one week at a time, a game is drawable only when its kickoff is within 7 days (168 hours), a week is drawn as a unit so the furthest game in it sets the gate, a game cannot be drawn while date_confirmed is false or after kickoff, each game is its own independent draw with its own permutation of each axis and no shared seed, and the reveal is 8:00 AM ET on each game's own date.
2. For every game with status not final and not void, compute hours to kickoff. Group by week. The restructured season is three draw weeks: week 12 is G01-G05, week 16 is G06-G09, week 17 is G10.
3. For each week with at least one game inside the 7-day window, one NEEDS ANTHONY line per problem:
   - digits_assigned false: "Week <n>: draw G<xx> <away> at <home>, kicks off <day> <time> ET, at /admin/digits, then publish. Reveal is 8:00 AM ET on <date>."
   - digits_assigned true and digits_reveal_at null: "Week <n>: G<xx> is drawn but not published. Publish at /admin/digits."
   - digits_reveal_at set and later than kickoff_at: "G<xx> reveal is scheduled after kickoff. Fix at /admin/digits."
   - date_confirmed false: "G<xx> date unconfirmed, cannot be drawn. Confirm at /admin/games."
4. Look ahead: any game 7 to 14 days out with date_confirmed false gets the same confirm line, so it is confirmed before its window opens.
5. A game the draw would skip anyway, void, date-unconfirmed, past kickoff or already drawn, never holds its week back. Say which games a week's draw would actually cover.
6. Report. If there is at least one line, the report is a section titled NEEDS ANTHONY with those lines and nothing else. Otherwise the entire report is the words NO ACTION.
```

## Retired routines

Disabled, never deleted. Each name carries `(retired 2026-09-10)` in the UI so
the list reads at a glance.

- **TNF Chase List**, `trig_016ZLMsWxbcejrQK2XdJkTza`. Daily roll-up of
  Reserved blocks with no payment recorded, plus any dated commitment in mail.
  Absorbed by the TNF Sweep 10:43 PM digest, which reads the same mail hourly
  and already holds the payment-matching rules. Its last run was 2026-09-08.
- **TNF Game Day Digits**, `trig_01EptwvxHH2mdctyMzsaH9XC`. Confirmed digits
  were live after the 8:00 AM reveal. Absorbed by TNF Game Day phase A step 1,
  which checks the same three conditions on the same morning, before rendering
  the grid that depends on them. Never fired.
- **TNF Post-Game Check**, `trig_01HJ81a3TUtwMozA32vaqMLN`. Recomputed
  winners, flagged a winner on a non-assigned block, confirmed payout rows.
  Absorbed verbatim as TNF Game Day phase B. Its last run was 2026-09-05.

Reversing a retirement is `enabled = true` plus dropping the suffix from the
name. The prompts above are the merged versions; the originals are in this
file's git history.

## The gap, closed

The older version of this file recorded a known gap: **a fired session's
`NEEDS ANTHONY` report lived in that session's transcript and nothing tracked
it.** Nothing carried an item forward, nothing marked one done, and the only
thing that ever re-raised it was the next run of the same job.

**That gap is closed.** Two things closed it, and both are live:

1. **`/admin/queue`**, migration 23. The sweep calls `admin_stage_pending` for
   every item it is not allowed to decide, one row per kind and message id.
   The row persists until Anthony presses Approve or Dismiss, Approve applies
   it only through an existing `admin_*` RPC, and both write their own audit
   row. A unique index on the open rows means an hourly re-read cannot pile up
   duplicates. The kind string is a closed list as of migration 26, and
   `payment_candidate` is not on it: the row that sat open under that kind
   holding $500 was dismissed on 2026-09-10 and the kind can no longer be
   staged at all. For the live count of open rows read `/admin/queue` - a
   number written into this file goes stale the next time Anthony presses a
   button, which is exactly how this line came to be wrong.
2. **The nightly digest**, section 9 of `docs/SWEEP_PROMPT.md`. At the 10:43 PM
   ET run the sweep drafts one email covering every Reserved block with no
   payment recorded, every open queue row, every thread it could not classify,
   every write it made that day, and the three self-checks below. It is a
   draft, so it waits in Drafts rather than arriving; the routine's own push
   notification is what reaches his phone.

What is still only a transcript: the read-only lines from TNF Game Day and
TNF Draw Window. Those two never write, so they cannot stage. A digits problem
they find is re-found on their next fire, and for the digits window that next
fire is inside the same week, which is why they were left alone. A digits
problem on the morning of a game is also found by TNF Sweep's self-check only
in the sense that it is found again by TNF Game Day the next morning; if that
turns out to be too slow in a live week, the fix is to let TNF Game Day stage
an `unclassified_mail` row, not to add a fourth routine.

## Health checks

`TNF Sweep` section 7 runs these every hour and reports any failure at the top
of its report:

| Check | Passes when | Today |
|-------|-------------|-------|
| Block invariant | `count(*) from blocks` is 100 and available + reserved + assigned is 100 | 42 + 14 + 44 = 100, pass |
| Committed agreement | blocks in `reserved` or `assigned` equals the sum of `blocks_requested` across participants | 58 = 58, pass |
| Quiet routine | a write or a staged row from actor `tnf-sweep` within 48 hours | reported as a line, not a failure |

The quiet check exists because a broken sweep and a quiet pool look identical
from outside. A quiet pool in September is normal. A quiet routine plus unread
mail in Pool-TNF is not.

## Not routines

- Drawing and publishing digits stay two deliberate clicks at `/admin/digits`,
  with the numbers shown for review in between.
- Marking a payout Paid, settling or reopening one, stays a click at
  `/admin/payouts`.
- Releasing a block stays `admin_release_block`, case by case, never triggered
  by a date. Unpaid Reserved blocks are not released at the claim deadline.
- Sending any email, including the digest and the game-day draft, stays
  Anthony pressing send.
