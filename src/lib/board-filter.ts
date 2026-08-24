// Pure logic for the OPEN / CLAIMED / ALL board filter (spec B1) — kept
// free of JSX so the unit tests exercise exactly what the toggle uses.

import type { PublicBlock } from "@/lib/types";

export type BoardShowMode = "open" | "claimed" | "all";
export const BOARD_SHOW_KEY = "tnf-board-show";

export function isBoardShowMode(v: unknown): v is BoardShowMode {
  return v === "open" || v === "claimed" || v === "all";
}

export interface BoardCounts {
  open: number;
  claimed: number;
  all: number;
}

/** Live counts for the toggle chips. Held blocks count only toward ALL. */
export function boardCounts(blocks: Pick<PublicBlock, "status">[]): BoardCounts {
  let open = 0;
  let claimed = 0;
  for (const b of blocks) {
    if (b.status === "available") open++;
    else if (b.status === "reserved" || b.status === "assigned") claimed++;
  }
  return { open, claimed, all: blocks.length };
}
