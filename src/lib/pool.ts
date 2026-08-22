// Pure pool logic, mirrored 1:1 from the database functions. Every rule here
// is locked by spec section 3 and covered in tests/unit/pool.test.ts.

import type { GameType, PoolConfig, PublicGame } from "@/lib/types";

/** Every digit 0-9 exactly once. */
export function isPermutation(arr: unknown): arr is number[] {
  return (
    Array.isArray(arr) &&
    arr.length === 10 &&
    [...arr].sort((a, b) => a - b).every((d, i) => d === i)
  );
}

export function lastDigit(score: number): number {
  return ((score % 10) + 10) % 10;
}

/**
 * The winning block: row index of the HOME last digit, column index of the
 * AWAY last digit (0-based), block = row*10 + col + 1.
 */
export function winningBlock(
  rowDigits: number[],
  colDigits: number[],
  home: number,
  away: number,
): number {
  const rowIdx = rowDigits.indexOf(lastDigit(home));
  const colIdx = colDigits.indexOf(lastDigit(away));
  if (rowIdx < 0 || colIdx < 0) {
    throw new Error("digits are not a full permutation");
  }
  return rowIdx * 10 + colIdx + 1;
}

/** Block n (1-100) → 0-based grid position. Row-major: block 1 is (0,0). */
export function blockPosition(n: number): { row: number; col: number } {
  return { row: Math.floor((n - 1) / 10), col: (n - 1) % 10 };
}

/** A block's digits for one game, or null before the digits publish. */
export function blockDigits(
  n: number,
  rowDigits: number[] | null,
  colDigits: number[] | null,
): { home: number; away: number } | null {
  if (!isPermutation(rowDigits) || !isPermutation(colDigits)) return null;
  const { row, col } = blockPosition(n);
  return { home: rowDigits[row], away: colDigits[col] };
}

export function payoutCents(
  gameType: GameType,
  payoutType: "halftime" | "final",
  config: PoolConfig,
): number {
  if (gameType === "holiday") {
    return payoutType === "halftime"
      ? config.holiday_halftime_cents
      : config.holiday_final_cents;
  }
  return payoutType === "halftime"
    ? config.regular_halftime_cents
    : config.regular_final_cents;
}

/** Season total across all games. Must equal exactly $44,250 (spec 6.2). */
export function seasonPayoutTotalCents(
  games: Pick<PublicGame, "game_type">[],
  config: PoolConfig,
): number {
  return games.reduce(
    (sum, g) =>
      sum +
      payoutCents(g.game_type, "halftime", config) +
      payoutCents(g.game_type, "final", config),
    0,
  );
}

/** The eight cells adjacent to a block, for the near-miss wash. */
export function adjacentBlocks(n: number): number[] {
  const { row, col } = blockPosition(n);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < 10 && c >= 0 && c < 10) out.push(r * 10 + c + 1);
    }
  }
  return out;
}

export const WINNER_PAYMENT_LINE = "I'll get you paid this week - Venmo or cash.";

/** The group-chat winner message. Contains exactly the required payment line. */
export function winnerMessage(opts: {
  gameNo: number;
  payoutType: "halftime" | "final";
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
  blockNumber: number;
  winnerName: string;
  amountCents: number;
}): string {
  const label = opts.payoutType === "halftime" ? "Halftime" : "Final";
  const amount = `$${(opts.amountCents / 100).toLocaleString("en-US")}`;
  return [
    `${gameCode(opts.gameNo)} ${label}: ${opts.awayTeam} ${opts.awayScore} at ${opts.homeTeam} ${opts.homeScore}.`,
    `Block ${opts.blockNumber} hits — ${opts.winnerName} wins ${amount}.`,
    WINNER_PAYMENT_LINE,
  ].join("\n");
}

export function gameCode(gameNo: number): string {
  return `G${String(gameNo).padStart(2, "0")}`;
}

/**
 * The group-chat list export (spec 4.7): plain text, no markdown. One
 * numbered line per block; a participant with two blocks appears twice;
 * `- #N` only when a block number is chosen.
 */
export function buildListExport(
  year: number,
  entries: { name: string; blockNumber: number | null }[],
): string {
  const lines = [
    `1622 ${year} TNF Block Pool List`,
    "",
    "Update the list. If multiple entries, put multiple times please. Thank you.",
    "",
    ...entries.map(
      (e, i) =>
        `${i + 1}. ${e.name}${e.blockNumber != null ? ` - #${e.blockNumber}` : ""}`,
    ),
  ];
  return lines.join("\n");
}

/** Echo-confirm line, away-at-home order (spec section 3). */
export function echoConfirm(
  gameNo: number,
  type: "halftime" | "final",
  awayTeam: string,
  awayScore: number,
  homeTeam: string,
  homeScore: number,
): string {
  return `Confirm ${gameCode(gameNo)} ${type}: ${awayTeam} ${awayScore} at ${homeTeam} ${homeScore}?`;
}
