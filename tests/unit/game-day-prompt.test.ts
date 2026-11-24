import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TNF Game Day's saved prompt is a pointer to docs/GAME_DAY_PROMPT.md, the
// same shape as the sweep's (Anthony, 2026-10-13): the file is the prompt, the
// block between its two fences is what runs, and a merge to main changes the
// next fire. Part N (Anthony, 2026-11-23): the morning run draws and publishes
// the day's games through admin_draw_day and sends the kickoff and game-day
// emails through the command; it composes nothing itself.
const DOC = readFileSync(join(process.cwd(), "docs/GAME_DAY_PROMPT.md"), "utf8");
const FENCES = DOC.split("\n").filter((l) => l.startsWith("```"));
const PROMPT = DOC.split("```")[1] ?? "";
const ROUTINES = readFileSync(join(process.cwd(), "docs/ROUTINES.md"), "utf8");
const CLAIM = `set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true)`;
const APPROVAL =
  "Anthony approved the game-day flow and the kickoff, game-day and winners templates in the TNF PM chat on 2026-11-23 at 2:53 PM ET (Part N)";
const line = (p: string) => PROMPT.split("\n").find((l) => l.startsWith(p)) ?? "";

describe("game day prompt", () => {
  it("has exactly two code fences, so 'between its two code fences' is one block", () => {
    expect(FENCES).toHaveLength(2);
    expect(PROMPT.length).toBeGreaterThan(500);
  });

  it("sets the admin claim for every admin_* call", () => {
    expect(PROMPT).toContain(CLAIM);
    expect(line("0b.")).toMatch(/Every execute_sql call that runs an admin_\* function begins with/);
  });

  it("checks the lock before anything else, and a mismatch sends nothing", () => {
    const lock = PROMPT.indexOf("select admin_verify_digits()");
    const draw = PROMPT.indexOf("select admin_draw_day(");
    expect(lock).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(lock);
    expect(line("1.")).toMatch(/Nothing sent\." and stop: no draw, no email/);
  });

  it("draws only through admin_draw_day, never the per-game functions", () => {
    expect(line("4a.")).toMatch(/select admin_draw_day\('tnf-game-day'\)/);
    expect(line("0c.")).toMatch(/never call admin_assign_digits, admin_publish_digits or admin_override_digits/);
    const writes = [...new Set(PROMPT.match(/select admin_[a-z_]+\(/g) ?? [])].sort();
    expect(writes).toEqual([
      "select admin_draw_day(",
      "select admin_email_broadcast_plan(",
      "select admin_email_claim_broadcast(",
      "select admin_email_context(",
      "select admin_email_record_sent_broadcast(",
      "select admin_verify_digits(",
    ]);
  });

  it("sends the kickoff only on the claim deadline and the game-day email only on a game date", () => {
    expect(line("3.")).toMatch(/only when D equals config\.claim_deadline/);
    expect(line("4.")).toMatch(/only when at least one game is today's/);
    expect(line("0c.")).toMatch(/never send the winners email/);
  });

  // Never a duplicate: the ledger check runs before the dry run, the claim
  // before the send, the record after it; a claim with no send stops.
  it("checks email_sends, dry-runs, claims, sends, records, in that order", () => {
    const order = ["5a.", "5b.", "5c.", "5d.", "5e.", "5f."].map((p) => PROMPT.indexOf(`\n${p} `));
    order.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(line("5a.")).toMatch(/If sent is above 0: K went out already/);
    expect(line("5a.")).toMatch(/do not claim or send again/);
    expect(line("5c.")).toMatch(/--dry-run/);
    expect(line("5c.")).toMatch(/to must be 1 and cc must be 2/);
    expect(line("5d.")).toContain(`'<the approval string in 0d>'`);
    expect(line("5e.")).toMatch(/--send-broadcast --claim <claim_id> --expect-sha <sha> --expect-envelope <envelope_md5>/);
    expect(line("5f.")).toMatch(/select admin_email_record_sent_broadcast\('K'/);
  });

  it("carries the approval string exactly", () => {
    expect(line("0d.")).toContain(APPROVAL);
  });

  it("never omits an owner on a day email", () => {
    expect(line("5d.")).toMatch(/admin_email_claim_broadcast\('K', '<sha>', '\{\}'/);
    expect(PROMPT).not.toMatch(/--omit-owner/);
    expect(PROMPT).not.toMatch(/admin_email_omit_owners/);
  });

  it("never prints an address", () => {
    expect(PROMPT).toMatch(/Never print an email address/);
    // The one address in the prompt is Anthony's, in the claim and as the
    // context's admin argument.
    expect(PROMPT.replaceAll("anthonydellapia@gmail.com", "")).not.toMatch(/@/);
  });

  it("does nothing on a date with nothing due", () => {
    expect(PROMPT).toMatch(/the entire report is the words NO ACTION/);
  });

  it("is what the routine's saved pointer names, verbatim in ROUTINES.md", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/GAME_DAY_PROMPT.md. Open that file and follow everything between its two code fences",
    );
  });

  it("fires at 9:10 and re-fires at 10:10 AM ET", () => {
    expect(DOC).toContain("`10 14,15 1,24-28,31 1,11,12 *`");
    expect(ROUTINES).toContain("10 14,15 1,24-28,31 1,11,12 *");
  });
});
