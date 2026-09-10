import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// docs/SWEEP_PROMPT.md is the source of truth for the one routine that writes,
// so its ordering is behaviour, not prose. These tests exist because the
// ordering has already failed once in production: on 2026-09-08 the sweep
// labelled Tom Nataloni's Venmo thread Pool-TNF-Done and staged a
// payment_candidate row, then never wrote a ledger row. A labelled thread is
// not read again, so block 23 sat reserved for two days with his $500 already
// in Anthony's account. The label was applied before the write it depended on.
const PROMPT = readFileSync(
  join(process.cwd(), "docs/SWEEP_PROMPT.md"),
  "utf8",
);

/** The numbered step a line belongs to, e.g. "6a. ..." -> 6. */
function stepOf(line: string): number | null {
  const m = /^(\d+)[a-z]?\./.exec(line.trim());
  return m ? Number(m[1]) : null;
}

/** The lowest-numbered step whose text matches, or null. */
function firstStepMatching(re: RegExp): number | null {
  let found: number | null = null;
  for (const line of PROMPT.split("\n")) {
    const step = stepOf(line);
    if (step === null || !re.test(line)) continue;
    if (found === null || step < found) found = step;
  }
  return found;
}

describe("sweep prompt: the label never runs before the write", () => {
  it("the Pool-TNF-Done label lives in a later step than staging a row", () => {
    const stage = firstStepMatching(/admin_stage_pending/);
    const label = firstStepMatching(/CLOSE THE LOOP/);
    expect(stage).not.toBeNull();
    expect(label).not.toBeNull();
    expect(label!).toBeGreaterThan(stage!);
  });

  it("the close-the-loop step states the label waits on a committed write", () => {
    const step = PROMPT.split("\n").find((l) => /^6\. /.test(l.trim()));
    expect(step).toBeDefined();
    expect(step!).toMatch(/ONLY AFTER THE WRITE IT DEPENDS ON HAS COMMITTED/);
    expect(step!).toMatch(/LAST step for a thread/);
  });

  it("an uncommitted or failed write leaves the thread unlabelled", () => {
    expect(PROMPT).toMatch(/LEAVE THE THREAD UNLABELLED/);
  });

  it("the earlier steps never label a thread before their own write", () => {
    // 4c stages then labels. It must say the label follows the staging, not
    // precede it. "Then label" with no dependency was the shape that failed.
    const line = PROMPT.split("\n").find((l) => l.trim().startsWith("4c."));
    expect(line).toBeDefined();
    expect(line!).toMatch(/only after that staging has come back successful/);
  });

  it("records the defect so the ordering is not quietly reverted", () => {
    expect(PROMPT).toMatch(/2026-09-08/);
    expect(PROMPT).toMatch(/payment_candidate/);
  });
});

describe("sweep prompt: the kind string is a closed list", () => {
  it("says the list is closed and that staging rejects anything else", () => {
    expect(PROMPT).toMatch(/THE KIND STRING IS A CLOSED LIST/);
    expect(PROMPT).toMatch(/rejects anything not on it/);
  });

  it("forbids the two kinds that must never be staged again", () => {
    expect(PROMPT).toMatch(/NEVER stage "payment_candidate"/);
    expect(PROMPT).toMatch(/NEVER stage "owner_owes_refund"/);
  });
});

describe("sweep prompt: the money scope", () => {
  it("narrows chasing to Anthony's own money", () => {
    expect(PROMPT).toMatch(/Anthony tracks HIS OWN money only/);
    expect(PROMPT).toMatch(/never stage a queue row about it/);
  });

  it("keeps the arithmetic whole-pool", () => {
    expect(PROMPT).toMatch(/never filtered by owner code/);
    expect(PROMPT).toMatch(/what narrows is the chasing, not the arithmetic/);
  });

  it("keeps the AVD move for money that reached Anthony", () => {
    expect(PROMPT).toMatch(/moves that participant to AVD as usual/);
  });
});
