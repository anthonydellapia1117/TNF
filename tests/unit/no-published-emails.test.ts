import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The repo github.com/anthonydellapia1117/TNF is PUBLIC. A real email address
// in a tracked file is an address published to the open internet permanently,
// and deleting the line later does not clear it from the git history.
//
// This guard exists because the rule was written and then broken in the same
// change: migration 25 carried a comment saying the addresses must never be in
// a repo file, and seeded all eight owners' addresses ten lines below it.
// Seven of them were not previously in the repo at all. A human review caught
// it; nothing in the suite did.
//
// The test is deliberately shaped as a RATCHET rather than a clean assertion.
// A pile of addresses predates this guard, and failing outright on them would
// mean either deleting the guard or rewriting files this change does not own.
// Instead every offending file is pinned at its exact count below. A new file
// fails. One more address in an already-listed file fails. The only direction
// a number may move is down, and each one that reaches zero comes off the list.

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Anthony's own addresses. He is the sole admin and these are already the
// documented admin identity in src/lib/env.ts and every SQL suite's admin
// claim. Publishing his own address is his call and he has already made it.
const OWN_ADDRESSES = new Set([
  "anthonydellapia@gmail.com",
  "anthony.dellapia@us.gt.com",
]);

// Fixture domains. RFC 2606 reserves example.com; the rest are local inventions
// that resolve nowhere and belong to nobody.
const FIXTURE_DOMAINS =
  /@(example\.com|tnf\.test|test|invalid|localhost|b\.co)$/;
// b.co is the throwaway address in tests/unit/intake-grammar.test.ts, used only
// to satisfy the parser's EMAIL_RE. Listed explicitly rather than loosened into
// a shape rule: every fixture domain here is a deliberate entry someone had to
// add, which is the property that keeps a real address from slipping past.

// Pre-existing debt, measured 2026-09-10. Each number is the count of DISTINCT
// third-party addresses that file already published before this guard existed.
// These are real people's addresses on a public repo and clearing them needs
// Anthony's call, not a silent rewrite: the seed and the build spec carry
// participant contact detail, and purging them properly means rewriting main's
// history, not just deleting the lines.
const KNOWN_DEBT: Record<string, number> = {
  "TNF_APP_BUILD_SPEC.md": 15,
  "supabase/seed.sql": 15,
  "tests/unit/game-day-pack.test.ts": 5,
  "tests/sql/15_cc_email.sql": 6,
  "docs/PARTICIPANT_DATA_RULES.md": 1,
  "tests/sql/16_game_day_bucket.sql": 1,
  "tests/unit/contact-gaps.test.ts": 1,
};

// TRACKED files only. An unstaged file is invisible to this guard, which is
// correct for CI (it runs on committed code) but means a local run before
// `git add` proves nothing. Verified by probing with a real-looking address:
// untracked it passes, staged it fails.
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function thirdPartyAddresses(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return []; // deleted, or not a regular file
  }
  const found = new Set<string>();
  for (const raw of text.match(ADDRESS) ?? []) {
    const addr = raw.toLowerCase();
    if (OWN_ADDRESSES.has(addr)) continue;
    if (FIXTURE_DOMAINS.test(addr)) continue;
    found.add(addr);
  }
  return [...found];
}

describe("no third-party email addresses in the repo", () => {
  const offenders = new Map<string, number>();
  for (const file of trackedFiles()) {
    if (file === "tests/unit/no-published-emails.test.ts") continue;
    const n = thirdPartyAddresses(file).length;
    if (n > 0) offenders.set(file, n);
  }

  it("adds no new file carrying a third-party address", () => {
    const unlisted = [...offenders.keys()].filter((f) => !(f in KNOWN_DEBT));
    expect(
      unlisted,
      `These tracked files commit a third-party email address. ` +
        `Move the address into the owners or participants table and refer to it ` +
        `by row, the way docs/OWNERS.md and CLAUDE.md do.`,
    ).toEqual([]);
  });

  it("adds no address to a file that already carries some", () => {
    const grown = [...offenders.entries()]
      .filter(([f, n]) => f in KNOWN_DEBT && n > KNOWN_DEBT[f])
      .map(([f, n]) => `${f}: ${KNOWN_DEBT[f]} -> ${n}`);
    expect(grown, "The debt list only moves down.").toEqual([]);
  });

  it("keeps the debt list honest, so a cleaned file leaves it", () => {
    const stale = Object.keys(KNOWN_DEBT)
      .filter((f) => (offenders.get(f) ?? 0) < KNOWN_DEBT[f])
      .map((f) => `${f}: pinned ${KNOWN_DEBT[f]}, now ${offenders.get(f) ?? 0}`);
    expect(
      stale,
      `Fewer addresses than pinned - good. Lower the pin (or delete the entry ` +
        `at zero) so the ratchet holds at the new level.`,
    ).toEqual([]);
  });

  it("keeps migrations free of addresses entirely, with no debt allowance", () => {
    const migrations = trackedFiles().filter((f) =>
      f.startsWith("supabase/migrations/"),
    );
    expect(migrations.length).toBeGreaterThan(0);
    const dirty = migrations.filter((f) => thirdPartyAddresses(f).length > 0);
    expect(
      dirty,
      `A migration must never carry contact detail. Seed the codes and the ` +
        `names, and provision addresses out of band - see migration 25.`,
    ).toEqual([]);
  });
});
