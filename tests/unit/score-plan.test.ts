import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScoreboard, type EspnGame } from "@/lib/espn";
import { planScores, SCORE_ACTOR, SCORE_CLAIM } from "@/lib/score-plan";
import type { DayFacts, DayGame } from "@/lib/email/types";

// The results run's plan (Part N): which admin_score_game lines to run for a
// game date. The sql is executed verbatim by docs/RESULTS_PROMPT.md 3b, so the
// exact text is what is asserted here.

const fixture = (f: string) => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/espn", f), "utf8"));
// 2025 Thanksgiving, from the real scoreboard:
//   GB 31 at DET 24, halftime 17-14
//   KC 28 at DAL 31, halftime 14-17
//   CIN 32 at BAL 14, halftime 12-7
const TG = () => parseScoreboard(fixture("2025-11-27-thanksgiving.json"));

const CLAIM = `select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);`;
const sqlLine = (no: number, type: "halftime" | "final", away: number, home: number) =>
  `${CLAIM} select admin_score_game((select id from games where game_no = ${no}), '${type}', ${away}, ${home}, 'tnf-results');`;

const game = (game_no: number, away_team: string, home_team: string, over: Partial<DayGame> = {}): DayGame => ({
  game_no,
  week: 12,
  kickoff_at: "2025-11-27T17:30:00Z",
  holiday_label: "Thanksgiving",
  away_team,
  home_team,
  network: null,
  status: "published",
  published: true,
  row_digits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  col_digits: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  digits_ok: true,
  halftime_away: null,
  halftime_home: null,
  halftime_block: null,
  final_away: null,
  final_home: null,
  final_block: null,
  halftime_name: null,
  final_name: null,
  halftime_paid_out: false,
  final_paid_out: false,
  ...over,
});
const GB = (over: Partial<DayGame> = {}) => game(2, "Green Bay Packers", "Detroit Lions", over);
const KC = (over: Partial<DayGame> = {}) => game(3, "Kansas City Chiefs", "Dallas Cowboys", over);
const CIN = (over: Partial<DayGame> = {}) => game(4, "Cincinnati Bengals", "Baltimore Ravens", over);
const day = (...games: DayGame[]): DayFacts => ({ date: "2025-11-27", games });

const GB_DONE = { halftime_away: 17, halftime_home: 14, final_away: 31, final_home: 24 };
const KC_DONE = { halftime_away: 14, halftime_home: 17, final_away: 28, final_home: 31 };
const CIN_DONE = { halftime_away: 12, halftime_home: 7, final_away: 32, final_home: 14 };

describe("score plan", () => {
  it("prints the claim and actor the results run has always used", () => {
    expect(SCORE_CLAIM).toBe(CLAIM);
    expect(SCORE_ACTOR).toBe("tnf-results");
  });

  it("scores an unscored date: halftime then final, away then home, in game order", () => {
    const p = planScores(day(GB(), KC(), CIN()), TG());
    expect(p.date).toBe("2025-11-27");
    expect(p.ready).toBe(true);
    expect(p.games.map((g) => g.action)).toEqual(["score", "score", "score"]);
    expect(p.games[0]).toEqual({
      game_no: 2,
      halftime: { away: 17, home: 14 },
      final: { away: 31, home: 24 },
      action: "score",
      problems: [],
    });
    expect(p.sql).toEqual([
      sqlLine(2, "halftime", 17, 14),
      sqlLine(2, "final", 31, 24),
      sqlLine(3, "halftime", 14, 17),
      sqlLine(3, "final", 28, 31),
      sqlLine(4, "halftime", 12, 7),
      sqlLine(4, "final", 32, 14),
    ]);
  });

  it("writes nothing for a date already scored with ESPN's numbers, and is ready", () => {
    const p = planScores(day(GB(GB_DONE), KC(KC_DONE), CIN(CIN_DONE)), TG());
    expect(p.ready).toBe(true);
    expect(p.games.map((g) => g.action)).toEqual(["already_scored", "already_scored", "already_scored"]);
    expect(p.games.every((g) => g.problems.length === 0)).toBe(true);
    expect(p.sql).toEqual([]);
  });

  it("never re-scores a score that differs from ESPN, and then writes nothing for any game", () => {
    const p = planScores(day(GB({ ...GB_DONE, final_home: 27 }), KC(), CIN()), TG());
    expect(p.ready).toBe(false);
    expect(p.games[0].action).toBe("problem");
    expect(p.games[0].problems).toEqual([
      "already scored 17-14-31-27 (away-home halftime, away-home final), ESPN says 17-14-31-24; never re-scored automatically",
    ]);
    expect(p.games[1].action).toBe("score");
    expect(p.sql).toEqual([]);
  });

  it("names a missing score none, not an empty string", () => {
    const p = planScores(day(GB({ halftime_away: 14, halftime_home: 17 })), TG());
    expect(p.games[0].action).toBe("problem");
    expect(p.games[0].problems[0]).toBe(
      "already scored 14-17-none-none (away-home halftime, away-home final), ESPN says 17-14-31-24; never re-scored automatically",
    );
    expect(p.games[0].problems[0]).not.toMatch(/--/);
    expect(p.sql).toEqual([]);
  });

  it("finishes a game whose halftime is in: the final line only", () => {
    const p = planScores(day(GB({ halftime_away: 17, halftime_home: 14 }), KC()), TG());
    expect(p.ready).toBe(true);
    expect(p.games.map((g) => g.action)).toEqual(["score_final", "score"]);
    expect(p.sql).toEqual([sqlLine(2, "final", 31, 24), sqlLine(3, "halftime", 14, 17), sqlLine(3, "final", 28, 31)]);
  });

  it("fills in a halftime when only the final is in: the halftime line only", () => {
    const p = planScores(day(GB({ final_away: 31, final_home: 24 })), TG());
    expect(p.ready).toBe(true);
    expect(p.games[0].action).toBe("score_halftime");
    expect(p.sql).toEqual([sqlLine(2, "halftime", 17, 14)]);
  });

  it("treats a half-entered pair as differing from ESPN", () => {
    const p = planScores(day(GB({ halftime_away: 17 })), TG());
    expect(p.ready).toBe(false);
    expect(p.games[0].problems[0]).toMatch(/^already scored 17-none-none-none /);
    expect(p.sql).toEqual([]);
  });

  it("lets one problem game suppress the sql for every game of the date", () => {
    const p = planScores(day(GB(), game(3, "Chicago Bears", "Detroit Lions"), CIN()), TG());
    expect(p.ready).toBe(false);
    expect(p.games.map((g) => g.action)).toEqual(["score", "problem", "score"]);
    expect(p.games[1].problems).toEqual(["ESPN has no Chicago Bears at Detroit Lions on that date"]);
    expect(p.sql).toEqual([]);
  });

  it("refuses a game ESPN lists the other way round", () => {
    const p = planScores(day(GB(), game(3, "Dallas Cowboys", "Kansas City Chiefs")), TG());
    expect(p.ready).toBe(false);
    expect(p.games[1].problems[0]).toMatch(/other way round/);
    expect(p.sql).toEqual([]);
  });

  it("refuses a game ESPN lists twice", () => {
    const board = TG();
    const p = planScores(day(GB(), KC()), [...board, structuredClone(board[0])]);
    expect(p.ready).toBe(false);
    expect(p.games[0].action).toBe("problem");
    expect(p.games[0].problems).toEqual(["ESPN has 2 games Green Bay Packers at Detroit Lions"]);
    expect(p.sql).toEqual([]);
  });

  it("reads a game still going as not final, and writes nothing", () => {
    const board: EspnGame[] = TG();
    board[1] = {
      ...board[1],
      away: { ...board[1].away, total: 14, periods: [14, 0, 0] },
      home: { ...board[1].home, total: 20, periods: [7, 10, 3] },
      completed: false,
      statusName: "STATUS_IN_PROGRESS",
    };
    const p = planScores(day(GB(), KC(), CIN()), board);
    expect(p.ready).toBe(false);
    expect(p.games[1].action).toBe("problem");
    expect(p.games[1].problems).toEqual(["not final (STATUS_IN_PROGRESS)"]);
    expect(p.games[1].problems.every((x) => x.startsWith("not final"))).toBe(true);
    expect(p.sql).toEqual([]);
  });

  it("takes an overtime game: halftime is Q1 + Q2, final is the total with OT", () => {
    // Jaguars 30 at Raiders 29 in OT, 2025-11-02, renamed onto a pool game.
    const json = fixture("2025-11-02-ot.json");
    for (const c of json.events[0].competitions[0].competitors) {
      c.team.displayName = c.homeAway === "away" ? "Green Bay Packers" : "Detroit Lions";
    }
    const board = parseScoreboard(json);
    expect(board[0].away.periods).toHaveLength(5);
    const p = planScores(day(GB()), board);
    expect(p.ready).toBe(true);
    expect(p.games[0].halftime).toEqual({ away: 3, home: 6 });
    expect(p.games[0].final).toEqual({ away: 30, home: 29 });
    expect(p.sql).toEqual([sqlLine(2, "halftime", 3, 6), sqlLine(2, "final", 30, 29)]);
  });

  // email_day_facts (migration 43) leaves void games out, so this is defence:
  // a void game is never looked up on ESPN and never scored.
  it("skips a void game and scores the rest", () => {
    const p = planScores(day(GB(), game(9, "Chicago Bears", "Detroit Lions", { status: "void" }), CIN()), TG());
    expect(p.ready).toBe(true);
    expect(p.games[1]).toEqual({ game_no: 9, action: "void", problems: [] });
    expect(p.sql).toEqual([
      sqlLine(2, "halftime", 17, 14),
      sqlLine(2, "final", 31, 24),
      sqlLine(4, "halftime", 12, 7),
      sqlLine(4, "final", 32, 14),
    ]);
  });

  it("is never ready with nothing to score", () => {
    expect(planScores(day(), TG()).ready).toBe(false);
    const p = planScores(day(GB({ status: "void" })), TG());
    expect(p.ready).toBe(false);
    expect(p.sql).toEqual([]);
  });

  it("refuses a game_no that is not a whole number, since it goes into the sql", () => {
    const p = planScores(day(GB({ game_no: "2) or (1=1" as unknown as number }), KC()), TG());
    expect(p.ready).toBe(false);
    expect(p.games[0].action).toBe("problem");
    expect(p.sql).toEqual([]);
  });

  it("refuses game_no 0, since no game is numbered below 1", () => {
    const p = planScores(day(GB({ game_no: 0 }), KC()), TG());
    expect(p.ready).toBe(false);
    expect(p.games[0].action).toBe("problem");
    expect(p.games[0].problems[0]).toMatch(/^game_no 0 /);
    expect(p.games[1].action).toBe("score");
    expect(p.sql).toEqual([]);
  });

  // S5: once Anthony enters both halves at /admin/score for a staged problem,
  // a re-run has to let the game stand so the winners email can go.
  const noGB = () => TG().filter((g) => g.away.name !== "Green Bay Packers");
  const KC_CIN_SQL = [
    sqlLine(3, "halftime", 14, 17),
    sqlLine(3, "final", 28, 31),
    sqlLine(4, "halftime", 12, 7),
    sqlLine(4, "final", 32, 14),
  ];

  it("lets a fully entered game ESPN does not list stand as entered: no line, a note, and the date ready", () => {
    const p = planScores(day(GB(GB_DONE), KC(), CIN()), noGB());
    expect(p.ready).toBe(true);
    expect(p.games[0]).toEqual({
      game_no: 2,
      action: "already_scored",
      problems: [],
      note: "ESPN could not confirm the score entered, 17-14-31-24 (away-home halftime, away-home final), so it stands as entered: ESPN has no Green Bay Packers at Detroit Lions on that date",
    });
    expect(p.games[0].halftime).toBeUndefined();
    expect(p.games[0].final).toBeUndefined();
    expect(p.games.map((g) => g.action)).toEqual(["already_scored", "score", "score"]);
    expect(p.sql).toEqual(KC_CIN_SQL);
  });

  it("lets a fully entered game ESPN says is not final stand as entered, with ESPN's problem in the note", () => {
    const board = TG();
    board[0] = { ...board[0], completed: false, statusName: "STATUS_IN_PROGRESS" };
    const p = planScores(day(GB(GB_DONE), KC(), CIN()), board);
    expect(p.ready).toBe(true);
    expect(p.games[0].action).toBe("already_scored");
    expect(p.games[0].problems).toEqual([]);
    expect(p.games[0].note).toBe(
      "ESPN could not confirm the score entered, 17-14-31-24 (away-home halftime, away-home final), so it stands as entered: not final (STATUS_IN_PROGRESS)",
    );
    expect(p.sql).toEqual(KC_CIN_SQL);
  });

  it("lets a fully entered game stand when ESPN lists it flipped, twice or with periods that do not add up", () => {
    const flipped = TG().map((g, i) => (i === 0 ? { ...g, away: g.home, home: g.away } : g));
    const twice = [...TG(), structuredClone(TG()[0])];
    const badSum = TG().map((g, i) => (i === 0 ? { ...g, away: { ...g.away, periods: [17, 0, 0, 0] } } : g));
    for (const [board, why] of [
      [flipped, "ESPN lists Detroit Lions at Green Bay Packers, the other way round from the pool"],
      [twice, "ESPN has 2 games Green Bay Packers at Detroit Lions"],
      [badSum, "away periods sum to 17, total says 31"],
    ] as const) {
      const p = planScores(day(GB(GB_DONE), KC(), CIN()), [...board]);
      expect(p.ready).toBe(true);
      expect(p.games[0].action).toBe("already_scored");
      expect(p.games[0].note).toMatch(new RegExp(`stands as entered: ${why}$`));
      expect(p.sql).toEqual(KC_CIN_SQL);
    }
  });

  it("keeps a fully entered game ESPN confirms with other numbers a problem, with no note", () => {
    const p = planScores(day(GB({ ...GB_DONE, halftime_home: 10 }), KC(), CIN()), TG());
    expect(p.ready).toBe(false);
    expect(p.games[0].action).toBe("problem");
    expect(p.games[0].problems).toEqual([
      "already scored 17-10-31-24 (away-home halftime, away-home final), ESPN says 17-14-31-24; never re-scored automatically",
    ]);
    expect(p.games[0].note).toBeUndefined();
    expect(p.sql).toEqual([]);
  });

  it("keeps a game with only part of its score entered a problem when ESPN cannot confirm it", () => {
    for (const over of [
      { halftime_away: 17, halftime_home: 14 },
      { final_away: 31, final_home: 24 },
      { ...GB_DONE, final_home: null },
    ]) {
      const p = planScores(day(GB(over), KC(), CIN()), noGB());
      expect(p.ready).toBe(false);
      expect(p.games[0].action).toBe("problem");
      expect(p.games[0].problems).toEqual(["ESPN has no Green Bay Packers at Detroit Lions on that date"]);
      expect(p.games[0].note).toBeUndefined();
      expect(p.sql).toEqual([]);
    }
  });

  // Round three of the Part N review: a game is planned only behind published
  // digits that match their draw; a cleared or tampered grid is never scored.
  it("refuses a game whose digits are not published or do not match their draw", () => {
    for (const over of [{ published: false }, { digits_ok: false }, { digits_ok: null }] as Partial<DayGame>[]) {
      const p = planScores(day(GB(over), KC()), TG());
      expect(p.ready).toBe(false);
      expect(p.sql).toEqual([]);
      expect(p.games[0].action).toBe("problem");
      expect(p.games[0].problems.join(" ")).toMatch(/digits are not published or do not match their draw row/);
    }
  });

  it("stands a game as entered only with all four scores in, each one checked", () => {
    for (const k of ["halftime_away", "halftime_home", "final_away", "final_home"] as const) {
      const p = planScores(day(GB({ ...GB_DONE, [k]: null })), []);
      expect(p.games[0].action).toBe("problem");
      expect(p.ready).toBe(false);
    }
  });

  it("joins every ESPN problem into the note", () => {
    const bad = TG();
    const g = bad.find((x) => x.away.name === "Green Bay Packers") as EspnGame;
    g.completed = false;
    g.statusName = "STATUS_IN_PROGRESS";
    const p = planScores(day(GB(GB_DONE)), bad);
    expect(p.games[0].action).toBe("already_scored");
    expect(p.games[0].note).toMatch(/stands as entered: not final \(STATUS_IN_PROGRESS\)$/);
    const two = planScores(day(GB(GB_DONE)), [...TG(), ...TG()]);
    expect(two.games[0].note).toMatch(/stands as entered: ESPN has 2 games/);
  });

});
