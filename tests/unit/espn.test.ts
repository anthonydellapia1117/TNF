import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkGame, findGame, parseScoreboard, type EspnGame } from "@/lib/espn";

// Real ESPN scoreboards, trimmed to the fields the parser reads (public data).
const fixture = (f: string) => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/espn", f), "utf8"));

const synth = (away: number[], home: number[], over: Partial<EspnGame> = {}): EspnGame => ({
  away: { name: "Green Bay Packers", total: away.reduce((a, b) => a + b, 0), periods: away },
  home: { name: "Los Angeles Rams", total: home.reduce((a, b) => a + b, 0), periods: home },
  completed: true,
  statusName: "STATUS_FINAL",
  ...over,
});

describe("espn: parse and check", () => {
  it("takes an overtime final: halftime is Q1 + Q2, final includes OT", () => {
    const board = parseScoreboard(fixture("2025-11-02-ot.json"));
    const g = findGame(board, "Jacksonville Jaguars", "Las Vegas Raiders");
    expect(typeof g).not.toBe("string");
    const c = checkGame(g as EspnGame);
    expect(c.ok).toBe(true);
    expect((g as EspnGame).away.periods).toHaveLength(5);
    expect(c.halftime).toEqual({ away: 3, home: 6 });
    expect(c.final).toEqual({ away: 30, home: 29 });
  });

  it("reads every game of a Thanksgiving slate", () => {
    const board = parseScoreboard(fixture("2025-11-27-thanksgiving.json"));
    expect(board).toHaveLength(3);
    for (const g of board) expect(checkGame(g).ok).toBe(true);
  });

  it("takes a 0-0 halftime as 0-0, not as missing", () => {
    const c = checkGame(synth([0, 0, 7, 3], [0, 0, 3, 10]));
    expect(c.ok).toBe(true);
    expect(c.halftime).toEqual({ away: 0, home: 0 });
    expect(c.final).toEqual({ away: 10, home: 13 });
  });

  it("refuses a game that is not final", () => {
    const c = checkGame(synth([7, 3, 0, 0], [0, 0, 0, 0], { completed: false, statusName: "STATUS_IN_PROGRESS" }));
    expect(c.ok).toBe(false);
    expect(c.problems.join(" ")).toMatch(/not final/);
  });

  // Rehearsal, Part N: a game still going (third quarter, three periods) or
  // not started (no periods) must read as "not final" and nothing else, so the
  // results run waits instead of staging NEEDS ANTHONY mid-game.
  it("reports a game still going as not final, and only that", () => {
    const going = checkGame(synth([3, 7, 7], [0, 3, 10], { completed: false, statusName: "STATUS_IN_PROGRESS" }));
    expect(going.problems).toEqual(["not final (STATUS_IN_PROGRESS)"]);
    const before = checkGame(synth([], [], { completed: false, statusName: "STATUS_SCHEDULED" }));
    expect(before.problems).toEqual(["not final (STATUS_SCHEDULED)"]);
  });

  it("refuses periods that do not add up to the total", () => {
    const g = synth([7, 3, 7, 3], [0, 0, 3, 10]);
    g.away.total = 21;
    const c = checkGame(g);
    expect(c.ok).toBe(false);
    expect(c.problems.join(" ")).toMatch(/away periods sum to 20, total says 21/);
  });

  it("refuses fewer than four periods", () => {
    expect(checkGame(synth([7, 3, 7], [0, 0, 3])).ok).toBe(false);
  });

  it("finds a game only with the same away and home, and says when ESPN has it flipped", () => {
    const board = [synth([7, 0, 0, 0], [0, 0, 0, 3])];
    expect(typeof findGame(board, "Green Bay Packers", "Los Angeles Rams")).toBe("object");
    expect(findGame(board, "Los Angeles Rams", "Green Bay Packers")).toMatch(/other way round/);
    expect(findGame(board, "Chicago Bears", "Detroit Lions")).toMatch(/no Chicago Bears at Detroit Lions/);
  });
});
