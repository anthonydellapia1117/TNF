import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TNF Game Day's saved prompt is a pointer to docs/GAME_DAY_PROMPT.md, the
// same shape as the sweep's (Anthony, 2026-10-13): the file is the prompt, the
// block between its two fences is what runs, and a merge to main changes the
// next fire. Grids go out as links, never uploads, so ADMIN_PASSWORD is not
// needed; every admin_* call carries the admin claim.
const DOC = readFileSync(join(process.cwd(), "docs/GAME_DAY_PROMPT.md"), "utf8");
const FENCES = DOC.split("\n").filter((l) => l.startsWith("```"));
const PROMPT = DOC.split("```")[1] ?? "";
const ROUTINES = readFileSync(join(process.cwd(), "docs/ROUTINES.md"), "utf8");
const CLAIM = `set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true)`;

describe("game day prompt", () => {
  it("has exactly two code fences, so 'between its two code fences' is one block", () => {
    expect(FENCES).toHaveLength(2);
    expect(PROMPT.length).toBeGreaterThan(500);
  });

  it("sets the admin claim in the call that fetches each game's context", () => {
    expect(PROMPT).toContain(CLAIM);
    expect(PROMPT).toMatch(/admin_email_context\('game_day_g<NN>'/);
  });

  it("renders the grid as links only: no upload, no admin password", () => {
    expect(PROMPT).toMatch(/--link-only/);
    expect(PROMPT).not.toMatch(/--upload/);
    expect(PROMPT).not.toMatch(/ADMIN_PASSWORD/);
  });

  it("drafts through the command with the owners export, and never sends", () => {
    expect(PROMPT).toMatch(/--draft/);
    expect(PROMPT).toMatch(/--owners/);
    expect(PROMPT).toMatch(/--context/);
    expect(PROMPT).toMatch(/never send an email/i);
  });

  // Codex review of PR 25: a retry must not write a second draft, so the Drafts
  // check runs before --draft, never after it.
  it("renders without --draft, searches Drafts, and only then drafts", () => {
    const a3 = PROMPT.split("\n").find((l) => l.startsWith("A3.")) ?? "";
    const dry = a3.indexOf("without --draft");
    const search = a3.indexOf("Search Drafts for that subject");
    const draft = a3.indexOf("rerun the same command with --draft");
    expect(dry).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(dry);
    expect(draft).toBeGreaterThan(search);
  });

  it("does nothing on a date with no game today and none yesterday", () => {
    expect(PROMPT).toMatch(/the entire report is the words NO ACTION/);
  });

  it("is what the routine's saved pointer names, verbatim in ROUTINES.md", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/GAME_DAY_PROMPT.md. Open that file and follow everything between its two code fences",
    );
  });

  // Part M (Anthony, 2026-11-20): with DN blank the pack goes out without him,
  // through the same audited one-time override a sent broadcast uses. The
  // audit row comes after the Drafts check and before the draft, and the
  // override names DN alone.
  it("leaves DN off To on the record: audit after the Drafts check, before the draft", () => {
    const a3 = PROMPT.split("\n").find((l) => l.startsWith("A3.")) ?? "";
    const search = a3.indexOf("Search Drafts for that subject");
    const audit = a3.indexOf("select admin_email_omit_owners('game_day_g<NN>', array['DN'], 'tnf-game-day')");
    const draft = a3.indexOf("rerun the same command with --draft");
    expect(audit).toBeGreaterThan(search);
    expect(draft).toBeGreaterThan(audit);
    expect(a3.slice(search, draft)).toContain(CLAIM);
    expect(a3).toMatch(/if DN is the one owner whose email is null or blank/);
    expect(a3).toMatch(/if any other owner has no address, or DN has one, add no override/);
    expect(a3).toMatch(/--omit-owner DN to both runs/);
  });

  it("writes to the database only for that audit row", () => {
    const b0 = PROMPT.split("\n").find((l) => l.startsWith("0b.")) ?? "";
    expect(b0).toMatch(/Never write to the database, with one exception: A3's admin_email_omit_owners call/);
    const writes = PROMPT.match(/select admin_[a-z_]+\(/g) ?? [];
    expect([...new Set(writes)].sort()).toEqual(["select admin_email_context(", "select admin_email_omit_owners("]);
  });
});

