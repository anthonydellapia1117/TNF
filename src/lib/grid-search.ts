// The /grid name search and the game /grid opens on (Anthony, 2026-11-24,
// Part Q). Pure, so the rules are unit-tested apart from the screen.
//
// The search reads only the name the board already shows for a block
// (v_public_blocks.display_name). A holder's full name, address or anything
// else that is not on the board is never searched, so it cannot be found by
// guessing at it.

import { blockDigits } from "@/lib/pool";
import type { PublicGame } from "@/lib/types";

/** The query as it is compared: trimmed, lower case. "" means no search. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

/**
 * Blocks whose shown name contains the query, any case, in block order. An
 * empty query matches nothing: a cleared search highlights no block.
 */
export function matchBlocks(
  blocks: ReadonlyArray<{ block_number: number; display_name: string | null }>,
  query: string,
): number[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return blocks
    .filter((b) => (b.display_name ?? "").toLowerCase().includes(q))
    .map((b) => b.block_number)
    .sort((a, b) => a - b);
}

/** "2 blocks: 3, 23" / "1 block: 7" / "No blocks match". */
export function matchSummary(matches: readonly number[]): string {
  if (matches.length === 0) return "No blocks match";
  const noun = matches.length === 1 ? "block" : "blocks";
  return `${matches.length} ${noun}: ${matches.join(", ")}`;
}

/**
 * A matched block's digits for the game shown, away (the row) then home (the
 * column), or null before that game's digits publish.
 */
export function matchDigits(
  n: number,
  game: Pick<PublicGame, "row_digits" | "col_digits">,
): { away: number; home: number } | null {
  return blockDigits(n, game.row_digits, game.col_digits);
}

const etDate = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** A pool day ends at 4 AM ET (Part Q review). */
const DAY_ROLLOVER_MS = 4 * 60 * 60 * 1000;

const byKickoff = (a: PublicGame, b: PublicGame) =>
  (a.kickoff_at ?? "9999").localeCompare(b.kickoff_at ?? "9999");

/**
 * The game /grid opens on when no ?g= names one: a game marked in progress or
 * at halftime, else today's game in ET (the latest of today's that has kicked
 * off, or before the first kickoff, the first of them), else the next game to
 * be played, else the last game. Void games never. "Today" runs to 4 AM ET,
 * so a night game's winners stay up while its email goes out after midnight.
 *
 * Today's game goes by kickoff time, not status: the results run leaves every
 * game of a day "published" until the whole day is final (score-plan), so on
 * Thanksgiving evening a status rule would sit on G02 while G04 is played.
 */
export function defaultGridGame(
  games: readonly PublicGame[],
  nowIso: string,
  tz = "America/New_York",
): PublicGame | null {
  const live = games.filter((g) => g.status !== "void");
  if (live.length === 0) return games[0] ?? null;
  const playing = live.find(
    (g) => g.status === "in_progress" || g.status === "halftime",
  );
  if (playing) return playing;
  // A pool day runs to 4 AM ET, not midnight: the winners email for a night
  // game goes out after midnight and links the bare /grid, which must still
  // open that game.
  const today = etDate(
    new Date(Date.parse(nowIso) - DAY_ROLLOVER_MS).toISOString(),
    tz,
  );
  const todays = live
    .filter((g) => g.kickoff_at && etDate(g.kickoff_at, tz) === today)
    .sort(byKickoff);
  if (todays.length) {
    const started = todays.filter(
      (g) => Date.parse(g.kickoff_at as string) <= Date.parse(nowIso),
    );
    return started[started.length - 1] ?? todays[0];
  }
  const now = Date.parse(nowIso);
  const next = live
    .filter(
      (g) =>
        g.status !== "final" &&
        (g.kickoff_at === null || Date.parse(g.kickoff_at) >= now),
    )
    .sort(byKickoff)[0];
  if (next) return next;
  const unfinished = live
    .filter((g) => g.status !== "final")
    .sort(byKickoff)[0];
  return unfinished ?? [...live].sort(byKickoff)[live.length - 1];
}
