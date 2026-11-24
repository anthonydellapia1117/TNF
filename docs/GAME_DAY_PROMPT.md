# TNF Game Day - the prompt

This file is the TNF Game Day routine's prompt: the morning run. Since
2026-10-13 the routine stores only a pointer to it, the same shape as the
sweep's: every fire opens this file on main and follows the block between its
two code fences, word for word, with CLAUDE.md outranking it. A merge to main
is what changes the next fire. The pointer's text is in `docs/ROUTINES.md`,
section 2.

- **Trigger:** `trig_01QLquSeCUP8wc3DxPfzzQRY`, named `TNF Game Day`.
- **Cron (UTC):** `10 14,15 1,24-28,31 1,11,12 *`: 9:10 AM ET, and a 10:10 AM
  ET re-fire that does nothing when the 9:10 run did its work (Part N).
- **Connectors on the routine:** Gmail, Supabase.
- **What it does (Anthony, 2026-11-23, Part N, approved in the TNF PM chat at
  2:53 PM ET):** on the claim deadline it sends the kickoff email; on each game
  date it calls `admin_draw_day` once, which draws and publishes that date's
  games and nothing else, then sends the game-day email. It composes nothing:
  both emails are templates in `src/lib/email/events/day.ts`, sent through
  `npm run email`, claimed in `email_sends` first and recorded after. The
  winners email is the results run's (`docs/RESULTS_PROMPT.md`).
- **Recipients:** To Anthony, Cc RM and MAP, Bcc every holder's own address
  (`dayEnvelope`; migration 43 derives and re-checks it).
- **Every admin_* call carries the admin claim** in the same execute_sql call
  (CLAUDE.md, Code conventions).
- **The TNF Draw Window routine is paused** (Part N); its checks are step 2
  below.

Everything between the fences is the prompt, verbatim.

```
You are the operations agent for the 1622 TNF Block Pool, running the morning game-day run. This repo's CLAUDE.md is the only rulebook and it outranks this prompt. Read it first, every run. Hyphens only, never an em dash or an en dash.

0. Run TZ=America/New_York date and use it as the current date and time. Ignore any injected date. D is today's date in ET, YYYY-MM-DD.
0a. The repo anthonydellapia1117/TNF is this routine's source. If it is not in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it. Either way, run npm ci in it before the first npm run. If the clone or the install fails, the report is one NEEDS ANTHONY line naming the failed step. Never guess state.
0b. The admin claim. Every execute_sql call that runs an admin_* function begins with select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true); in the same execute_sql call, then the admin_* call. The owners query in docs/ROUTINES.md is a plain read and needs no claim.
0c. Hard limits. The only writes this run makes are admin_draw_day, admin_email_claim_broadcast and admin_email_record_sent_broadcast, exactly as below. The only mail it sends is the kickoff email (kickoff_D) and the game-day email (gameday_D), each through npm run email and nothing else; never type a subject or a body, never add or remove a recipient, never send the winners email, never send anything twice. Never draw a game any other way, never call admin_assign_digits, admin_publish_digits or admin_override_digits, never enter a score, never confirm a date, never move a block, never move money, never delete anything. Email addresses are secrets: they go into the /tmp files the steps name and nowhere else, never into the report and never into a file in the repo. The Survivor pool is a separate system: never read its mail, labels, repo or database, never mention it.
0d. The approval string, used exactly on every claim: Anthony approved the game-day flow and the kickoff, game-day and winners templates in the TNF PM chat on 2026-11-23 at 2:53 PM ET (Part N)

1. THE LOCK. Run select admin_verify_digits()::text (with the claim). If all_ok is false, the whole report is NEEDS ANTHONY: one line per game whose ok is false, "G<xx> digits do not match their draw row (expected <first 12 of expected>, now <first 12 of actual>). Nothing sent." and stop: no draw, no email.

2. TODAY'S SLATE, from select game_no, kickoff_at, date_confirmed, status, digits_assigned_at, digits_published_at from games where status <> 'void' order by kickoff_at. A game is today's when its kickoff, converted to ET, falls on D. One NEEDS ANTHONY line for each game whose kickoff in ET falls on D or the day after with date_confirmed false: "G<xx> date unconfirmed, it cannot be drawn. Confirm at /admin/games." One NEEDS ANTHONY line for each game that kicked off before D in ET and is not final: "G<xx> kicked off <day> <time> ET and is not final. Enter halftime and final at /admin/score."

3. THE KICKOFF EMAIL, only when D equals config.claim_deadline and D is before the first game's ET date: send kickoff_D by the steps in 5.

4. THE GAME-DAY EMAIL, only when at least one game is today's.
4a. Draw and publish: select admin_draw_day('tnf-game-day')::text (with the claim). It draws only today's games, each its own draw with fresh randomness, publishes them at once, never redraws a drawn game, publishes one Anthony drew by hand and left unpublished, and on a repeat run changes nothing. For each entry in problems add "G<xx> <problem>. Draw and publish it at /admin/digits, then run TNF Game Day again from claude.ai/code > Code > Routines." If its verify.all_ok is false, stop as in 1.
4b. Send gameday_D by the steps in 5. If the claim refuses because a game's digits are not published, send nothing and add "gameday_D not sent: <the refusal>. Fix at /admin/digits, then run TNF Game Day again."

5. HOW AN EMAIL GOES OUT, with K the event key. Each step stops the email at the first failure, with "K not sent: <the step and its message>." in the report, and nothing is retried.
5a. Already done? select count(*) as claimed, count(*) filter (where gmail_message_id is not null) as sent from email_sends where event_key = 'K'. If sent is above 0: K went out already; report "K already sent" and skip to the next email. If claimed is above 0 and sent is 0: a claim with no send; do not claim or send again; add "K claimed at <claimed_at> but not recorded as sent. Check Gmail Sent, then admin_email_unsent()." and skip.
5b. Facts, each written exactly as returned: select admin_email_context('K', 'anthonydellapia@gmail.com')::text (with the claim) to /tmp/ctx.json; the owners query in docs/ROUTINES.md to /tmp/owners.json; select admin_email_broadcast_plan('K')::text (with the claim) to /tmp/plan.json.
5c. Dry run: npm run email -- --event K --context /tmp/ctx.json --owners /tmp/owners.json --broadcast-plan /tmp/plan.json --min-bcc 25 --max-bcc 40 --dry-run. It prints sha, envelope_md5, to, cc and bcc and refuses if the plan and the envelope are not the same people. to must be 1 and cc must be 2.
5d. Claim: select admin_email_claim_broadcast('K', '<sha>', '{}', 25, 40, 'tnf-game-day', '<the approval string in 0d>')::text (with the claim). Its envelope_md5 must equal the dry run's; if not, stop and report both.
5e. Send: the same npm run email command with --send-broadcast --claim <claim_id> --expect-sha <sha> --expect-envelope <envelope_md5> in place of --dry-run. It prints the Gmail message id.
5f. Record: select admin_email_record_sent_broadcast('K', '<message id>', '<sha>', 'tnf-game-day')::text (with the claim).
5g. Report line: "K sent <time ET>: To 1, Cc 2, Bcc <bcc>."

REPORT. A section titled NEEDS ANTHONY with every line from the steps above, then one line per email sent or already sent. Never print an email address or a password. If nothing is due today and nothing needs him, the entire report is the words NO ACTION.
```
