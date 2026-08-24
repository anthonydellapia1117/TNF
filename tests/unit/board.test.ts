import { describe, expect, it } from "vitest";
import { boardCounts, isBoardShowMode } from "@/lib/board-filter";
import { committedBlocks, placedBlocks } from "@/lib/pool";

describe("board filter counts (spec B1)", () => {
  const blocks = [
    ...Array.from({ length: 71 }, () => ({ status: "available" as const })),
    ...Array.from({ length: 27 }, () => ({ status: "reserved" as const })),
    ...Array.from({ length: 2 }, () => ({ status: "assigned" as const })),
  ];

  it("returns the live counts for open / claimed / all", () => {
    expect(boardCounts(blocks)).toEqual({ open: 71, claimed: 29, all: 100 });
  });

  it("counts held blocks only toward ALL", () => {
    const withHeld = [
      ...Array.from({ length: 70 }, () => ({ status: "available" as const })),
      ...Array.from({ length: 27 }, () => ({ status: "reserved" as const })),
      ...Array.from({ length: 2 }, () => ({ status: "assigned" as const })),
      { status: "held" as const },
    ];
    expect(boardCounts(withHeld)).toEqual({ open: 70, claimed: 29, all: 100 });
  });

  it("validates the show modes", () => {
    expect(isBoardShowMode("open")).toBe(true);
    expect(isBoardShowMode("claimed")).toBe(true);
    expect(isBoardShowMode("all")).toBe(true);
    expect(isBoardShowMode("everything")).toBe(false);
    expect(isBoardShowMode(null)).toBe(false);
  });
});

describe("committed vs placed are computed independently (spec G1)", () => {
  it("committed comes from money, placed from the grid — they can differ", () => {
    // 30 blocks' worth of commitments, but only 29 numbers on the grid:
    // someone committed without picking a spot yet.
    const pot = { reserved: 27, assigned: 2 };
    expect(committedBlocks(1_500_000, 50_000)).toBe(30);
    expect(placedBlocks(pot)).toBe(29);
    expect(committedBlocks(1_500_000, 50_000)).not.toBe(placedBlocks(pot));
  });

  it("handles the degenerate price", () => {
    expect(committedBlocks(1_000_000, 0)).toBe(0);
  });
});
