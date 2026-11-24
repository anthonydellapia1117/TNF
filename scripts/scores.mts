// npm run scores -- --day <file> [--fixture <file>]
//
// The results run's one source of scores (Part N). --day is the export of
//   select admin_email_context('winners_<YYYY-MM-DD>', '<ADMIN_EMAIL>')::text
// (its day facts name the date's games, teams and any score already entered).
// This command fetches ESPN's public scoreboard for that date, or reads
// --fixture instead, and prints planScores (src/lib/score-plan.ts) as JSON:
//
//   ready     true only when every game of the date is final, checked
//             (src/lib/espn.ts: periods sum to the total, halftime = Q1 + Q2,
//             final includes OT), and each score type is either unscored or
//             already scored with exactly these numbers; or, when ESPN cannot
//             confirm a game, it has halftime and final both entered, and
//             stands as entered
//   games     per game: the scores, what to do (score | score_halftime |
//             score_final | already_scored | problem | void), any problem,
//             and a note when a game stands as entered without ESPN's word
//   sql       the admin_score_game calls to run, in order, each its own
//             execute_sql with the admin claim first (empty unless ready)
//
// It writes nothing, sends nothing and never re-scores a game: a score that
// differs from one already entered is a problem for Anthony (/admin/score).
// The decision lives in src/lib/score-plan.ts, unit-tested; this file only
// reads the inputs and prints.

import { readFileSync } from "node:fs";
import { parseScoreboard } from "../src/lib/espn.ts";
import { planScores } from "../src/lib/score-plan.ts";
import type { EmailContext } from "../src/lib/email/types.ts";

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
}
function die(msg: string): never {
  console.error(`scores: ${msg}`);
  process.exit(1);
}

async function main() {
  const dayPath = opt("day") ?? die("--day, the export of admin_email_context('winners_<date>', ...), is required");
  const ctx = JSON.parse(readFileSync(dayPath, "utf8")) as EmailContext;
  const day = ctx.day ?? die("the --day file has no day facts; export admin_email_context('winners_<date>', ...)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) die(`bad date ${day.date}`);
  if (!day.games.some((g) => g.status !== "void")) die(`no games on ${day.date}`);

  const fixture = opt("fixture");
  let board;
  try {
    let json: unknown;
    if (fixture) {
      json = JSON.parse(readFileSync(fixture, "utf8"));
    } else {
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day.date.replace(/-/g, "")}`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`ESPN answered ${res.status} for ${url}`);
      json = await res.json();
    }
    board = parseScoreboard(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ESPN unreadable: scores Anthony entered at /admin/score in full still
    // stand (planScores with no board marks each one unconfirmed); anything
    // short of that waits for ESPN, as before.
    const allEntered = day.games
      .filter((g) => g.status !== "void")
      .every((g) => [g.halftime_away, g.halftime_home, g.final_away, g.final_home].every((v) => v !== null));
    if (!allEntered) die(msg);
    console.log(JSON.stringify({ ...planScores(day, []), espn_error: msg }, null, 2));
    return;
  }
  console.log(JSON.stringify(planScores(day, board), null, 2));
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
