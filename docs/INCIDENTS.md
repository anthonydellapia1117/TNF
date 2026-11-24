# Incidents

One entry per thing that went wrong in the running of this pool, newest
first. Each says what happened, how it was seen, what it cost, what was done
and what check now catches it. Rules that came out of an incident live in
`CLAUDE.md`; this file is the story behind them. No addresses, ever.

Older failures that predate this file are in `CLAUDE.md` beside the rule each
one produced, and listed in `docs/2026-11-23_TNF_ONBOARDING.md`, section 8.

## 2026-11-23 - A routine made from a session has no connectors, and none can be added

**What happened.** Part N needed a second routine, TNF Results, to pull scores
and send the winners email. It was created from a Claude Code cloud session
with `create_trigger`.

| Time (ET, Mon Nov 23) | Event |
|---|---|
| 9:46 PM | `create_trigger` with `connectors: ["Supabase", "Gmail"]` is refused: `the connectors parameter is not available for this organization. Omit the connectors parameter.` |
| 9:46 PM | The same call without the list succeeds and makes `trig_01CJpJ6NAj9o9TEN1oRSUtwY`, with `mcp_connections` empty and this warning: `this trigger stores no MCP connectors, so the sessions it fires will run without connector (mcp__<server>__*) tools. Connectors on triggers created via this tool are limited to those the calling session itself holds; this call had none to pass through` |
| 9:46 PM | The session pauses the routine at once, so it never fires |
| 9:59 PM | Anthony, who could not find the routine in the UI to add the connectors by hand, approves Part O in the TNF PM chat |
| 10:14 PM | TNF Game Day's stored prompt is the dispatcher and its cron covers the results hours; TNF Results is renamed `TNF Results (unused, no connectors)` |

**Why it matters.** The results run reads games and writes scores through the
Supabase connector. With no connectors every fire would have failed, hourly,
on Thanksgiving Eve, and the winners email would never have gone.
`update_trigger` takes a name, a cron, an enabled flag, a model and a prompt,
and nothing else, so the session could not repair what it had made.

**What it cost.** Nothing in the pool: the routine was paused before its first
fire and no game had been played. About an hour of the evening before the
first live send.

**What was done (Part O).** TNF Game Day already held Gmail and Supabase and
was created by a session, so `update_trigger` works on it. It now fires at the
results hours too, and `docs/DISPATCH_PROMPT.md` routes each fire by the ET
hour: 9 or 10 the morning run, 16 to 23 or 0 to 2 the results run, any other
hour nothing. TNF Results stays paused and is never deleted.

**What was wrong before it happened.** `docs/ROUTINES.md` said "`create_trigger`
does take a `connectors` list. The claim that the org rejects it was stale."
That line was itself stale, and it was trusted. It is corrected.

**What is not known.** Other routines on the account were made through the
same tool surface and do carry connectors, so which session makes the routine
matters. The warning names two ways that should work: a session that holds
the connectors in a form it can pass on, or the claude.ai Routines UI. Neither
was tried.

**The checks that catch it now.**

1. After creating or editing a routine, read `mcp_connections` back off the
   trigger. An empty list on a routine that needs the database is a stop.
2. A routine that cannot do its job is paused before its first fire, renamed
   to say so, and left in place. Never deleted: a delete loses the record.
3. `tests/unit/dispatch-prompt.test.ts` holds the routing: every hour the cron
   fires at lands on a routed hour, and every game night is covered.

**Still open.**

- A session cannot read a fired run's report: no tool here returns another
  session's transcript, so the live proof of 10:14 PM is the run record
  (succeeded, 30 seconds) and a database that did not change, not the words
  the run wrote. The fix is the ops command in
  `docs/2026-11-23_TNF_ONBOARDING.md`, section 11, item 1: a run that writes
  its own one-line log.
- If a results routine of its own is ever wanted again, it is made in the UI
  or from a session that can pass connectors, and TNF Game Day's cron gives
  the results hours back first. Two routines on the same hours would race.
