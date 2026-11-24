// npm run scores -- --day <file> [--fixture <file>]
//
// The results run's one source of scores (Part N). --day is the export of
//   select admin_email_context('winners_<YYYY-MM-DD>', '<ADMIN_EMAIL>')::text
// (its day facts name the date's games, teams and any score already entered).
// This command fetches ESPN's public scoreboard for that date, or reads
// --fixture instead, checks every game (src/lib/espn.ts: final, periods sum
// to the total, halftime = Q1 + Q2, final includes OT), and prints JSON:
//
//   ready     true only when every game of the date is final, checked, and
//             either unscored or already scored with exactly these numbers
//   games     per game: the scores, what to do (score | already_scored |
//             problem) and any problem
//   sql       the admin_score_game calls to run, in order, each its own
//             execute_sql with the admin claim first (empty unless ready)
//
// It writes nothing, sends nothing and never re-scores a game: a score that
// differs from one already entered is a problem for Anthony (/admin/score).

import { readFileSync } from "node:fs";
import { checkGame, findGame, parseScoreboard } from "../src/lib/espn.ts";
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

const ACTOR = "tnf-results";
const CLAIM = `select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);`;

async function main() {
  const dayPath = opt("day") ?? die("--day, the export of admin_email_context('winners_<date>', ...), is required");
  const ctx = JSON.parse(readFileSync(dayPath, "utf8")) as EmailContext;
  const day = ctx.day ?? die("the --day file has no day facts; export admin_email_context('winners_<date>', ...)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) die(`bad date ${day.date}`);
  if (day.games.length === 0) die(`no games on ${day.date}`);

  const fixture = opt("fixture");
  let json: unknown;
  if (fixture) {
    json = JSON.parse(readFileSync(fixture, "utf8"));
  } else {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day.date.replace(/-/g, "")}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) die(`ESPN answered ${res.status} for ${url}`);
    json = await res.json();
  }
  const board = parseScoreboard(json);

  const games = day.games.map((g) => {
    const hit = findGame(board, g.away_team, g.home_team);
    if (typeof hit === "string") return { game_no: g.game_no, action: "problem" as const, problems: [hit] };
    const c = checkGame(hit);
    if (!c.ok || !c.halftime || !c.final) return { game_no: g.game_no, action: "problem" as const, problems: c.problems };
    const entered = [g.halftime_away, g.halftime_home, g.final_away, g.final_home];
    const espn = [c.halftime.away, c.halftime.home, c.final.away, c.final.home];
    const base = { game_no: g.game_no, halftime: c.halftime, final: c.final };
    if (entered.every((x) => x === null)) return { ...base, action: "score" as const, problems: [] as string[] };
    if (entered.every((x, i) => x === espn[i])) return { ...base, action: "already_scored" as const, problems: [] as string[] };
    return {
      ...base,
      action: "problem" as const,
      problems: [`already scored ${entered.join("-")} (away-home halftime, away-home final), ESPN says ${espn.join("-")}; never re-scored automatically`],
    };
  });

  const ready = games.every((g) => g.action !== "problem");
  const sql = ready
    ? games.flatMap((g) =>
        g.action === "score" && "halftime" in g && g.halftime && g.final
          ? [
              `${CLAIM} select admin_score_game((select id from games where game_no = ${g.game_no}), 'halftime', ${g.halftime.away}, ${g.halftime.home}, '${ACTOR}');`,
              `${CLAIM} select admin_score_game((select id from games where game_no = ${g.game_no}), 'final', ${g.final.away}, ${g.final.home}, '${ACTOR}');`,
            ]
          : [],
      )
    : [];
  console.log(JSON.stringify({ date: day.date, ready, games, sql }, null, 2));
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
