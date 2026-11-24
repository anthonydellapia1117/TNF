// The results run's scoring plan (Part N): which admin_score_game calls to make
// for one game date, given that date's games (email_day_facts, migration 43)
// and ESPN's scoreboard for it (parseScoreboard in ./espn.ts). Pure: no fetch,
// no file, no database. scripts/scores.mts reads the inputs and prints this.
//
// Per game, halftime and final are judged separately against ESPN:
//
//   neither entered              score           halftime line, then final line
//   halftime entered and equal   score_final     final line only
//   final entered and equal      score_halftime  halftime line only
//   both entered and equal       already_scored  no line
//   any entered pair differs     problem         never re-scored automatically
//   void                         void            skipped, no line
//
// ESPN must say final with periods that add up (checkGame) before any of that.
// One problem anywhere means ready is false and sql is empty for every game:
// a date is scored whole or not at all, and the rest is Anthony's call at
// /admin/score.

import { checkGame, findGame, type EspnGame, type Score } from "./espn.ts";
import type { DayFacts } from "./email/types.ts";

/** The actor every scoring call is audited under. */
export const SCORE_ACTOR = "tnf-results";

/** The admin claim each execute_sql call sets first (CLAUDE.md, Supabase connector). */
export const SCORE_CLAIM = `select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);`;

export type ScoreAction = "score" | "score_halftime" | "score_final" | "already_scored" | "problem" | "void";

export interface PlannedGame {
  game_no: number;
  /** ESPN's numbers, present once the game passed checkGame. */
  halftime?: Score;
  final?: Score;
  action: ScoreAction;
  problems: string[];
}

export interface ScorePlan {
  date: string;
  /** True only when every game of the date is void or has no problem, and at least one is not void. */
  ready: boolean;
  games: PlannedGame[];
  /** The admin_score_game calls, in order, each its own execute_sql. Empty unless ready. */
  sql: string[];
}

const show = (v: number | null) => (v === null ? "none" : String(v));
const entered = (a: number | null, b: number | null) => a !== null || b !== null;
const same = (a: number | null, b: number | null, s: Score) => a === s.away && b === s.home;

function planGame(g: DayFacts["games"][number], board: EspnGame[]): PlannedGame {
  if (g.status === "void") return { game_no: g.game_no, action: "void", problems: [] };
  // game_no goes into the sql text, so it has to be a plain whole number.
  if (!Number.isInteger(g.game_no) || g.game_no < 1) {
    return { game_no: g.game_no, action: "problem", problems: [`game_no ${String(g.game_no)} is not a whole number`] };
  }
  const hit = findGame(board, g.away_team, g.home_team);
  if (typeof hit === "string") return { game_no: g.game_no, action: "problem", problems: [hit] };
  const c = checkGame(hit);
  if (!c.ok || !c.halftime || !c.final) return { game_no: g.game_no, action: "problem", problems: c.problems };

  const base = { game_no: g.game_no, halftime: c.halftime, final: c.final };
  const htIn = entered(g.halftime_away, g.halftime_home);
  const fnIn = entered(g.final_away, g.final_home);
  const htOff = htIn && !same(g.halftime_away, g.halftime_home, c.halftime);
  const fnOff = fnIn && !same(g.final_away, g.final_home, c.final);
  if (htOff || fnOff) {
    const ours = [g.halftime_away, g.halftime_home, g.final_away, g.final_home].map(show).join("-");
    const espn = [c.halftime.away, c.halftime.home, c.final.away, c.final.home].join("-");
    return {
      ...base,
      action: "problem",
      problems: [`already scored ${ours} (away-home halftime, away-home final), ESPN says ${espn}; never re-scored automatically`],
    };
  }
  if (htIn && fnIn) return { ...base, action: "already_scored", problems: [] };
  if (htIn) return { ...base, action: "score_final", problems: [] };
  if (fnIn) return { ...base, action: "score_halftime", problems: [] };
  return { ...base, action: "score", problems: [] };
}

function line(game_no: number, type: "halftime" | "final", s: Score): string {
  return `${SCORE_CLAIM} select admin_score_game((select id from games where game_no = ${game_no}), '${type}', ${s.away}, ${s.home}, '${SCORE_ACTOR}');`;
}

/** What to write for one game date, or why nothing is written. */
export function planScores(day: DayFacts, board: EspnGame[]): ScorePlan {
  const games = day.games.map((g) => planGame(g, board));
  const ready = games.some((g) => g.action !== "void") && games.every((g) => g.action !== "problem");
  const sql = ready
    ? games.flatMap((g) => {
        if (!g.halftime || !g.final) return [];
        const out: string[] = [];
        if (g.action === "score" || g.action === "score_halftime") out.push(line(g.game_no, "halftime", g.halftime));
        if (g.action === "score" || g.action === "score_final") out.push(line(g.game_no, "final", g.final));
        return out;
      })
    : [];
  return { date: day.date, ready, games, sql };
}
