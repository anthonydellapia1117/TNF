// The game-day email's grid picture (Anthony, 2026-11-25, Part R): the
// Comfortable view of one game's grid, a name in every block, the published
// digits on both axes. Rendered server-side from the public projections
// (src/app/api/grid-image/route.tsx), so the picture and the live /grid?g=N
// read the same rows and the same names. This module is the data half, pure
// so the tests can say what the picture must contain: 100 blocks, each with
// its number and the name the board shows, and the digits as published.

import { blockPosition, gridAxes, isPermutation } from "@/lib/pool";
import type { PublicBlock, PublicGame } from "@/lib/types";

export interface GridImageCell {
  n: number;
  /** The name the board shows, null for an open block. */
  name: string | null;
  row: number;
  col: number;
}

export interface GridImageModel {
  gameNo: number;
  /** "G02" */
  code: string;
  /** Vertical axis: the AWAY team and its row digits, down the left side. */
  rowTeam: string;
  rowDigits: number[];
  /** Horizontal axis: the HOME team and its column digits, across the top. */
  colTeam: string;
  colDigits: number[];
  /** All 100 blocks, row-major, block 1 first. */
  cells: GridImageCell[];
}

export function gameCode(n: number): string {
  return `G${String(n).padStart(2, "0")}`;
}

/**
 * The picture for one game. Refuses a game whose digits are not published: a
 * grid with question marks must never ride in an email that states numbers.
 */
export function gridImageModel(game: PublicGame, blocks: readonly PublicBlock[]): GridImageModel {
  if (!game.digits_published_at || !isPermutation(game.row_digits) || !isPermutation(game.col_digits)) {
    throw new Error(`${gameCode(game.game_no)}: the digits are not published, so there is no grid picture`);
  }
  const byNumber = new Map(blocks.map((b) => [b.block_number, b]));
  const cells: GridImageCell[] = [];
  for (let n = 1; n <= 100; n++) {
    const b = byNumber.get(n);
    const { row, col } = blockPosition(n);
    const name = b?.display_name?.trim() ? b.display_name.trim() : null;
    cells.push({ n, name, row, col });
  }
  const axes = gridAxes(game);
  return {
    gameNo: game.game_no,
    code: gameCode(game.game_no),
    rowTeam: axes.rowTeam,
    rowDigits: game.row_digits,
    colTeam: axes.colTeam,
    colDigits: game.col_digits,
    cells,
  };
}
