# Routines

The recurring jobs this pool needs beyond the hourly TNF Gmail Sweep. Each
one is a Claude Code Routine: a fresh session per firing, read-only against
the pool, reporting either a NEEDS ANTHONY list or the words NO ACTION.

The hourly sweep (`TNF Gmail Sweep`, stored cron `43 7-23 * * *` UTC) is not
defined here. It was created in the Routines UI and is the only routine that
writes anything.

## Standing rules, every routine

- Step 0 is always `TZ=America/New_York date`. The output is the clock.
- CLAUDE.md outranks the prompt. The prompt restates a rule only so the
  session knows where to look.
- Read-only. Live state comes from the public projections through the anon
  key in `src/lib/env.ts`, which is RLS-bounded by design. No routine
  writes to the database, marks anything Paid, resolves an identity, moves
  or releases a block, draws or publishes digits, sends mail, or moves money.
- Gmail is read-only in every prompt except the Game Day Pack, which
  creates a draft and never sends. Supabase, where a job needs admin-only
  data, is read-only SQL. The Game Day Pack is also the one job that writes
  files: it uploads the grid PNG and PDF to the public storage bucket
  `game-day` signed in as the admin (files, never pool data).
- The Survivor pool is never read, referenced or mentioned.
- The report is a NEEDS ANTHONY section, one line per item with the admin
  route where he acts, or the two words NO ACTION. Nothing else.

## The set

| # | Name | When (America/New_York) | Stored cron (UTC) | Trigger ID | Job |
|---|------|-------------------------|-------------------|------------|-----|
| 1 | TNF Chase List | Daily 9:07 AM EDT, 8:07 AM EST | `7 13 * * *` | `trig_016ZLMsWxbcejrQK2XdJkTza` | Reserved blocks with no payment recorded, plus any dated commitment found in mail |
| 2 | TNF Draw Window | Saturday 9:37 AM EDT, 8:37 AM EST | `37 13 * * 6` | `trig_01TmmBwcxWv5FdJGspjunhn9` | The coming week is inside the 7-day draw window and not drawn, not published, or date-unconfirmed |
| 3 | TNF Game Day Digits | Wed, Thu, Fri 9:20 AM EDT, 8:20 AM EST | `20 13 * * 3-5` | `trig_01EptwvxHH2mdctyMzsaH9XC` | Digits live for today's game after the 8:00 AM reveal, reveal scheduled for tomorrow's |
| 4 | TNF Post-Game Check | Thu, Fri, Sat 11:07 AM EDT, 10:07 AM EST | `7 15 * * 4-6` | `trig_01HJ81a3TUtwMozA32vaqMLN` | Unscored games, winners recomputed, non-assigned winners flagged, payout rows present, Venmo receipt to each winner |
| 5 | TNF Game Day Pack | Wed, Thu, Fri 7:30 AM EDT, 6:30 AM EST | `30 11 * * 3-5` | `trig_01QLquSeCUP8wc3DxPfzzQRY` | Grid PNG and PDF for today's game uploaded to the public bucket `game-day`, Gmail draft with both links to every holder with an address, never sent. Disabled until Gmail, Supabase and ADMIN_PASSWORD are on it |

## Clock change

Stored crons are UTC, so on Sunday November 1, 2026 every routine starts
firing one hour earlier in ET. The times were chosen so both readings work:
every run lands after the 8:00 AM ET reveal, and the post-game run is late
enough that a final entered the night before or first thing is already in.
Do not "fix" the crons in November.

## How they were created, and the one gap

- Created 2026-09-04 from a Claude Code session with `create_trigger`: fresh
  session per firing, push notification on, the calling environment. That
  path cannot attach a repo source or a connector (the org rejects the
  `connectors` parameter), so each prompt clones the public repo itself.
- **Gap: Gmail is not attached.** Routines 2 and 3 do not read mail and are
  complete. Routines 1 and 4 need it for one step each and say so: until it
  is added their first NEEDS ANTHONY line reads "Gmail connector missing on
  this routine". Routine 5 needs Supabase for the recipient list, Gmail for
  the draft and the environment variable ADMIN_PASSWORD for the grid upload
  (see its section), so it was created disabled: add all three, then enable
  it. Add a connector at claude.ai/code > Routines > (name) > Connectors >
  Gmail. If the UI cannot add a connector to an existing routine, create a
  new one from this file (same name, stored cron and prompt, source repo
  anthonydellapia1117/TNF, connector Gmail, tools Bash Read Glob Grep
  WebFetch) and delete the ID above.
- Change a prompt or cron with `update_trigger` on the ID. Never delete and
  recreate for a prompt change, that loses the run history.

## 1. TNF Chase List

- **When:** daily, 9:07 AM EDT, 8:07 AM EST.
- **Stored cron (UTC):** `7 13 * * *`
- **Trigger:** `trig_016ZLMsWxbcejrQK2XdJkTza`
- **Why:** the claim deadline was September 4. Reserved blocks are not
  released at the deadline; they stay Reserved and get chased. This is the
  roll-up. The hourly sweep does the matching, this job never touches a
  payment. Block status is public; the owner code is admin-only since
  migration 18, so lines are by block and name and Anthony maps them to the
  collecting owner at `/admin/list`. Runs daily because the money should be
  in before the Wednesday September 9 kickoff; goes quiet on its own once
  nothing is Reserved.

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. If the repo anthonydellapia1117/TNF is not already checked out in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. Live state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/<view> with headers "apikey: <key>" and "Authorization: Bearer <key>". Views for this job: v_public_blocks, v_public_games. Anon reads only, bounded by RLS. Never write to the database, never look for another key. If the clone or a read fails, the report is a single NEEDS ANTHONY line naming the failed step. Do not guess state.
0b. Hard limits: never mark anything Paid, never record or stage a payment, never resolve an identity conflict, never release, move or assign a block, never send or reply to email, never move money. Gmail is read-only here. The Survivor pool is a separate system: never read its mail or labels, never mention it.

1. GET v_public_blocks?status=eq.reserved&order=block_number. A Reserved block is a hold with no full payment recorded by the pool. Per CLAUDE.md, Reserved blocks stay Reserved after the September 4 deadline and get chased. There is no release by date, and releasing is Anthony's call only.
2. For each Reserved block, search Gmail read-only for threads from the last 7 days that mention the holder's display name or "block <number>". Fetch every match in full with get_thread, never trust a search preview. Note a dated commitment ("will pay Friday"), a statement that another owner is holding the cash, or a request to release. Quote it with the date. Do not act on it. If the display name is an alias with no clear match, write "no mail match" and do not guess who it is. If Gmail tools are not available in this session, skip this step and make the first NEEDS ANTHONY line: "Gmail connector missing on this routine, mail not checked. Add it at claude.ai/code > Routines > TNF Chase List."
3. Money rules per CLAUDE.md: a Reserved block is not evidence the person is unpaid in another owner's book, and no Venmo in Anthony's mail is not evidence either. Say "no payment recorded by the pool", never "unpaid". Payment matching belongs to the hourly TNF Gmail Sweep, not here.
4. GET v_public_games. If any game kicks off today or tomorrow, add one line: "Kickoff <day> <time> ET: a Reserved block that hits pays nothing and raises a review flag."
5. Report. If there is at least one Reserved block, the report is a section titled NEEDS ANTHONY with the heading "Reserved, no payment recorded (<count>)" and one line per block: block number, display name, any quoted commitment with its date or "no mail match", and "chase or confirm with the collecting owner at /admin/list". Then the kickoff line from step 4 if it applies. Nothing else. If there are zero Reserved blocks, the entire report is the words NO ACTION.
```

## 2. TNF Draw Window

- **When:** Saturday, 9:37 AM EDT, 8:37 AM EST.
- **Stored cron (UTC):** `37 13 * * 6`
- **Trigger:** `trig_01TmmBwcxWv5FdJGspjunhn9`
- **Why Saturday:** a Thursday kickoff opens the following week's 7-day
  window on Thursday night. Christmas week is the exception: its furthest
  game is Friday December 25, so that window opens Friday December 18 at
  night, and a Friday-morning run would miss it. Saturday is the first
  morning every week of the season is open, with five days to draw and
  publish. Week 1 (Wednesday September 9) is caught by the September 5 run.
  Draw and publish stay Anthony's two clicks; this only says when.

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. If the repo anthonydellapia1117/TNF is not already checked out in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. Live state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/<view> with headers "apikey: <key>" and "Authorization: Bearer <key>". View for this job: v_public_games?order=game_no. Anon reads only, bounded by RLS. Never write to the database, never look for another key. If the clone or the read fails, the report is a single NEEDS ANTHONY line naming the failed step. Do not guess state.
0b. Hard limits: never draw, publish, schedule or alter digits, never confirm a date, never mark anything Paid, never resolve an identity conflict, never send or reply to email, never move money. The two clicks at /admin/digits (draw, then publish) are Anthony's. Gmail is not needed for this job; do not read mail. The Survivor pool is a separate system: never read its mail or labels, never mention it.

1. Rules from CLAUDE.md and src/lib/week-digits.ts: digits are drawn one week at a time, a game is drawable only when its kickoff is within 7 days (168 hours), a week is drawn as a unit so the furthest game in it sets the gate, a game cannot be drawn while date_confirmed is false or after kickoff, and the reveal is 8:00 AM ET on each game's own date.
2. For every game with status not final and not void, compute hours to kickoff. Group by week.
3. For each week with at least one game inside the 7-day window, one NEEDS ANTHONY line per problem:
   - digits_assigned false: "Week <n>: draw G<xx> <away> at <home>, kicks off <day> <time> ET, at /admin/digits, then publish. Reveal is 8:00 AM ET on <date>."
   - digits_assigned true and digits_reveal_at null: "Week <n>: G<xx> is drawn but not published. Publish at /admin/digits."
   - digits_reveal_at set and later than kickoff_at: "G<xx> reveal is scheduled after kickoff. Fix at /admin/digits."
   - date_confirmed false: "G<xx> date unconfirmed, cannot be drawn. Confirm at /admin/games." (G19 on December 24 and G23 on December 31 shipped unconfirmed.)
4. Look ahead: any game 7 to 14 days out with date_confirmed false gets the same confirm line, so it is confirmed before its window opens.
5. Report. If there is at least one line, the report is a section titled NEEDS ANTHONY with those lines and nothing else. Otherwise the entire report is the words NO ACTION.
```

## 3. TNF Game Day Digits

- **When:** Wednesday, Thursday, Friday, 9:20 AM EDT, 8:20 AM EST.
- **Stored cron (UTC):** `20 13 * * 3-5`
- **Trigger:** `trig_01EptwvxHH2mdctyMzsaH9XC`
- **Why these days:** Wednesday covers G01 on September 9, Thursday covers
  every regular week and Thanksgiving, Friday covers Christmas Day. Every
  other date is NO ACTION. Today's game must have live digits (the public
  projection shows them once the 8:00 AM reveal has passed); tomorrow's must
  have a reveal scheduled before kickoff. This is the same red alert
  `/admin` shows, delivered to a phone.

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. If the repo anthonydellapia1117/TNF is not already checked out in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. Live state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/<view> with headers "apikey: <key>" and "Authorization: Bearer <key>". View for this job: v_public_games?order=game_no. Anon reads only, bounded by RLS. Never write to the database, never look for another key. If the clone or the read fails, the report is a single NEEDS ANTHONY line naming the failed step. Do not guess state.
0b. Hard limits: never draw, publish, schedule or alter digits, never mark anything Paid, never resolve an identity conflict, never send or reply to email, never move money. Publishing is Anthony's click at /admin/digits. Gmail is not needed for this job; do not read mail. The Survivor pool is a separate system: never read its mail or labels, never mention it.

1. Today's games are the ones whose kickoff_at, converted to America/New_York, falls on today's date. Tomorrow's likewise. Ignore void games.
2. For each game today, the reveal at 8:00 AM ET has already passed, so row_digits and col_digits must both be non-null in the projection. One NEEDS ANTHONY line per failure:
   - digits null and digits_assigned false: "G<xx> <away> at <home> kicks off tonight <time> ET and digits are not drawn. Draw and publish now at /admin/digits."
   - digits null and digits_assigned true: "G<xx> kicks off tonight <time> ET and digits are not live. Publish now at /admin/digits, it goes out immediately."
3. For each game tomorrow:
   - digits_reveal_at null: "G<xx> kicks off tomorrow <time> ET and no reveal is scheduled. Draw and publish at /admin/digits today."
   - digits_reveal_at later than kickoff_at: "G<xx> reveal is scheduled after kickoff. Fix at /admin/digits."
4. Report. If there is at least one line, the report is a section titled NEEDS ANTHONY with those lines and nothing else. If there is no game today or tomorrow, or every check passes, the entire report is the words NO ACTION.
```

## 4. TNF Post-Game Check

- **When:** Thursday, Friday, Saturday, 11:07 AM EDT, 10:07 AM EST.
- **Stored cron (UTC):** `7 15 * * 4-6`
- **Trigger:** `trig_01HJ81a3TUtwMozA32vaqMLN`
- **Why these days:** the morning after every game date. G01 on Wednesday
  is checked Thursday, every Thursday game is checked Friday, Christmas Day
  is checked Saturday. Paid versus owed is admin-only and invisible here, so
  the payout line is a reminder that repeats once, not a finding. A winning
  block that is not Assigned produces no payout by rule; the line names it
  so the review flag is not missed.

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. If the repo anthonydellapia1117/TNF is not already checked out in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. Live state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/<view> with headers "apikey: <key>" and "Authorization: Bearer <key>". Views for this job: v_public_games, v_public_blocks, v_public_payouts. Anon reads only, bounded by RLS. Never write to the database, never look for another key. If the clone or a read fails, the report is a single NEEDS ANTHONY line naming the failed step. Do not guess state.
0b. Hard limits: never enter or correct a score, never create, void or mark a payout Paid, never resolve an identity conflict, never release, move or assign a block, never send or reply to email, never move money. Gmail is read-only here. The Survivor pool is a separate system: never read its mail or labels, never mention it.

1. Unscored games. Every game whose kickoff is in the past and whose status is not final and not void gets a line: "G<xx> <away> at <home> kicked off <day> <time> ET and is not final. Enter halftime and final at /admin/score, echo-confirm away at home." Include it whether the game was last night or a week ago.
2. Recent finals. For every game with final_scored_at in the last 26 hours:
   a. Recompute both winners from the projection, per the CLAUDE.md grid orientation: row = position of the AWAY score's last digit in row_digits, col = position of the HOME score's last digit in col_digits, block = row * 10 + col + 1. Do it for the halftime score and the final score. If your result differs from halftime_block or final_block, one line: "G<xx> <halftime or final>: computed block <b>, projection says <b2>. Review at /admin/score." Do not guess which is right.
   b. Look up each winning block in v_public_blocks. If its status is not assigned, one line: "G<xx> <halftime or final> hit block <b> (<display_name>, <status>). No payout by rule, review flag at /admin/payouts." Only an Assigned block receives a payout.
   c. If a winning block is assigned, v_public_payouts must hold a row for that game_id and payout_type. Missing: "G<xx> is final with no <type> payout recorded. Review at /admin/payouts."
   d. For each payout row present, search Gmail read-only for a Venmo receipt from Anthony to that winner, subject or body "You paid", for exactly that amount ($750, $1,000 or $1,500) dated after final_scored_at. Fetch matches in full with get_thread. Found: "G<xx> <type> block <b> <display_name> $<amount>: Venmo receipt <date>. Mark paid at /admin/payouts if not already." Not found: "G<xx> <type> block <b> <display_name> $<amount>: no Venmo receipt in mail. If paid by cash or elsewhere, mark paid at /admin/payouts." Paid versus owed is admin-only and invisible here, so this line is a reminder, not a finding. If Gmail tools are not available in this session, skip the receipt search and make the first NEEDS ANTHONY line: "Gmail connector missing on this routine, receipts not checked. Add it at claude.ai/code > Routines > TNF Post-Game Check."
3. Older finals. For every game final more than 26 hours ago, run only check 2c. Missing payout rows for an assigned winner stay reported until fixed.
4. Report. If there is at least one line, the report is a section titled NEEDS ANTHONY with those lines and nothing else. Otherwise the entire report is the words NO ACTION.
```

## 5. TNF Game Day Pack

- **When:** Wednesday, Thursday, Friday, 7:30 AM EDT, 6:30 AM EST. Non-game days are NO ACTION.
- **Stored cron (UTC):** `30 11 * * 3-5`
- **Trigger:** `trig_01QLquSeCUP8wc3DxPfzzQRY` (created disabled; enable after
  the Gmail and Supabase connectors and the ADMIN_PASSWORD environment
  variable are on the routine)
- **Connectors:** Gmail (draft only) and Supabase (read-only SQL for the
  recipient list). **Environment variables:** `ADMIN_PASSWORD` (the admin's
  Supabase Auth password, for the grid upload), optionally `ADMIN_EMAIL` if
  the admin is not the default in `src/lib/env.ts`.
- **Why:** the game-day email is one grid, two links, one draft. The command
  `npm run game-day -- --game N --participants FILE --upload` renders
  `/grid?g=N` as a PNG and a one-page PDF named `YYYY-MM-DD_TNF_G0N_grid`
  (the game's own ET date), uploads both to the PUBLIC storage bucket
  `game-day` over the Storage REST API, computes the BCC list from an admin
  participant export, and writes a manifest whose body carries the two
  public links (`.../storage/v1/object/public/game-day/<name>`) plus the
  complete message as `.eml`. The draft is then created through the Gmail
  connector from the manifest: subject, body, bcc, no attachments. Nothing
  is ever sent; Anthony sends from Drafts. Logic is in
  `src/lib/game-day-pack.ts`, unit-tested.
- **The template.** Subject and body follow the design-kit email template
  copied to `docs/templates/tnf-game-day-email.html` (fields live_grid_url,
  away_team, home_team, game_date, kickoff_time, network; module order game
  hero, board, game notes, Lock, payouts, footer; no em dashes). Game notes
  and the Lock render only when a person supplies them; the command never
  invents them. Payouts come from public config. Nothing about money owed,
  collection status or anyone's block: names and block numbers are on the
  live grid.
- **Why links and not attachments:** the Gmail connector takes attachments
  only as inline base64 inside a tool call, and a 200 KB file is a 270 KB
  string a session would have to reproduce byte-perfect. A public URL is a
  line of text. The bucket and its policies are migration 22
  (`20260905000022_game_day_bucket.sql`): public read, insert and update
  only when `is_admin()`, no delete. The upload signs in as the admin with
  the anon key plus `ADMIN_EMAIL` and `ADMIN_PASSWORD` through Supabase Auth
  (password grant); there is no service-role key anywhere. The object names
  are stable (the game's date and number) so a link already sent keeps
  working after a re-render; the two files are replaced PDF first, then PNG,
  each with three attempts, and exit 4 names which of the two was replaced
  when the second fails, so the rerun restores the pair. The IMAP `--draft`
  path (Google app password, `GMAIL_APP_PASSWORD`) still exists as an option
  and is not needed here.
- **Timing caveat:** 7:30 AM is before the 8:00 AM ET digit reveal. If the
  digits are scheduled for game morning the command refuses to render a grid
  of question marks (exit 2) and never uploads one; the run reports it.
  Publishing digits on draw day, as week 1 was, avoids the conflict; so does
  moving this cron after the reveal.
- **Recipient SQL** (read-only, admin data, never committed):

```sql
select p.full_name, p.display_alias, p.email, p.cc_email,
       array_agg(b.block_number order by b.block_number) as blocks
from participants p
join blocks b on b.participant_id = p.id and b.status in ('reserved','assigned')
group by p.id, p.full_name, p.display_alias, p.email, p.cc_email
order by p.full_name;
```

Prompt:

```
You are the operations agent for the 1622 TNF Block Pool. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. Compare every kickoff in America/New_York.
0a. If the repo anthonydellapia1117/TNF is not already checked out in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it, then npm ci. Live game state comes only from the public projections: take SUPABASE_URL and SUPABASE_ANON_KEY from src/lib/env.ts and GET SUPABASE_URL/rest/v1/v_public_games?order=game_no with headers "apikey: <key>" and "Authorization: Bearer <key>". If the clone, the install or the read fails, the report is a single NEEDS ANTHONY line naming the failed step. Do not guess state.
0b. Hard limits: never send an email, only create a draft. Never write to the database, never mark anything Paid, never resolve an identity conflict, never move or release a block, never draw or publish digits, never move money. The only upload is the two grid files into the storage bucket game-day, done by the command. Email addresses and ADMIN_PASSWORD are secrets: addresses go into the draft's BCC and nowhere else, not into the report, not into a file in the repo; the password is never printed or copied anywhere. The Survivor pool is a separate system: never read its mail, labels or repo, never mention it.

1. Today's games are the ones whose kickoff_at, converted to America/New_York, falls on today's date, status not void. If there are none, the entire report is the words NO ACTION.
2. Recipients. Through the Supabase connector, run the read-only SQL in docs/ROUTINES.md under TNF Game Day Pack and write the rows as a JSON array to a file outside the repo (for example /tmp/participants.json): full_name, display_alias, email, cc_email, blocks. If the Supabase connector is not available, skip to step 5 with the line: "Supabase connector missing on this routine, no recipient list. Add it at claude.ai/code > Routines > TNF Game Day Pack."
3. For each game today, run: npm run game-day -- --game <N> --participants /tmp/participants.json --upload when ADMIN_PASSWORD is set in the environment, and with --link-only instead of --upload when it is not. Exit 0 prints the subject, the counts, the holders with no email, the file paths and, with --upload, the two public links. Exit 2 means the digits are not live in the public projection; do not pass --allow-undrawn, add the line "G<xx> digits are not live, grid not rendered. Publish at /admin/digits, then rerun npm run game-day -- --game <N> --upload." and continue with the next game. Exit 4 means the admin sign-in or an upload failed after retries; the message says whether nothing was replaced or the PDF was replaced and the PNG was not. Rerun once with --upload; if it fails again, rerun with --link-only and add the line "Grid upload failed (exit 4): <the command's message>. Check ADMIN_PASSWORD in this routine's environment variables and that migration 22 (bucket game-day) is applied."
4. Create one Gmail draft per game through the Gmail connector, never a send: subject and body verbatim from the manifest, bcc as the manifest's bcc list (no To, no Cc), no attachments. If a draft with that subject already exists in Drafts, update it in place instead of creating a second one. If the run used --link-only, add the line "Grid links are not in the draft: set ADMIN_PASSWORD in this routine's environment variables so the command uploads both files to the game-day bucket." If the Gmail connector is not available, add the line "Gmail connector missing on this routine, draft not created. Add it at claude.ai/code > Routines > TNF Game Day Pack." and report the manifest path instead.
5. Report. The report is a section titled NEEDS ANTHONY with, per game: "G<xx> draft is in Gmail Drafts: <distinct> recipients (<withEmail> holders with an address, <cc> cc addresses, <shared> shared), <withoutEmail> holders with no email: <names with block numbers>. Links: <png url>, <pdf url>. Review and send." Then any line from steps 2 to 4. Nothing else. Never print an email address or a password in the report.
```

## Not routines

- **season_mode.** One admin toggle before the September 9 kickoff. A click,
  not a job.
- **NEEDS ANTHONY has no tracker.** A fired session's report lives in that
  session and its push. If an item goes unanswered, nothing re-raises it
  except the next run of the same job. Known gap, left open on purpose
  until it costs something.
