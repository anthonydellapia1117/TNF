// Scores from ESPN's public NFL scoreboard (Part N, the results run).
//
//   https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD
//
// Halftime is Q1 + Q2 for each team; final is the total, overtime included.
// A game is taken only when ESPN says it is final AND each team's periods add
// up to its total. Anything else is not ready, and the results run sends
// nothing and asks Anthony (/admin/score). Pure: no fetch here.

export interface EspnTeamLine {
  name: string;
  total: number;
  periods: number[];
}

export interface EspnGame {
  away: EspnTeamLine;
  home: EspnTeamLine;
  completed: boolean;
  statusName: string;
}

export interface Score {
  away: number;
  home: number;
}

export interface CheckedGame {
  ok: boolean;
  halftime: Score | null;
  final: Score | null;
  problems: string[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Every event on one scoreboard, home and away by ESPN's own homeAway. */
export function parseScoreboard(json: unknown): EspnGame[] {
  const events = (json as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) throw new Error("espn: the scoreboard has no events array");
  return events.map((e, i) => {
    const comp = (e as { competitions?: unknown[] }).competitions?.[0] as
      | { competitors?: unknown[]; status?: { type?: { completed?: boolean; name?: string } } }
      | undefined;
    if (!comp || !Array.isArray(comp.competitors)) throw new Error(`espn: event ${i} has no competitors`);
    const side = (ha: "home" | "away"): EspnTeamLine => {
      const t = comp.competitors!.find((c) => (c as { homeAway?: string }).homeAway === ha) as
        | { team?: { displayName?: string }; score?: unknown; linescores?: { value?: unknown }[] }
        | undefined;
      if (!t?.team?.displayName) throw new Error(`espn: event ${i} has no ${ha} team`);
      const total = num(t.score);
      const periods = (t.linescores ?? []).map((l) => num(l.value));
      return {
        name: t.team.displayName,
        total: total ?? NaN,
        periods: periods.map((p) => (p === null ? NaN : p)),
      };
    };
    const st = comp.status?.type ?? (e as { status?: { type?: { completed?: boolean; name?: string } } }).status?.type ?? {};
    return { away: side("away"), home: side("home"), completed: st.completed === true, statusName: st.name ?? "" };
  });
}

/** The halftime and final scores of one game, or why it cannot be taken. */
export function checkGame(g: EspnGame): CheckedGame {
  // A game not yet final is that and nothing else: its periods are still
  // coming, so checking them would read a game in progress as a bad score.
  if (!g.completed || !/^STATUS_FINAL/.test(g.statusName)) {
    return { ok: false, halftime: null, final: null, problems: [`not final (${g.statusName || "no status"})`] };
  }
  const problems: string[] = [];
  for (const [who, t] of [["away", g.away], ["home", g.home]] as const) {
    if (!Number.isInteger(t.total) || t.total < 0) problems.push(`${who} total is not a whole number`);
    if (t.periods.length < 4) problems.push(`${who} has ${t.periods.length} periods, not 4 or more`);
    if (t.periods.some((p) => !Number.isInteger(p) || p < 0)) problems.push(`${who} has a period that is not a whole number`);
    const sum = t.periods.reduce((a, b) => a + b, 0);
    if (Number.isInteger(t.total) && sum !== t.total) problems.push(`${who} periods sum to ${sum}, total says ${t.total}`);
  }
  if (g.away.periods.length !== g.home.periods.length) problems.push("the two teams have different period counts");
  if (problems.length) return { ok: false, halftime: null, final: null, problems };
  return {
    ok: true,
    halftime: { away: g.away.periods[0] + g.away.periods[1], home: g.home.periods[0] + g.home.periods[1] },
    final: { away: g.away.total, home: g.home.total },
    problems,
  };
}

/** The scoreboard game for one of ours: same away team, same home team, exactly one. */
export function findGame(board: EspnGame[], away: string, home: string): EspnGame | string {
  const norm = (s: string) => s.trim().toLowerCase();
  const hits = board.filter((g) => norm(g.away.name) === norm(away) && norm(g.home.name) === norm(home));
  if (hits.length === 1) return hits[0];
  const flipped = board.filter((g) => norm(g.away.name) === norm(home) && norm(g.home.name) === norm(away));
  if (hits.length === 0 && flipped.length) return `ESPN lists ${home} at ${away}, the other way round from the pool`;
  return hits.length === 0 ? `ESPN has no ${away} at ${home} on that date` : `ESPN has ${hits.length} games ${away} at ${home}`;
}
