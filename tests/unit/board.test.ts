import { describe, expect, it } from "vitest";
import { boardCounts, isBoardShowMode } from "@/lib/board-filter";
import { committedBlocks, housePosition, placedBlocks } from "@/lib/pool";

describe("board filter counts (spec B1)", () => {
  const blocks = [
    ...Array.from({ length: 71 }, () => ({ status: "available" as const })),
    ...Array.from({ length: 27 }, () => ({ status: "reserved" as const })),
    ...Array.from({ length: 2 }, () => ({ status: "assigned" as const })),
  ];

  it("returns the live counts for open / taken / all", () => {
    expect(boardCounts(blocks)).toEqual({ open: 71, taken: 29, all: 100 });
  });

  it("counts held blocks only toward ALL", () => {
    const withHeld = [
      ...Array.from({ length: 70 }, () => ({ status: "available" as const })),
      ...Array.from({ length: 27 }, () => ({ status: "reserved" as const })),
      ...Array.from({ length: 2 }, () => ({ status: "assigned" as const })),
      { status: "held" as const },
    ];
    expect(boardCounts(withHeld)).toEqual({ open: 70, taken: 29, all: 100 });
  });

  it("validates the show modes", () => {
    expect(isBoardShowMode("open")).toBe(true);
    expect(isBoardShowMode("taken")).toBe(true);
    expect(isBoardShowMode("all")).toBe(true);
    // The pre-2026-09-04 value. A remembered choice from an old visit falls
    // back to ALL instead of resurrecting the collection word.
    expect(isBoardShowMode("claimed")).toBe(false);
    expect(isBoardShowMode("everything")).toBe(false);
    expect(isBoardShowMode(null)).toBe(false);
  });
});

describe("committed vs placed are computed independently (spec G1)", () => {
  it("committed is a real count, placed comes from the grid — they can differ", () => {
    // 30 blocks committed, but only 29 numbers on the grid: someone
    // committed without picking a spot yet.
    const pot = { reserved: 27, assigned: 2 };
    expect(committedBlocks({ committed_blocks: 30 })).toBe(30);
    expect(placedBlocks(pot)).toBe(29);
    expect(committedBlocks({ committed_blocks: 30 })).not.toBe(placedBlocks(pot));
  });

  it("counts a comped block as committed even though it owes nothing", () => {
    // The trap the count replaces: due / price reads 29 with one block
    // comped, which would have dropped it out of the committed total.
    const pot = { committed_blocks: 30 };
    const dueCents = 29 * 50_000; // one of the 30 is comped
    expect(committedBlocks(pot)).toBe(30);
    expect(dueCents / 50_000).not.toBe(committedBlocks(pot));
  });
});

describe("house position against the FIXED payout (admin only)", () => {
  const SEASON = 4_425_000; // $44,250
  const PRICE = 50_000; // $500

  it("needs 89 paying blocks to break even", () => {
    const h = housePosition(
      { collected_cents: 0, committed_blocks: 0 },
      0,
      SEASON,
      PRICE,
    );
    expect(h.payingBlocksNeeded).toBe(89); // ceil(44250 / 500)
    expect(h.blocksToBreakEven).toBe(89);
    expect(h.positionCents).toBe(-SEASON);
  });

  it("excludes comped blocks from the paying count", () => {
    const h = housePosition(
      { collected_cents: 1_500_000, committed_blocks: 31 },
      1,
      SEASON,
      PRICE,
    );
    expect(h.payingBlocksSold).toBe(30);
    expect(h.blocksToBreakEven).toBe(59);
    expect(h.positionCents).toBe(1_500_000 - SEASON);
  });

  it("goes positive and clamps to zero once break-even is cleared", () => {
    const h = housePosition(
      { collected_cents: 5_000_000, committed_blocks: 100 },
      1,
      SEASON,
      PRICE,
    );
    expect(h.positionCents).toBe(5_000_000 - SEASON);
    expect(h.positionCents).toBeGreaterThan(0);
    expect(h.blocksToBreakEven).toBe(0);
  });

  it("handles the degenerate price without dividing by zero", () => {
    const h = housePosition(
      { collected_cents: 0, committed_blocks: 0 },
      0,
      SEASON,
      0,
    );
    expect(h.payingBlocksNeeded).toBe(0);
    expect(h.blocksToBreakEven).toBe(0);
  });
});
