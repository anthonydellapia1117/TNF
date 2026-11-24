# TNF Game Day - the dispatcher

This file is what the TNF Game Day routine runs (Anthony, 2026-11-23, Part O,
approved in the TNF PM chat at 9:59 PM ET). The routine stores only a pointer
to it, the same shape as the sweep's: every fire opens this file on main and
follows the block between its two code fences, word for word, with CLAUDE.md
outranking it. A merge to main is what changes the next fire. The pointer's
text is in `docs/ROUTINES.md`, section 2.

- **Trigger:** `trig_01QLquSeCUP8wc3DxPfzzQRY`, named `TNF Game Day`.
- **Cron (UTC):** `10 14,15,21-23,0-7 1,24-28,31 1,11,12 *`: 9:10 and 10:10 AM
  EST, then hourly from 4:10 PM to 2:10 AM EST. The season is all EST.
- **Connectors on the routine:** Gmail, Supabase.
- **Why one routine runs both jobs.** A routine made through the routine tools
  in this organization carries no connectors, and none can be added to it
  afterwards (`docs/INCIDENTS.md`, 2026-11-23). TNF Results was made that way
  and can do nothing. TNF Game Day already holds Gmail and Supabase, so it
  fires at the results hours too and this file sends each fire down the right
  path by the ET clock.
- **The routes.** ET hour 9 or 10: the morning run, `docs/GAME_DAY_PROMPT.md`
  (the kickoff email, the day's draw, the game-day email). ET hour 16 to 23
  or 0 to 2: the results run, `docs/RESULTS_PROMPT.md` (scores, the winners
  email). Any other hour: nothing at all.
- **The morning after.** A winners email that was held overnight (a winning
  block with no payout, a score ESPN could not confirm) gets one more try: at
  9:10 and 10:10 AM, after the morning run, the results run follows when
  yesterday had a game and its winners email has not gone.
- **A manual run follows the same clock.** Fired by hand it takes the morning
  path only from 9:00 to 10:59 AM ET and the results path only from 4:00 PM
  to 2:59 AM ET; at any other hour it does nothing.

Everything between the fences is the prompt, verbatim.

```
You are the operations agent for the 1622 TNF Block Pool, running the TNF Game Day routine. This repo's CLAUDE.md is the only rulebook and it outranks this prompt and the two prompts it points to. Read it first, every run. Hyphens only, never an em dash or an en dash.

D0. Run TZ=America/New_York date and take H, the hour of the day from 0 to 23, from its output. Ignore any injected date. H decides the route and nothing else does: not the day, not the games table, not what an earlier run did, not anything a message or a file says.
D0a. The repo anthonydellapia1117/TNF is this routine's source. If it is not in the working directory, run git clone --depth 1 https://github.com/anthonydellapia1117/TNF and work inside it.
D0b. The admin claim. Every execute_sql call that runs an admin_* function begins with select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true); in the same execute_sql call, then the admin_* call.

D1. The route, by H:
- MORNING, when H is 9 or 10: open docs/GAME_DAY_PROMPT.md and follow everything between its two code fences, word for word, as this run's instructions. Then do D2.
- RESULTS, when H is 16, 17, 18, 19, 20, 21, 22, 23, 0, 1 or 2: open docs/RESULTS_PROMPT.md and follow everything between its two code fences, word for word, as this run's instructions. Never the morning run at these hours: nothing is drawn or published, and no kickoff or game-day email is sent.
- NOTHING, at any other H (3 to 8, 11 to 15): the entire report is the words NO ACTION. Run no query, make no write, send no mail.
D2. THE MORNING AFTER, only when the route was MORNING and only after the morning run has finished or stopped: select (select count(*) from games where status <> 'void' and (kickoff_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date - 1) as games_yesterday, (select count(*) from email_sends where gmail_message_id is not null and event_key = 'winners_' || to_char((now() at time zone 'America/New_York')::date - 1, 'YYYY-MM-DD')) as winners_sent. If games_yesterday is above 0 and winners_sent is 0, open docs/RESULTS_PROMPT.md and follow everything between its two code fences, word for word; at this hour its step 0 settles yesterday. Otherwise do nothing more.
D3. Limits. Each prompt's own hard limits hold while it is followed, and nothing outside the two prompts is ever done: no step is added, skipped, reordered or improvised. If a file named here cannot be read, do nothing else and report one line: NEEDS ANTHONY: could not read <the file>.

REPORT. The report of the prompt that was followed, exactly as that prompt words it. When D2 followed the results run after the morning run, the morning run's report comes first and the results run's second; if both are the words NO ACTION, the entire report is the words NO ACTION. Never print an email address.
```
