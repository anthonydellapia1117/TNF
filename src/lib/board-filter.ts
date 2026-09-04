// Pure logic for the Open / Taken / All board filter (spec B1), kept free
// of JSX so the unit tests exercise exactly what the toggle uses.
//
// "Taken" is a placement word, not a collection one. Paid versus unpaid is
// the admin's tracker and never reaches this board (CLAUDE.md, Public
// surfaces).

import type { PublicBlock } from "@/lib/types";

export type BoardShowMode = "open" | "taken" | "all";
export const BOARD_SHOW_KEY = "tnf-board-show";

export function isBoardShowMode(v: unknown): v is BoardShowMode {
  return v === "open" || v === "taken" || v === "all";
}

export interface BoardCounts {
  open: number;
  taken: number;
  all: number;
}

/** Live counts for the toggle chips. Held blocks count only toward ALL. */
export function boardCounts(blocks: Pick<PublicBlock, "status">[]): BoardCounts {
  let open = 0;
  let taken = 0;
  for (const b of blocks) {
    if (b.status === "available") open++;
    else if (b.status === "reserved" || b.status === "assigned") taken++;
  }
  return { open, taken, all: blocks.length };
}
