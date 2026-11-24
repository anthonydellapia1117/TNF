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
    expect(five).toMatch(/The source is 'scores:G' for a problem from 2 or 3, and 'winners:G' for a problem from 1 or 4/);
    expect(five).toMatch(/a score problem from 3 is "Nothing was scored or sent\. Enter halftime and final at \/admin\/score"/);
    expect(five).toMatch(/a winning block with no payout behind it \(4b\) is "Nothing was sent\. That is Anthony's call, for example record the payment and re-enter that score at \/admin\/score"/);
    expect(five).toMatch(/a claim with no send \(1, 4b, 4c, 4d\) is "[^"]*Check Gmail Sent, then admin_email_unsent\(\)"/);
    expect(five).toMatch(/<the action>, then run TNF Results again from claude\.ai\/code > Routines before noon ET the next day\."/);
    expect(five).toMatch(/If the stage refuses as already staged and still open, that row stands: do not stage again, and the new problem goes in the run report/);
    expect(five).toMatch(/Send nothing/);
    expect(PROMPT).not.toMatch(/'scores:G', 'tnf-results'/);
  });

  it("is what the routine's saved pointer names", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/RESULTS_PROMPT.md. Open that file and follow everything between its two code fences",
    );
  });
});
