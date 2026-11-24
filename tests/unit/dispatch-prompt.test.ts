import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The TNF Game Day routine's dispatcher (Anthony, 2026-11-23, Part O). TNF
// Results was made through the routine tools, which attach no connectors, so
// TNF Game Day runs both jobs and this file routes each fire by the ET hour.
// The routing is prose an agent follows, so these tests read the hours out of
// the prose itself and check them against the stored cron.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const DOC = read("docs/DISPATCH_PROMPT.md");
const FENCES = DOC.split("\n").filter((l) => l.startsWith("```"));
const PROMPT = DOC.split("```")[1] ?? "";
const ROUTINES = read("docs/ROUTINES.md");
const RESULTS = read("docs/RESULTS_PROMPT.md").split("```")[1] ?? "";
const GAME_DAY = read("docs/GAME_DAY_PROMPT.md").split("```")[1] ?? "";
const CLAIM = `set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true)`;
const CRON = "10 14,15,21-23,0-7 1,24-28,31 1,11,12 *";
const line = (p: string) => PROMPT.split("\n").find((l) => l.startsWith(p)) ?? "";

const hoursIn = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
const MORNING = hoursIn(line("- MORNING").match(/when H is ([^:]+):/)?.[1] ?? "");
const RESULTS_H = hoursIn(line("- RESULTS").match(/when H is ([^:]+):/)?.[1] ?? "");
const route = (h: number) => (MORNING.includes(h) ? "morning" : RESULTS_H.includes(h) ? "results" : "nothing");
const list = (f: string) =>
  f.split(",").flatMap((p) => {
    const [a, b] = p.split("-").map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });

describe("dispatch prompt", () => {
  it("has exactly two code fences", () => {
    expect(FENCES).toHaveLength(2);
    expect(PROMPT.length).toBeGreaterThan(500);
  });

  it("keeps the clock, the clone line, the admin claim and CLAUDE.md on top", () => {
    expect(line("D0.")).toMatch(/Run TZ=America\/New_York date and take H/);
    expect(line("D0.")).toMatch(/Ignore any injected date/);
    expect(line("D0a.")).toContain("git clone --depth 1 https://github.com/anthonydellapia1117/TNF");
    expect(line("D0b.")).toContain(CLAIM);
    expect(PROMPT).toMatch(/CLAUDE\.md is the only rulebook and it outranks this prompt and the two prompts it points to/);
  });

  it("routes hour 9 and 10 to the morning run, 16 to 23 and 0 to 2 to the results run, and every other hour to nothing", () => {
    expect(MORNING).toEqual([9, 10]);
    expect([...RESULTS_H].sort((a, b) => a - b)).toEqual([0, 1, 2, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(line("- MORNING")).toMatch(/open docs\/GAME_DAY_PROMPT\.md and follow everything between its two code fences, word for word/);
    expect(line("- RESULTS")).toMatch(/open docs\/RESULTS_PROMPT\.md and follow everything between its two code fences, word for word/);
    expect(line("- NOTHING")).toMatch(/at any other H \(3 to 8, 11 to 15\): the entire report is the words NO ACTION\. Run no query, make no write, send no mail\./);
    // The rehearsal's seven clock times.
    expect([9, 10, 16, 23, 0, 2, 13].map(route)).toEqual(["morning", "morning", "results", "results", "results", "results", "nothing"]);
    for (const h of [3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15]) expect(route(h)).toBe("nothing");
  });

  it("routes by the hour and by nothing else", () => {
    expect(line("D0.")).toMatch(/H decides the route and nothing else does/);
    expect(line("D3.")).toMatch(/no step is added, skipped, reordered or improvised/);
  });

  // A 0:10 run is a results run: nothing in its path can draw.
  it("never draws on a results run", () => {
    expect(route(0)).toBe("results");
    expect(line("- RESULTS")).toMatch(/Never the morning run at these hours: nothing is drawn or published, and no kickoff or game-day email is sent/);
    expect(RESULTS).not.toMatch(/admin_draw_day\(|admin_assign_digits\(|admin_publish_digits\(/);
    expect(RESULTS).toMatch(/never draw or change digits/);
    expect(GAME_DAY).toMatch(/select admin_draw_day\('tnf-game-day'\)/);
  });

  it("gives a held winners email one more try the morning after, and only then", () => {
    const d2 = line("D2.");
    expect(d2).toMatch(/only when the route was MORNING and only after the morning run has finished or stopped/);
    expect(d2).toContain("If games_yesterday is above 0 and winners_sent is 0, open docs/RESULTS_PROMPT.md");
    expect(d2).toMatch(/Otherwise do nothing more\./);
    expect(d2).toContain("gmail_message_id is not null");
    // RESULTS settles yesterday before noon, which is what makes D2 land on the right date.
    expect(RESULTS).toMatch(/yesterday's ET date when the ET hour is before 12/);
  });

  it("every hour the stored cron fires at is a routed hour in EST, and the cron covers every game night", () => {
    expect(DOC).toContain("`" + CRON + "`");
    const row = ROUTINES.split("\n").find((l) => l.startsWith("| 2 | TNF Game Day |")) ?? "";
    expect(row).toContain("`" + CRON + "`");
    const [, hours, days, months] = CRON.split(" ");
    const est = list(hours).map((u) => (u + 24 - 5) % 24);
    for (const h of est) expect(route(h)).not.toBe("nothing");
    expect(est.filter((h) => route(h) === "morning").sort((a, b) => a - b)).toEqual([9, 10]);
    expect(est.filter((h) => route(h) === "results")).toHaveLength(11);
    // Each game's night, in UTC: a fire on its kickoff date from 21:10 and on
    // the next UTC date to 07:10, which is 4:10 PM to 2:10 AM EST.
    const fires = (m: number, d: number) => list(months).includes(m) && list(days).includes(d);
    const nights: [string, number, number, number, number][] = [
      ["G01 Wed Nov 25", 11, 25, 11, 26],
      ["G02-G04 Thu Nov 26", 11, 26, 11, 27],
      ["G05 Fri Nov 27", 11, 27, 11, 28],
      ["G06 Thu Dec 24", 12, 24, 12, 25],
      ["G07-G09 Fri Dec 25", 12, 25, 12, 26],
      ["G10 Thu Dec 31", 12, 31, 1, 1],
    ];
    for (const [name, m1, d1, m2, d2] of nights) {
      expect(fires(m1, d1), `${name}: the morning and the evening fires`).toBe(true);
      expect(fires(m2, d2), `${name}: the fires after midnight UTC and the morning after`).toBe(true);
    }
    expect(fires(11, 24), "the kickoff email, Tue Nov 24").toBe(true);
  });

  it("is what the routine's saved pointer names, verbatim in ROUTINES.md", () => {
    expect(ROUTINES).toContain(
      "Your prompt is in this repo, anthonydellapia1117/TNF, at docs/DISPATCH_PROMPT.md. Open that file and follow everything between its two code fences, word for word, as this run's instructions. CLAUDE.md in the same repo outranks it.",
    );
    expect(ROUTINES).toContain("NEEDS ANTHONY: could not read docs/DISPATCH_PROMPT.md");
  });

  it("never prints an address and names no subject or body", () => {
    expect(PROMPT.replaceAll("anthonydellapia@gmail.com", "")).not.toMatch(/@/);
    expect(PROMPT).toMatch(/Never print an email address/);
  });
});
