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

  it("stops at once when winners_G already went or is claimed and unsent", () => {
    expect(line("1.")).toMatch(/If sent is above 0, the whole report is NO ACTION/);
    expect(line("1.")).toMatch(/claimed but not recorded as sent/);
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

  it("waits while games are still going, and stages anything else", () => {
    expect(line("3a.")).toMatch(/less than 4 hours 30 minutes ago/);
    expect(line("3a.")).toMatch(/Otherwise stage as in 5/);
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

  it("stages NEEDS ANTHONY once per date, pointing at /admin/score", () => {
    expect(line("5.")).toMatch(/admin_stage_pending\('unclassified_mail', <payload>, 'scores:G', 'tnf-results'\)/);
    expect(line("5.")).toMatch(/\/admin\/score\./);
    expect(line("5.")).toMatch(/Send nothing/);
  });

  it("is what the routine's saved pointer names", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/RESULTS_PROMPT.md. Open that file and follow everything between its two code fences",
    );
  });
});
