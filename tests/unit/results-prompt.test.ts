import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TNF Results (Anthony, 2026-11-23, Part N): scores from ESPN's public
// scoreboard, written through admin_score_game, then the winners email once
// per game date. Any failed check sends nothing and stages one NEEDS ANTHONY.
const DOC = readFileSync(join(process.cwd(), "docs/RESULTS_PROMPT.md"), "utf8");
const FENCES = DOC.split("\n").filter((l) => l.startsWith("```"));
const PROMPT = DOC.split("```")[1] ?? "";
const ROUTINES = readFileSync(join(process.cwd(), "docs/ROUTINES.md"), "utf8");
const CLAIM = `set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true)`;
const APPROVAL =
  "Anthony approved the game-day flow and the kickoff, game-day and winners templates in the TNF PM chat on 2026-11-23 at 2:53 PM ET (Part N)";
const line = (p: string) => PROMPT.split("\n").find((l) => l.startsWith(p)) ?? "";
const HEAD = DOC.split("```")[0] ?? "";
const CLAUDE_MD = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
// S2 (review round two): digits written by hand with no draw have one exit.
describe("results prompt", () => {
  it("has exactly two code fences", () => {
    expect(FENCES).toHaveLength(2);
    expect(PROMPT.length).toBeGreaterThan(500);
  });

  it("sets the admin claim and carries the approval string", () => {
    expect(PROMPT).toContain(CLAIM);
    expect(line("0d.")).toContain(APPROVAL);
  });

  it("settles yesterday before noon ET, so a game ending after midnight is covered", () => {
    expect(line("0.")).toMatch(/yesterday's ET date when the ET hour is before 12/);
  });

  it("stops at once when winners_G already went, and stages a claim with no send", () => {
    expect(line("1.")).toMatch(/If sent is above 0, the whole report is NO ACTION/);
    expect(line("1.")).toMatch(/If claimed is above 0 and sent is 0, it is a claim with no send: do not claim or send again; stage as in 5 with the problem "winners_G claimed but not recorded as sent", and stop\./);
  });

  // Review of PR 42: a manual re-run on the afternoon after a held winners
  // email set G to today and found no games. email_day_not_ready (migration 43)
  // allows winners_<date> for today or yesterday.
  it("falls back to yesterday once when no game is on G and it is noon or later", () => {
    expect(line("1.")).toMatch(/If games is 0 and the ET hour is 12 or later, set G to yesterday's ET date and run the same query once more/);
    expect(line("1.")).toMatch(/If games is still 0, the whole report is NO ACTION/);
  });

  it("checks the lock before scoring", () => {
    expect(PROMPT.indexOf("admin_verify_digits()")).toBeLessThan(PROMPT.indexOf("npm run scores -- --day"));
  });

  it("writes only the score lines npm run scores prints, never a typed score", () => {
    expect(line("3b.")).toMatch(/run each line of sql, in order, each as its own execute_sql call exactly as printed/);
    expect(line("0c.")).toMatch(/never enter a score npm run scores did not print/);
    expect(line("0c.")).toMatch(/Never re-score a game/);
    expect(PROMPT).not.toMatch(/select admin_score_game\(/);
  });

  // Review of PR 42: the 4:25 to 7:25 PM ET fires come before the last kickoff
  // on every game date, where a game reads "not final (STATUS_SCHEDULED)"; a
  // cutoff counted from a kickoff that has not happened staged NEEDS ANTHONY.
  it("waits until 4 hours 30 minutes after the last kickoff, a game not yet kicked off included, and stages anything else", () => {
    expect(line("1.")).toMatch(/max\(kickoff_at\) as last_kickoff/);
    expect(line("3.")).toMatch(/The cutoff is 4 hours 30 minutes after last_kickoff from 1, the last kickoff of G\./);
    expect(line("3a.")).toMatch(
      /when every problem starts with "not final" and it is earlier than the cutoff, 4 hours 30 minutes after the last kickoff of G \(a game not yet kicked off counts as still going\), the games are still going: the whole report is NO ACTION/,
    );
    expect(line("3a.")).not.toMatch(/ago/);
    expect(line("3a.")).toMatch(/Otherwise stage as in 5/);
  });

  it("treats npm run scores failing outright like a game still going until the cutoff, then stages", () => {
    expect(line("3.")).toMatch(
      /If npm run scores exits non-zero or prints no ready \(ESPN down, bad JSON\): earlier than the cutoff, the whole report is NO ACTION and the next run tries again; at the cutoff or later, stage as in 5 with its message, and stop\./,
    );
  });

  it("stops the winners email at the first failure in 4a to 4d, stages it, and retries nothing", () => {
    expect(line("4.")).toMatch(/Each of 4a to 4d stops the email at its first failure and stages as in 5 with the step and its message; nothing is retried in this run\./);
    expect(line("4c.")).toMatch(/If it fails, the claim stands with no send: stage as in 5 and stop\./);
    expect(line("4d.")).toMatch(/If it fails, the email went out unrecorded: stage as in 5/);
  });

  it("sends the winners email through the same ledgered path", () => {
    expect(line("4a.")).toMatch(/--dry-run/);
    expect(line("4a.")).toMatch(/to must be 1 and cc must be 2/);
    expect(line("4b.")).toMatch(/admin_email_claim_broadcast\('K', '<sha>', '\{\}', 25, 40, 'tnf-results'/);
    expect(line("4c.")).toMatch(/--send-broadcast --claim <claim_id> --expect-sha <sha> --expect-envelope <envelope_md5>/);
    expect(line("4d.")).toMatch(/admin_email_record_sent_broadcast\('K'/);
  });

  it("refers an unpaid winning block to Anthony and sends nothing", () => {
    expect(line("4b.")).toMatch(/a winning block with no payout behind it included \(that is Anthony's call\)/);
  });

  // Review of PR 42: one source per date meant a later, different problem was
  // refused as already open, and every summary told Anthony to enter scores.
  it("stages one row per problem class and date, each saying what Anthony does for that problem", () => {
    const five = line("5.");
    expect(five).toMatch(/select admin_stage_pending\('unclassified_mail', <payload>, '<source>', 'tnf-results'\)::text \(with the claim\)/);
    expect(five).toMatch(/The source is 'scores:G' for a problem from 0a, 2 or 3, and 'winners:G' for a problem from 1 or 4/);
    expect(five).toMatch(/a score problem from 3 or 3a is "Nothing was scored or sent\. Enter halftime and final at \/admin\/score/);
    expect(five).toMatch(/a winning block with no payout behind it \(4a or 4b\) is "Nothing was sent\. That is Anthony's call, for example record the payment and re-enter that score at \/admin\/score"/);
    expect(five).toMatch(/a claim with no send \(1, 4b when the envelope_md5 does not match, 4c, 4d\) is "Check Gmail Sent\./);
    // Part O: TNF Game Day runs the results run, so the row names its fires,
    // never a routine with no connectors.
    expect(five).toContain(`<the action>. TNF Game Day runs the results run again at its next fire: hourly from 4:10 PM to 2:10 AM ET, then 9:10 and 10:10 AM ET the morning after."`);
    expect(PROMPT).not.toMatch(/run TNF Results again/);
    expect(five).toMatch(/If the stage refuses as already staged and still open, that row stands: do not stage again, and the new problem goes in the run report/);
    expect(five).toMatch(/Send nothing/);
    expect(PROMPT).not.toMatch(/'scores:G', 'tnf-results'/);
  });

  // Review round two: a failed clone or install was a report line only.
  it("stages a failed clone or install under scores:G through the connector when there is work, and stops", () => {
    const a = line("0a.");
    expect(a).not.toMatch(/the report is one NEEDS ANTHONY line naming the failed step/);
    expect(a).toMatch(/If the clone or the install fails, run 1 with the Supabase connector, which needs no repo\./);
    expect(a).toMatch(/If 1 ends the run, its report stands, with one NEEDS ANTHONY line naming the failed step added\./);
    // Round three: before the cutoff a clone failure stages nothing (the next
    // run retries; a row now would hold the source a real problem needs).
    expect(a).toContain("Otherwise, earlier than the cutoff (4 hours 30 minutes after last_kickoff from 1), the report is that one NEEDS ANTHONY line, nothing is staged and the next run tries again; at the cutoff or later, stage as in 5 (source 'scores:G', step 0a, the summary naming the failed step). Either way stop.");
    expect(line("5.")).toMatch(/The source is 'scores:G' for a problem from 0a, 2 or 3,/);
    expect(line("5.")).toContain(`a failed clone or install (0a) is "Nothing was scored or sent. Fix what the message names"`);
    expect(flat(HEAD)).toMatch(/a failed clone or install included, under `scores:<date>`/);
    // Part O: the results run is TNF Game Day's, so its row carries the writes.
    const row = ROUTINES.split("\n").find((l) => l.startsWith("| 2 | TNF Game Day |")) ?? "";
    expect(row).toMatch(/when a check fails, a failed clone or install included/);
    const unused = ROUTINES.split("\n").find((l) => l.startsWith("| 4 | TNF Results |")) ?? "";
    expect(unused).toMatch(/paused, never fired/);
    expect(unused).toMatch(/none, and none can be added/);
  });

  // A claim with no send is never sent by a re-run (1 stops on it), so its row
  // says how Anthony settles it and does not tell him to run TNF Results again.
  it("tells Anthony how to settle a claim with no send, and does not end that row with the re-run sentence", () => {
    const five = line("5.");
    expect(five).toContain(
      `a claim with no send (1, 4b when the envelope_md5 does not match, 4c, 4d) is "Check Gmail Sent. If it went, record it: select admin_email_record_sent_broadcast('winners_G', '<message id>', '<sha>', 'anthony'). If it did not, the claim stays and a send now is by hand; the results run will not send it."`,
    );
    expect(five).toMatch(/the morning after\.", except for a claim with no send, whose summary ends with its action\./);
    expect(five).not.toMatch(/The winners email is claimed and not recorded as sent\. Check Gmail Sent, then admin_email_unsent\(\)/);
  });

  it("keys the no-payout refusal to the renderer or the claim", () => {
    expect(line("5.")).toContain("a winning block with no payout behind it (4a or 4b) is");
    expect(line("5.")).not.toContain("a winning block with no payout behind it (4b) is");
  });

  it("says a failure partway through 3b leaves what was written standing", () => {
    expect(line("5.")).toContain(
      `a failure in 3b is "Some scores may be written; what was written stands and the next run finishes the rest. If it keeps failing, enter halftime and final at /admin/score"`,
    );
  });

  // S5: once Anthony enters both scores at /admin/score, npm run scores lets
  // them stand when ESPN cannot confirm them, so a re-run sends the email.
  it("tells Anthony a re-run sends the winners email once both scores are entered", () => {
    expect(line("5.")).toContain(
      `a score problem from 3 or 3a is "Nothing was scored or sent. Enter halftime and final at /admin/score (once both are entered there, a re-run sends the winners email even if ESPN still cannot confirm them)"`,
    );
  });

  it("prints the lock's hashes with none for a missing draw row, and sends digits with no draw to the clear", () => {
    expect(line("2.")).toContain(`"G<xx> digits do not match their draw row (expected <first 12 of expected, or none>, now <first 12 of actual>)"`);
    expect(line("5.")).toContain(`digits written with no draw (2, drawn false) are "Nothing was scored or sent. G<xx> has digits written with no draw, and past kickoff it can no longer be drawn or scored: Anthony's call (admin_override_digits(<game>, null, null, <reason>, 'anthony') clears them)"`);
    expect(line("5.")).toContain(`digits that changed after their draw (2, drawn true) are "Nothing was scored or sent. Anthony's call: admin_override_digits with the drawn digits (its draw audit row has them) restores them, before any score"`);
    expect(PROMPT).not.toMatch(/the next run draws it/);
  });

  it("says a problem of the other class gets its own row and a second of the same class goes in the report", () => {
    expect(line("5.")).toContain(
      "so a problem of the other class gets its own row; a second problem of the same class goes in the run report",
    );
    expect(PROMPT).not.toMatch(/a later, different problem/);
    expect(flat(ROUTINES)).not.toMatch(/a later, different problem gets its/);
    expect(flat(ROUTINES)).toContain(
      "so a problem of the other class gets its own row; a second problem of the same class goes in the run report",
    );
  });

  // Review round two: CLAUDE.md read as if every problem waited for the
  // cutoff. Only a game not final, or ESPN not answering, waits.
  it("CLAUDE.md says any problem other than not final is staged at once", () => {
    const part = flat(CLAUDE_MD.split("- **Thanksgiving game-day automation")[1]?.split("\n- **")[0] ?? "");
    expect(part).toContain(
      "Only a game not final (or not yet kicked off), or ESPN not answering, waits: until 4 hours 30 minutes after the date's last kickoff the results run tries again at the next fire, and after that it is NEEDS ANTHONY. Any other problem is NEEDS ANTHONY at once.",
    );
    expect(part).not.toMatch(/after that, anything else is NEEDS ANTHONY/);
  });

  it("is what the routine's saved pointer names", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/RESULTS_PROMPT.md. Open that file and follow everything between its two code fences",
    );
  });
});
