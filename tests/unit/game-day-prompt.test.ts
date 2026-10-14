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

  it("does nothing on a date with no game today and none yesterday", () => {
    expect(PROMPT).toMatch(/the entire report is the words NO ACTION/);
  });

  it("is what the routine's saved pointer names, verbatim in ROUTINES.md", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/GAME_DAY_PROMPT.md. Open that file and follow everything between its two code fences",
    );
  });
});
