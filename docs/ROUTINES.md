# Routines

Four routines are defined for this pool. Two are on: TNF Sweep, and TNF Game Day, which since Part O (2026-11-23) runs both the morning run and the results run through `docs/DISPATCH_PROMPT.md`. Two are paused: TNF Results, which has no connectors and is unused (Part O, below), and TNF Draw Window (Part N). Rewritten 2026-09-10
from a set of six, of which all six were disabled and three had a stored cron
that did not match what this file claimed.

| # | Name | Trigger | Stored cron (UTC) | Writes | Connectors on it |
|---|------|---------|-------------------|--------|------------------|
| 1 | TNF Sweep | `trig_017vcw3ADZHPVpKVXS1s1B7X` | `CRON_TZ=America/New_York 43 0,7-23 * * *`, enabled, read back 2026-11-23 (Anthony changed it in the UI on 2026-11-17; it was `43 11-23,0-4 * * *`) | yes, within `docs/SWEEP_PROMPT.md` | Gmail, Supabase |
| 2 | TNF Game Day | `trig_01QLquSeCUP8wc3DxPfzzQRY` | `10 14,15,21-23,0-7 1,24-28,31 1,11,12 *` (Part O: 9:10 and 10:10 AM ET the morning run, 4:10 PM to 2:10 AM ET the results run) | the morning run: `admin_draw_day` for today's games, the kickoff and game-day emails, claimed and recorded, and one NEEDS ANTHONY queue row per date (`gameday:<date>`) on a game date or the claim deadline, a failed clone or install included. The results run: scores through `admin_score_game` from ESPN, the winners email, and one NEEDS ANTHONY queue row per problem class and game date (`scores:<date>`, `winners:<date>`) when a check fails, a failed clone or install included | Gmail, Supabase |
| 3 | TNF Draw Window | `trig_01TmmBwcxWv5FdJGspjunhn9` | `37 14 22,24,29 11,12 *` | no | none needed; **paused 2026-11-23 (Part N)**, its checks fold into TNF Game Day steps 2, 4a and 6 |
| 4 | TNF Results | `trig_01CJpJ6NAj9o9TEN1oRSUtwY`, named `TNF Results (unused, no connectors)` since Part O; **paused, never fired**, kept and not deleted | `25 0-7,21-23 1,24-28,31 1,11,12 *` | nothing: TNF Game Day runs the results run (Part O) | **none, and none can be added** (`docs/INCIDENTS.md`) |

**Part N (Anthony, 2026-11-23, approved in the TNF PM chat at 2:53 PM ET).**
Digits are drawn per day, not per week: the morning run calls `admin_draw_day`
(migration 43), which draws and publishes only that ET date's games, each its
own draw with fresh randomness, and never redraws. The morning run sends the
kickoff email (the claim deadline) and the game-day email; the results run
sends the winners email. All three are templates in
`src/lib/email/events/day.ts`, To Anthony, Cc RM and MAP, Bcc holders, one
send per event key. The prompts are `docs/GAME_DAY_PROMPT.md` and
`docs/RESULTS_PROMPT.md`.

**Part O (Anthony, 2026-11-23, approved in the TNF PM chat at 9:59 PM ET).**
TNF Game Day runs both jobs. TNF Results was created that evening from a
session with `create_trigger`, and it came out with no connectors: the call
refused the connectors list, `update_trigger` cannot attach one, and Anthony
could not find the routine in the UI to add them by hand
(`docs/INCIDENTS.md`). Without
Supabase it can do nothing, so it stays paused, renamed `TNF Results (unused,
no connectors)`, and is not deleted. TNF Game Day already holds Gmail and
Supabase, runs in the environment with the three `GMAIL_OAUTH_*` variables,
and was made by a session, so `update_trigger` works on it: its cron now also
fires hourly from 4:10 PM to 2:10 AM ET, and its stored prompt points at
`docs/DISPATCH_PROMPT.md`, which sends each fire to the morning run
(`docs/GAME_DAY_PROMPT.md`, ET hour 9 or 10), to the results run
(`docs/RESULTS_PROMPT.md`, ET hour 16 to 23 or 0 to 2) or to nothing (any
other hour). After the morning run, the 9:10 and 10:10 fires also follow the
results run when yesterday had a game and its winners email has not gone. In
this file "the morning run" and "the results run" are those two paths of the
one routine.

**The sweep has been live on `docs/SWEEP_PROMPT.md` since 2026-10-09.** It is
still named `TNF Gmail Sweep`, enabled, on the cron above, with Gmail and
Supabase its only connectors. Its stored prompt is the pointer under **The
sweep's hand edits** below. It was created through the HTTP API rather than by
an agent, and the platform refuses an agent update on such a routine:
`update_trigger: this routine was created via "http_api", not by an agent`. So
a change to the trigger is Anthony's, by hand, and a change to what the sweep
does is a merge to main.

Retired the same day, disabled and kept for their run history:

| Name | Trigger | Retired | Absorbed by |
|------|---------|---------|-------------|
| TNF Chase List | `trig_016ZLMsWxbcejrQK2XdJkTza` | 2026-09-10 | TNF Sweep, the 10:43 PM digest |
| TNF Game Day Digits | `trig_01EptwvxHH2mdctyMzsaH9XC` | 2026-09-10 | TNF Game Day, phase A step 1 |
| TNF Post-Game Check | `trig_01HJ81a3TUtwMozA32vaqMLN` | 2026-09-10 | TNF Game Day, phase B |

The phase names are the 2026-09-10 prompt's, kept as history. Since Part N
the digits check is the morning run's step 1 (the lock) and the post-game
scoring is the results run.

Never delete one of these. A delete loses the run history and, for the three
live ones, the repo source and the connectors, which `update_trigger` cannot
put back.

## The sweep's hand edits

Made by Anthony in the UI (claude.ai > Code > Routines > TNF Gmail Sweep) and
read back off the trigger on 2026-10-09. Nothing in this file is waiting on
anything.

| Field | Stored |
|-------|--------|
| Name | `TNF Gmail Sweep`; the rename to `TNF Sweep` was never made and is not needed |
| Schedule / cron | `43 11-23,0-4 * * *` |
| Prompt | the pointer below, since 10:47 AM ET 2026-10-09 |
| Connectors | Gmail, Supabase; Vercel removed 2026-10-09 |
| Enabled | on |

The pointer, verbatim. If the routine's prompt is ever lost, this is what goes
back:

```
Your prompt is in this repo, anthonydellapia1117/TNF, at docs/SWEEP_PROMPT.md. Open that file and follow everything between its two code fences, word for word, as this run's instructions. CLAUDE.md in the same repo outranks it. If the repo is not checked out, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. If you cannot read the file, do nothing else and report one line: NEEDS ANTHONY: could not read docs/SWEEP_PROMPT.md. Hyphens only.
```

**Do not delete and recreate it**: a delete loses the run history, the repo
source and both connectors, and `update_trigger` cannot put any of those back.

## How this file was verified

Every line about a routine's live state was read back off the trigger record
after the change, not assumed from the call that made it. The two prompts that
a session could write are byte-identical to their source in this repo:

| Routine | Stored prompt vs repo | Checked |
|---------|----------------------|---------|
| TNF Game Day | the pointer in section 2 (to `docs/DISPATCH_PROMPT.md`), verbatim, read back after `update_trigger` | 2026-11-23, Part O |
| TNF Draw Window | identical, 3,100 chars, against the fenced block below | 2026-09-10 |
| TNF Sweep | the pointer under "The sweep's hand edits", verbatim; set by Anthony in the UI | 2026-10-09 |

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
- Two routines write to the database, each only within its own prompts:
  TNF Sweep (`docs/SWEEP_PROMPT.md`) and TNF Game Day, on two paths: the
  morning run (`admin_draw_day`, the claim and record of its two emails and
  one queue row per date, `docs/GAME_DAY_PROMPT.md`) and the results run
  (`admin_score_game` as `npm run scores` prints it, one queue row per problem
  class and date, and the claim and record of the winners email,
  `docs/RESULTS_PROMPT.md`). Parts N and O, 2026-11-23. TNF Results, unused,
  and TNF Draw Window, paused, write nothing.
- **Email is a closed list, and each routine holds only its own part of it**
  (Part N, 2026-11-23). TNF Sweep sends its replies, each to its sender only
  (T1-T6, and the `answer_` and `game_list_` replies in Anthony's voice,
  `docs/SWEEP_PROMPT.md` 1d), and the nightly digest to Anthony's own address
  alone (he authorised that one send on 2026-09-10, because it goes to him and
  he is not watching a screen). TNF Game Day sends `kickoff_<date>` on the
  claim deadline and `gameday_<date>` on each game date
  (`docs/GAME_DAY_PROMPT.md`), and on its results run `winners_<date>` once a
  game date is scored (`docs/RESULTS_PROMPT.md`). Each sends only within its own
  prompt, and each email is claimed in `email_sends` before it goes and
  recorded after. Nothing else: no free-form mail, no reply outside the
  sweep's list, no recipient the envelope does not derive.
- **Every TNF email renders through `src/lib/email` and goes out through
  `npm run email`** (`scripts/email.mts`), since 2026-10-07. No routine prompt
  carries a subject, a body or a Gmail send or draft call;
  `tests/unit/email/bypass.test.ts` fails if one does. The command sends as
  Anthony's mailbox through the Gmail API, so a routine that sends needs
  `GMAIL_OAUTH_TOKEN_JSON`, `GMAIL_OAUTH_CLIENT_ID` and
  `GMAIL_OAUTH_CLIENT_SECRET` in its environment; without them the command
  refuses and says so.
  No routine drafts. The game-day pack (`npm run game-day`) is a manual
  command since Part N, a draft Anthony makes and sends himself; no routine
  runs it. History: until Part N this line said TNF Game Day sent nothing and
  its pack was a draft Anthony pressed send on; until 2026-09-10 it read "no
  routine ever sends an email", which contradicted the two sends the sweep
  prompt already authorised. `docs/SWEEP_PROMPT.md` 1d and the other two
  prompts' 0c (the morning run's and the results run's) are the same list and are meant to be read together.
- No routine marks a payout Paid, moves money, confirms a date or resolves an
  identity. TNF Game Day draws and publishes digits only through `admin_draw_day`,
  for that ET date's games only: the 9:10 run calls it once per game date, and
  the 10:10 re-fire calls it again, a call that changes nothing when the 9:10
  run did its work. The results run scores a game only through the
  `admin_score_game` lines `npm run scores` prints, never a typed score and
  never a re-score. Drawing at `/admin/digits` and entering or
  correcting a score at `/admin/score` stay Anthony's.
- The Survivor pool is never read, referenced or mentioned.
- A report is a `NEEDS ANTHONY` section, one line per item with the admin
  route where he acts, or the two words `NO ACTION`.

## The cron lines, and the arithmetic

Stored crons are UTC. The season is entirely after the November 1 clock
change, so every game date reads as EST, UTC-5. Today is EDT, UTC-4.

### TNF Sweep: `43 11-23,0-4 * * *` until 2026-11-17

The stored cron read back on 2026-11-23 is `CRON_TZ=America/New_York 43 0,7-23
* * *`: hourly on the :43 from 7:43 AM to 12:43 AM ET, in ET by name, so it no
longer needs the union below. What follows is the UTC line it replaced and
why that line was shaped as it was, kept as history.

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

### TNF Game Day: `10 14,15,21-23,0-7 1,24-28,31 1,11,12 *`

One routine, two paths, routed by the ET hour in `docs/DISPATCH_PROMPT.md`
(Part O). A 5-field cron holds one minute and a list of hours, so every fire
is on the :10. The season is all EST, so no hour moves.

| UTC hours | EST | Path |
|-----------|-----|------|
| 14, 15 | 9:10 and 10:10 AM | the morning run |
| 21, 22, 23 | 4:10, 5:10, 6:10 PM | the results run |
| 0 to 7 | 7:10 PM to 2:10 AM, the evening of the UTC date before | the results run |

**The morning run** is the 9:10 fire, and the 10:10 one is a re-fire that
changes nothing when the 9:10 run did its work (Part N): `admin_draw_day`
changes nothing on a repeat call, an email whose key is already in
`email_sends` is never claimed or sent again, and the `gameday:<date>` queue
row is refused while it is open. If the 9:10 run did not fire or stopped
partway, the 10:10 one finishes the day. Nov 24 is the kickoff email (the
claim deadline). The game dates draw, publish and send the game-day email.
Scoring is the results run's; the morning run only names a game that kicked
off before today and is not final, and then, when yesterday had a game and its
winners email has not gone, follows the results run once more.

| Date | Drawn, published, game-day email | Named if not final |
|------|----------------------------------|--------------------|
| Tue Nov 24 | - (the kickoff email) | - |
| Wed Nov 25 | G01 | - |
| Thu Nov 26 | G02, G03, G04 | G01 |
| Fri Nov 27 | G05 | G02, G03, G04 |
| Sat Nov 28 | - | G05 |
| Thu Dec 24 | G06 | - |
| Fri Dec 25 | G07, G08, G09 | G06 |
| Sat Dec 26 | - | G07, G08, G09 |
| Thu Dec 31 | G10 | - |
| Fri Jan 1 | - | G10 |

**The results run** settles one game date per fire: today's from 4:10 PM, and
yesterday's from 12:10 AM, so a game that ends after midnight is covered. A
night's fires after 7 PM EST fall on the next UTC date, which is why the days
list runs one past each game date (28 after Nov 27, 1 after Dec 31).

| Game night | Last kickoff (ET) | Results fires, ET | UTC dates the cron needs |
|------------|-------------------|-------------------|--------------------------|
| Wed Nov 25, G01 | 8:00 PM | 4:10 PM Wed to 2:10 AM Thu | Nov 25, Nov 26 |
| Thu Nov 26, G02-G04 | 8:20 PM | 4:10 PM Thu to 2:10 AM Fri | Nov 26, Nov 27 |
| Fri Nov 27, G05 | 3:00 PM | 4:10 PM Fri to 2:10 AM Sat | Nov 27, Nov 28 |
| Thu Dec 24, G06 | 8:15 PM | 4:10 PM Thu to 2:10 AM Fri | Dec 24, Dec 25 |
| Fri Dec 25, G07-G09 | 8:15 PM | 4:10 PM Fri to 2:10 AM Sat | Dec 25, Dec 26 |
| Thu Dec 31, G10 | 8:15 PM | 4:10 PM Thu to 2:10 AM Fri | Dec 31, Jan 1 |

Until 4 hours 30 minutes after the night's last kickoff a game not final only
waits; the first fire after that stages it. A winners email still held at
2:10 AM gets the two morning fires, and after 10:10 AM it is by hand.

Days `1,24-28,31` across months `1,11,12` is 20 dates a year: 7 in January,
6 in November (it has no 31st) and 7 in December. Thirteen fires on each date
make 260 fires a year. Most find nothing: a results fire on a date with no
game reads one count and reports `NO ACTION`, and so does a morning fire with
nothing due.

### TNF Draw Window: `37 14 22,24,29 11,12 *`

Paused 2026-11-23 (Part N). What follows is the week-draw schedule it was
built for, kept as history: the per-day rule retired week draws.

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

The routines below have MIXED origins, and that is the whole reason one of
them is stuck. TNF Game Day and TNF Draw Window were created from a Claude
Code session and a session can update them. TNF Sweep was created through
the HTTP API, so `update_trigger` refuses it with `this routine was created
via "http_api", not by an agent` and its three edits have to be made by hand.
An earlier version of this line said every routine came from a session, which
hid exactly the fact an operator needs. Two things about the session path
that path matter and the older version of this file had both wrong.

- **`create_trigger` from a session did not attach connectors.** On
  2026-11-23 it refused the list outright (`the connectors parameter is not
  available for this organization`) and, called without it, made TNF Results
  with `mcp_connections` empty and a warning that its sessions run with no
  connector tools. The warning says a routine gets only the connectors its
  creating session can pass on, and names the claude.ai Routines UI as the
  other way; neither was tried. An earlier version of this line said
  `create_trigger` simply takes the list, and was trusted. Read `mcp_connections` back off a
  trigger before relying on it. The incident is in `docs/INCIDENTS.md`.
- **`update_trigger` cannot change a connector, a repo source, an allowed
  tool or an environment variable.** It takes `name`, `cron_expression`,
  `enabled`, `model` and `prompt`, and nothing else. So a connector change on
  an existing routine is a UI job: claude.ai > Code > Routines > (name) >
  Connectors. If the UI cannot do it either, **say so and stop.** Do not
  delete and recreate to work around it: that loses the run history, the repo
  source and the environment.

| Routine | Gmail | Supabase | Repo source | Environment |
|---------|-------|----------|-------------|-------------|
| TNF Sweep | yes | yes | `anthonydellapia1117/TNF` | the three `GMAIL_OAUTH_*` variables are needed for it to send through `npm run email` (2026-10-07) |
| TNF Game Day | yes | yes | `anthonydellapia1117/TNF` | The three `GMAIL_OAUTH_*` variables send its three emails through `npm run email` (set, verified 2026-10-13), and open network reaches ESPN's public scoreboard for the results run (HTTP 200 on 2026-11-23). No owner addresses: the envelope comes from the `owners` table |
| TNF Results (unused) | no | no | not on the trigger record | The same environment as TNF Game Day, which does not help it: with no connectors it cannot read or write the database |
| TNF Draw Window | - | - | none, the prompt clones | - |

The day emails carry each grid as its bare link (`/grid?g=<n>`), nothing is
uploaded, and no admin password is needed (Part N; the pack's `--link-only`
of 2026-10-13 is the same idea). Every routine that calls an admin_* function
through the Supabase connector sets the admin claim first, in the same call;
without it the call is refused "not authorized" (CLAUDE.md, Code
conventions).

**The To line of every broadcast comes from the `owners` table, at send
time.** Anthony's rule of 2026-10-07: every broadcast email (one body, many
recipients in Bcc) carries every owner on To. The exceptions are in CLAUDE.md:
the format email (Part L, To Anthony with every other owner on Cc) and the
three day emails (Part N, To Anthony, Cc RM and MAP, Bcc every holder's own
address, no owner left off). For the rest, `src/lib/email/envelope.ts`
builds it: Anthony's address first, then each other owner's primary address
(RM, MAP, JPOD, GD, EJD, NL, BG, TJA, DN), ten in all. An owner's
`alt_email` is never addressed, on To or in Bcc, so an owner whose second
address is a prospect or a holder's still gets one copy (Anthony,
2026-10-14). Anthony has one address on this pool. The routine exports the
table through the Supabase connector with "The owners query" below and hands
the file to the command; no environment variable and no repo file carries an
owner address, and the routine variable that used to was retired the same
day. The command refuses to build a broadcast if an owner has no address
(naming every such owner; DN has none on 2026-10-08, so every broadcast
refuses until it is set, and the nightly digest says so), if Anthony's row
does not carry `ADMIN_EMAIL`, or if two owners share one. One exception, for
one send at a time: `npm run email -- --omit-owner <CODE>` names an owner with
no address to leave off, and the claim before the send
(`admin_email_claim_broadcast`) refuses unless the codes named are exactly the
owners with no address, then writes one `broadcast_owner_omitted` audit row
per code. The recruit broadcast of 2026-10-13 left DN off that way. The
game-day pack, a manual command since Part N, is a draft with no claim, so its
override is recorded on its own (Anthony, 2026-11-20, Part M): when Anthony
runs it while DN is the one owner with no address,
`admin_email_omit_owners('game_day_g<NN>', array['DN'], ...)` (migration 42)
makes the same check and writes the same audit row, once per game, then
`npm run game-day -- --omit-owner DN`. Any other blank owner still stops the
draft. No routine runs it.

The Bcc is the participant query minus every address already on To, so an
owner who also holds a block is listed once, on To. Per-recipient email (a
holder check-in, the recruit send, a sweep reply, the digest, a status report)
never carries an owner on To or Cc.

The addresses never live in this repo. That is not because the repo is
public, and it will not change when it stops being: git history is permanent
and a delete does not reach it, visibility is a setting that can be changed
back, and a repo has no row-level access control while the `owners` table has
exactly that.

## 1. TNF Sweep

- **When:** hourly on the :43. See the cron table above.
- **Trigger:** `trig_017vcw3ADZHPVpKVXS1s1B7X`
- **Prompt:** `docs/SWEEP_PROMPT.md`. The routine stores only the pointer
  above and reads the file from main at every run (since 2026-10-09), so a
  merge to main is a deploy.
- **Write authority:** level B. Roster always. Money, identity, release and
  refund only on mail from `anthonydellapia@gmail.com` to
  `anthonydellapia@gmail.com` with a subject beginning `DECISION TNF:`.
  Everything else stages at `/admin/queue`.
- **Intake grammar:** `docs/INTAKE_GRAMMAR.md`. The grammar arrives by mail;
  there is no relay.

This routine absorbed TNF Chase List. The chase list was a daily roll-up of
Reserved blocks with no payment recorded; it is now the first section of the
10:43 PM digest, on the routine that already reads the same mail.

## 2. TNF Game Day

- **When:** 9:10 and 10:10 AM EST (the morning run), then hourly from 4:10 PM
  to 2:10 AM EST (the results run), on the 20 dates the cron names; the ones
  with work are in the tables above.
- **Stored cron (UTC):** `10 14,15,21-23,0-7 1,24-28,31 1,11,12 *`
- **Trigger:** `trig_01QLquSeCUP8wc3DxPfzzQRY`
- **Absorbed, 2026-09-10:** TNF Game Day Digits and TNF Post-Game Check. It
  was TNF Game Day Pack. Since Part N it draws and publishes through
  `admin_draw_day` and sends the kickoff and game-day emails; it drafts
  nothing. Since Part O it also runs the post-game scoring and the winners
  email, at the results hours.

- **Prompt:** `docs/DISPATCH_PROMPT.md` since Part O (2026-11-23), which
  routes each fire by the ET hour to `docs/GAME_DAY_PROMPT.md` or
  `docs/RESULTS_PROMPT.md`. Since 2026-10-13 the routine stores only the
  pointer below and reads the files from main at every fire, the same shape
  as the sweep, so a merge to main is a deploy. Until Part O the pointer
  named `docs/GAME_DAY_PROMPT.md` itself. Grids go out as links,
  never uploads, so the routine needs no admin password (Anthony, 2026-10-13).
- **State:** enabled (Part N, 2026-11-23). It was paused from 2026-10-13
  until a dry fire on a non-game day came back clean (Anthony).

The pointer, verbatim. If the routine's prompt is ever lost, this is what goes
back:

```
Your prompt is in this repo, anthonydellapia1117/TNF, at docs/DISPATCH_PROMPT.md. Open that file and follow everything between its two code fences, word for word, as this run's instructions. CLAUDE.md in the same repo outranks it. Every execute_sql call that runs an admin_* function begins with select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true); in the same call. If the repo is not checked out, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. If you cannot read the file, do nothing else and report one line: NEEDS ANTHONY: could not read docs/DISPATCH_PROMPT.md. Hyphens only.
```

### The owners query

Read-only, run through the Supabase connector as the admin. The single value
goes to `/tmp/owners.json` exactly as returned and into the envelope the
command builds, never into the report and never into the repo.

```sql
select coalesce(jsonb_agg(jsonb_build_object('code', code, 'email', email, 'alt_email', alt_email)
                          order by code), '[]'::jsonb)::text
from owners;
```

### The recipient query

Read-only, run through the Supabase connector as the admin, for the manual
game-day pack (`npm run game-day --participants`); no routine runs it since
Part N, and the day emails take their Bcc from `admin_email_broadcast_plan`.
Email is a secret: it goes to `/tmp/participants.json` and into the draft's
Bcc, never into the report and never into the repo.

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
- **State:** PAUSED 2026-11-23 (Part N). Its prompt names week-unit draws as
  Anthony's clicks, which the per-day rule retired; its checks are TNF Game
  Day's: an unconfirmed date is step 2, and a game past kickoff with no digits
  is step 4a, staged as Anthony's call in step 6. It was on from 2026-10-13
  (Anthony).

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

## 4. TNF Results (unused, no connectors)

- **State:** PAUSED, never fired, unused. Kept, not deleted. Renamed
  `TNF Results (unused, no connectors)` on 2026-11-23 (Part O).
- **Why:** it was created on 2026-11-24 02:46 UTC (Mon Nov 23, 9:46 PM ET)
  from a session with `create_trigger`, which attached no connectors.
  `update_trigger` cannot add one, and Anthony could not find the routine in
  the UI to add them by hand. With no Supabase it cannot read a game or write
  a score (`docs/INCIDENTS.md`).
- **What does its job:** TNF Game Day, through `docs/DISPATCH_PROMPT.md`
  (section 2). `docs/RESULTS_PROMPT.md` is unchanged in what it does.
- **Stored cron (UTC):** `25 0-7,21-23 1,24-28,31 1,11,12 *`. It does not
  fire while the routine is paused.
- **Trigger:** `trig_01CJpJ6NAj9o9TEN1oRSUtwY`, a fresh session per fire, in
  the DELLA environment.
- **Connectors:** none.
- **If it is ever given Supabase and Gmail in the UI:** leave it paused all
  the same. Two routines running the results run would race each other for
  the same scores and the same claim; the ledger would hold the email to one
  send, but nothing is gained. Turning it on means taking the results hours
  back out of TNF Game Day's cron first.

Its stored pointer, verbatim:

```
Your prompt is in this repo, anthonydellapia1117/TNF, at docs/RESULTS_PROMPT.md. Open that file and follow everything between its two code fences, word for word, as this run's instructions. CLAUDE.md in the same repo outranks it. Every execute_sql call that runs an admin_* function begins with select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true); in the same call. If the repo is not checked out, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. If you cannot read the file, do nothing else and report one line: NEEDS ANTHONY: could not read docs/RESULTS_PROMPT.md. Hyphens only.
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
  which checked the same three conditions on the same morning, before rendering
  the grid that depended on them. Never fired. Since Part N there is no reveal
  slot: `admin_draw_day` publishes at once and step 1 is the lock.
- **TNF Post-Game Check**, `trig_01HJ81a3TUtwMozA32vaqMLN`. Recomputed
  winners, flagged a winner on a non-assigned block, confirmed payout rows.
  Absorbed verbatim as TNF Game Day phase B. Its last run was 2026-09-05.
  Since Part N the scoring and the winners are the results run's.

Reversing a retirement is `enabled = true` plus dropping the suffix from the
name. The prompts above are the merged versions; the originals are in this
file's git history.

## The gap, closed

The older version of this file recorded a known gap: **a fired session's
`NEEDS ANTHONY` report lived in that session's transcript and nothing tracked
it.** Nothing carried an item forward, nothing marked one done, and the only
thing that ever re-raised it was the next run of the same job.

**That gap is designed closed, and HALF of it is actually running.** Both
pieces are built and both are in this repo; the second one cannot fire until
the sweep is enabled, which needs the three by-hand edits above. Do not read
this section as "handled" until that is done:

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
   ET run the sweep sends Anthony one email, rendered by `npm run email` from
   `email_digest_facts()` (migration 33): every AVD Reserved block with no
   payment recorded, every open queue row, every write it made that day, and
   the three self-checks below. It has been a send to him alone since
   2026-09-10; before that it was a draft.

Both runs stage now. TNF Game Day stages its NEEDS ANTHONY lines as
one `unclassified_mail` row per date (source `gameday:<date>`) on a game date
or the claim deadline, a failed clone or install included (the lock, the slate
and the draw still run through the Supabase connector, and no email goes): a
failed draw or a lock mismatch on a game morning cannot wait for the next
morning, because a game past kickoff can never be drawn. The results run stages one
row per problem class and game date (sources `scores:<date>` and
`winners:<date>`, a failed clone or install under `scores:<date>`), so a
problem of the other class gets its own row; a second problem of the same
class goes in the run report. What is still only a transcript: TNF Game Day's
lines on a date with no game and no kickoff email (the morning after a game
date, which names a game not final; the results run stages that one under
`scores:<date>`), and anything a stage refused because its row was already
open. Draw Window is paused.

## Health checks

`TNF Sweep` section 7 runs these every hour and reports any failure at the top
of its report:

| Check | Passes when | Today |
|-------|-------------|-------|
| Block invariant | `count(*) from blocks` is 100 and available + reserved + assigned + held is 100 | read it live, do not trust a number written here |
| Committed agreement | blocks in `reserved` or `assigned` equals the sum of `blocks_requested` across participants | read it live, do not trust a number written here |
| Quiet routine | a write or a staged row from actor `tnf-sweep` within 48 hours | reported as a line, not a failure |

The quiet check exists because a broken sweep and a quiet pool look identical
from outside. A quiet pool in September is normal. A quiet routine plus unread
mail in Pool-TNF is not.

## Not routines

- Drawing and publishing digits by hand, one day at a time at `/admin/digits`
  (the manual fallback), and entering or correcting a score at `/admin/score`
  are Anthony's. The routine path is `admin_draw_day` in TNF Game Day and the
  printed `admin_score_game` lines in its results run, and nothing else. Until Part
  N (2026-11-23) drawing and publishing were two deliberate clicks with the
  numbers shown for review in between.
- Marking a payout Paid, settling or reopening one, stays a click at
  `/admin/payouts`.
- Releasing a block stays `admin_release_block`, case by case, never triggered
  by a date. Unpaid Reserved blocks are not released at the claim deadline.
- The routines' sends are the closed list in the standing rules above: TNF
  Sweep's replies and digest, TNF Game Day's `kickoff_` and `gameday_` and, on
  its results run, `winners_`, each only within its own prompt, each claimed in
  `email_sends` first and rendered and sent by `npm run email`. Everything
  else, the game-day pack included, stays Anthony pressing send. History: this
  line said the digest was his to send until 2026-09-10, and that only TNF
  Sweep sent email until Part N.
