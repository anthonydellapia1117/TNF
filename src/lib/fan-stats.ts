// Viewer-side season stats. Everything here is built from what happened on
// the field: scores, digits, and who held the block that hit. Nothing about
// money owed, payment status, or how many people are in the pool.
//
// The grid orientation these all depend on: rows are the AWAY team's last
// digit, columns are the HOME team's, and block = rowIndex * 10 + colIndex + 1
// (see winningBlock in src/lib/pool.ts). Digits are redrawn independently for
// every game, so a cell means nothing across games — only a digit PAIR does.
//
// Pure logic, unit-tested.
import { lastDigit, winningBlock } from "@/lib/pool";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

/** One scored event: a halftime or a final with both scores in. */
export interface ScoredEvent {
  game: PublicGame;
  payoutType: "halftime" | "final";
  home: number;
  away: number;
}

/**
 * Every scored halftime and final, oldest first. A game with digits still
 * unrevealed is skipped: without the permutations there is no cell to talk
 * about, and the public projection withholds them until the reveal anyway.
 */
export function scoredEvents(games: PublicGame[]): ScoredEvent[] {
  const out: ScoredEvent[] = [];
  const inOrder = [...games].sort(
    (a, b) => a.game_no - b.game_no,
  );
  for (const game of inOrder) {
    if (game.status === "void") continue;
    if (game.row_digits === null || game.col_digits === null) continue;
    if (game.halftime_home !== null && game.halftime_away !== null) {
      out.push({
        game,
        payoutType: "halftime",
        home: game.halftime_home,
        away: game.halftime_away,
      });
    }
    if (game.final_home !== null && game.final_away !== null) {
      out.push({
        game,
        payoutType: "final",
        home: game.final_home,
        away: game.final_away,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Digit report: which last digits keep hitting, and which never have.
// ---------------------------------------------------------------------------

export interface DigitReport {
  /** Times each digit 0-9 has been on a winning score, home or away. */
  counts: number[];
  /** Digits that have never been part of a win yet, ascending. */
  neverWon: number[];
  /** The digits tied for the most wins, ascending. Empty before any score. */
  hottest: number[];
  totalEvents: number;
}

export function digitReport(games: PublicGame[]): DigitReport {
  const counts = Array.from({ length: 10 }, () => 0);
  const events = scoredEvents(games);
  for (const e of events) {
    counts[lastDigit(e.home)]++;
    counts[lastDigit(e.away)]++;
  }
  const max = Math.max(...counts);
  return {
    counts,
    neverWon: counts.map((c, d) => ({ c, d })).filter((x) => x.c === 0).map((x) => x.d),
    hottest:
      max === 0
        ? []
        : counts.map((c, d) => ({ c, d })).filter((x) => x.c === max).map((x) => x.d),
    totalEvents: events.length,
  };
}

// ---------------------------------------------------------------------------
// Close calls: blocks one point from a win.
//
// A block was one point away if it would have won had either team scored one
// more or one fewer point. That is the near-miss a player actually feels —
// not grid adjacency, which is meaningless when the digits are redrawn every
// week.
// ---------------------------------------------------------------------------

export interface CloseCall {
  gameNo: number;
  holidayLabel: string | null;
  payoutType: "halftime" | "final";
  blockNumber: number;
  /** The name on the block that hit nothing. */
  name: string;
  /** Whose score would have had to move, and by how much. */
  team: string;
  delta: 1 | -1;
  /** The final score as it actually landed, for context. */
  actual: { home: number; away: number };
}

/**
 * Near misses across the season, most recent game first. Only owned blocks
 * appear — an unclaimed number missing out is not a story.
 */
export function closeCalls(
  games: PublicGame[],
  blocks: PublicBlock[],
  limit = 6,
): CloseCall[] {
  const nameOf = new Map(
    blocks
      .filter((b) => b.status === "reserved" || b.status === "assigned")
      .map((b) => [b.block_number, b.display_name] as const),
  );
  const out: CloseCall[] = [];

  for (const e of scoredEvents(games)) {
    const rows = e.game.row_digits!;
    const cols = e.game.col_digits!;
    try {
      // Not used below — this only proves the permutations are usable, so a
      // corrupt game is skipped whole rather than half-reported.
      winningBlock(rows, cols, e.home, e.away);
    } catch {
      continue;
    }

    // (home±1, away) and (home, away±1). A score cannot go below zero.
    //
    // These four can never land on the winning cell: moving a score by one
    // always changes its last digit, so no variation shares both digits
    // with the actual result. That is a property of the ±1 choice, not
    // something checked below — tests/unit/fan-stats.test.ts pins it, so a
    // wider variation set (±10, say) would fail rather than quietly list
    // the winner as its own near miss.
    type Variation = {
      home: number;
      away: number;
      team: string;
      delta: 1 | -1;
    };
    const variations: Variation[] = (
      [
        { home: e.home + 1, away: e.away, team: e.game.home_team, delta: 1 },
        { home: e.home - 1, away: e.away, team: e.game.home_team, delta: -1 },
        { home: e.home, away: e.away + 1, team: e.game.away_team, delta: 1 },
        { home: e.home, away: e.away - 1, team: e.game.away_team, delta: -1 },
      ] satisfies Variation[]
    ).filter((v) => v.home >= 0 && v.away >= 0);

    const seen = new Set<number>();
    for (const v of variations) {
      let block: number;
      try {
        block = winningBlock(rows, cols, v.home, v.away);
      } catch {
        continue;
      }
      if (seen.has(block)) continue; // two routes to the same block
      const name = nameOf.get(block);
      if (name === undefined || name === null) continue; // unowned
      seen.add(block);
      out.push({
        gameNo: e.game.game_no,
        holidayLabel: e.game.holiday_label,
        payoutType: e.payoutType,
        blockNumber: block,
        name,
        team: v.team,
        delta: v.delta,
        actual: { home: e.home, away: e.away },
      });
    }
  }

  // Most recent first, finals before halftimes within a game.
  out.sort(
    (a, b) =>
      b.gameNo - a.gameNo ||
      (a.payoutType === b.payoutType ? 0 : a.payoutType === "final" ? -1 : 1) ||
      a.blockNumber - b.blockNumber,
  );
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Hot cells: the score patterns that keep coming up.
//
// A digit PAIR, not a block — the digits are redrawn every game, so "home 7,
// away 0" is the thing that recurs, and it lands on a different block each
// week.
// ---------------------------------------------------------------------------

export interface HotCell {
  homeDigit: number;
  awayDigit: number;
  hits: number;
}

export function hotCells(games: PublicGame[], limit = 5): HotCell[] {
  const tally = new Map<string, HotCell>();
  for (const e of scoredEvents(games)) {
    const homeDigit = lastDigit(e.home);
    const awayDigit = lastDigit(e.away);
    const key = `${homeDigit}-${awayDigit}`;
    const cur = tally.get(key);
    if (cur) cur.hits++;
    else tally.set(key, { homeDigit, awayDigit, hits: 1 });
  }
  return [...tally.values()]
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        a.homeDigit - b.homeDigit ||
        a.awayDigit - b.awayDigit,
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// The next holiday game. Holidays pay more, which is worth knowing in
// advance — and unlike everything else here it has real content pre-season.
// ---------------------------------------------------------------------------

export interface HolidayNext {
  game: PublicGame;
  /** Extra a final pays on this game versus a regular week, in cents. */
  finalPremiumCents: number;
  /** How many holiday games are still ahead, including this one. */
  remaining: number;
}

export function nextHolidayGame(
  games: PublicGame[],
  config: Pick<
    PoolConfig,
    "holiday_final_cents" | "regular_final_cents"
  >,
  nowMs: number,
): HolidayNext | null {
  const ahead = games
    .filter(
      (g) =>
        g.game_type === "holiday" &&
        g.status !== "final" &&
        g.status !== "void" &&
        g.kickoff_at !== null &&
        new Date(g.kickoff_at).getTime() > nowMs,
    )
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
  const game = ahead[0];
  if (!game) return null;
  return {
    game,
    finalPremiumCents: Math.max(
      0,
      config.holiday_final_cents - config.regular_final_cents,
    ),
    remaining: ahead.length,
  };
}

// ---------------------------------------------------------------------------
// Repeat winners, for the season recap. Public because winners are public.
// ---------------------------------------------------------------------------

export interface RepeatWinner {
  name: string;
  wins: number;
}

/**
 * Anyone who has won more than once, most wins first. Names come from the
 * payout's own display name, which is the name on the block that hit.
 */
export function repeatWinners(
  payouts: { display_name: string | null; block_number: number }[],
  limit = 5,
): RepeatWinner[] {
  const tally = new Map<string, number>();
  for (const p of payouts) {
    const name = p.display_name ?? `Block ${p.block_number}`;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  return [...tally.entries()]
    .filter(([, wins]) => wins > 1)
    .map(([name, wins]) => ({ name, wins }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, limit);
}
