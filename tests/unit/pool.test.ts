import { describe, expect, it } from "vitest";
import { claimedEntries } from "@/lib/pool";
import {
  adjacentBlocks,
  blockDigits,
  blockPosition,
  buildListExport,
  echoConfirm,
  gameCode,
  isPermutation,
  lastDigit,
  payoutCents,
  seasonPayoutTotalCents,
  winnerMessage,
  WINNER_PAYMENT_LINE,
  winningBlock,
} from "@/lib/pool";
import type { PoolConfig } from "@/lib/types";

const CONFIG: PoolConfig = {
  id: 1,
  price_per_block_cents: 50000,
  blocks_total: 100,
  regular_halftime_cents: 75000,
  regular_final_cents: 100000,
  holiday_halftime_cents: 75000,
  holiday_final_cents: 150000,
  claim_deadline: "2026-09-04",
  timezone: "America/New_York",
  season_status: "open",
  players_detail: "full",
};

describe("winningBlock", () => {
  it("returns block 13 for the H2 worked example", () => {
    // rows 3,7,1,9,0,5,2,8,4,6; cols 8,2,4,0,6,1,9,3,7,5; home 27, away 14.
    expect(
      winningBlock([3, 7, 1, 9, 0, 5, 2, 8, 4, 6], [8, 2, 4, 0, 6, 1, 9, 3, 7, 5], 27, 14),
    ).toBe(13);
  });

  it("covers the corners", () => {
    const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(winningBlock(identity, identity, 0, 0)).toBe(1);
    expect(winningBlock(identity, identity, 9, 9)).toBe(100);
    expect(winningBlock(identity, identity, 30, 7)).toBe(8);
  });

  it("uses only the last digit", () => {
    const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(winningBlock(identity, identity, 27, 14)).toBe(
      winningBlock(identity, identity, 7, 4),
    );
  });
});

describe("isPermutation", () => {
  it("accepts a full permutation", () => {
    expect(isPermutation([3, 7, 1, 9, 0, 5, 2, 8, 4, 6])).toBe(true);
  });
  it("rejects a repeated digit", () => {
    expect(isPermutation([1, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(false);
  });
  it("rejects short, long, and null inputs", () => {
    expect(isPermutation([0, 1, 2])).toBe(false);
    expect(isPermutation([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9])).toBe(false);
    expect(isPermutation(null)).toBe(false);
  });
});

describe("block geometry", () => {
  it("maps block numbers to grid positions row-major", () => {
    expect(blockPosition(1)).toEqual({ row: 0, col: 0 });
    expect(blockPosition(13)).toEqual({ row: 1, col: 2 });
    expect(blockPosition(100)).toEqual({ row: 9, col: 9 });
  });

  it("derives a block's digits for a game", () => {
    const rows = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6];
    const cols = [8, 2, 4, 0, 6, 1, 9, 3, 7, 5];
    // Block 13 = row 1, col 2 → home digit 7, away digit 4.
    expect(blockDigits(13, rows, cols)).toEqual({ home: 7, away: 4 });
    expect(blockDigits(13, null, cols)).toBeNull();
  });

  it("finds the eight neighbors and clips at edges", () => {
    expect(adjacentBlocks(13).sort((a, b) => a - b)).toEqual([2, 3, 4, 12, 14, 22, 23, 24]);
    expect(adjacentBlocks(1).sort((a, b) => a - b)).toEqual([2, 11, 12]);
    expect(adjacentBlocks(100).sort((a, b) => a - b)).toEqual([89, 90, 99]);
  });
});

describe("payouts", () => {
  it("prices regular and holiday games", () => {
    expect(payoutCents("regular", "halftime", CONFIG)).toBe(75000);
    expect(payoutCents("regular", "final", CONFIG)).toBe(100000);
    expect(payoutCents("holiday", "halftime", CONFIG)).toBe(75000);
    expect(payoutCents("holiday", "final", CONFIG)).toBe(150000);
  });

  it("sums the season to exactly $44,250", () => {
    const games = [
      ...Array.from({ length: 15 }, () => ({ game_type: "regular" as const })),
      ...Array.from({ length: 8 }, () => ({ game_type: "holiday" as const })),
    ];
    expect(seasonPayoutTotalCents(games, CONFIG)).toBe(4425000);
  });
});

describe("winner message", () => {
  it("contains exactly the required payment line", () => {
    const msg = winnerMessage({
      gameNo: 1,
      payoutType: "final",
      awayTeam: "New England Patriots",
      homeTeam: "Seattle Seahawks",
      awayScore: 14,
      homeScore: 27,
      blockNumber: 13,
      winnerName: "Breeze (Agnes)",
      amountCents: 100000,
    });
    expect(msg).toContain(WINNER_PAYMENT_LINE);
    expect(WINNER_PAYMENT_LINE).toBe("I'll get you paid this week - Venmo or cash.");
    expect(msg).toContain("$1,000");
    // Away-at-home order.
    expect(msg).toContain("New England Patriots 14 at Seattle Seahawks 27");
  });
});

describe("echo confirm", () => {
  it("restates in away-at-home order", () => {
    expect(echoConfirm(1, "final", "Patriots", 14, "Seahawks", 27)).toBe(
      "Confirm G01 final: Patriots 14 at Seahawks 27?",
    );
  });
});

describe("list export", () => {
  it("matches the group-chat format with no markdown artifacts", () => {
    const out = buildListExport(2026, [
      { name: "Rob Gambino", blockNumber: null },
      { name: "Gurt", blockNumber: null },
      { name: "Stephen Tomiselli", blockNumber: 34 },
    ]);
    expect(out).toBe(
      [
        "1622 2026 TNF Block Pool List",
        "",
        "Update the list. If multiple entries, put multiple times please. Thank you.",
        "",
        "1. Rob Gambino",
        "2. Gurt",
        "3. Stephen Tomiselli - #34",
      ].join("\n"),
    );
    expect(out).not.toMatch(/[*_`>|]/);
  });

  it("lists a two-block participant twice", () => {
    const out = buildListExport(2026, [
      { name: "Jr/Diz", blockNumber: 36 },
      { name: "Jr/Diz", blockNumber: 38 },
    ]);
    expect(out).toContain("1. Jr/Diz - #36");
    expect(out).toContain("2. Jr/Diz - #38");
  });
});

describe("labels", () => {
  it("round-trips the New Year's Eve apostrophe", () => {
    const label = "New Year's Eve";
    expect(JSON.parse(JSON.stringify({ label })).label).toBe(label);
    expect(`${label}`).toContain("'");
  });

  it("formats game codes", () => {
    expect(gameCode(1)).toBe("G01");
    expect(gameCode(23)).toBe("G23");
  });

  it("last digit handles zero and multiples of ten", () => {
    expect(lastDigit(0)).toBe(0);
    expect(lastDigit(30)).toBe(0);
    expect(lastDigit(27)).toBe(7);
  });
});

describe("claimedEntries — the public list, one row per claimed block", () => {
  const blocks = [
    { block_number: 38, status: "reserved", display_name: "Jr/Diz" },
    { block_number: 5, status: "reserved", display_name: "AAA" },
    { block_number: 36, status: "reserved", display_name: "Jr/Diz" },
    { block_number: 24, status: "available", display_name: null },
    { block_number: 15, status: "assigned", display_name: "Nicco Esgro" },
    { block_number: 3, status: "reserved", display_name: "AAA" },
    { block_number: 90, status: "held", display_name: null },
  ];

  it("sorts alias then block, includes reserved and assigned only", () => {
    expect(claimedEntries(blocks)).toEqual([
      { name: "AAA", blockNumber: 3 },
      { name: "AAA", blockNumber: 5 },
      { name: "Jr/Diz", blockNumber: 36 },
      { name: "Jr/Diz", blockNumber: 38 },
      { name: "Nicco Esgro", blockNumber: 15 },
    ]);
  });

  it("never numbers aliases apart — a two-block holder repeats verbatim", () => {
    const names = claimedEntries(blocks).map((e) => e.name);
    expect(names.filter((n) => n === "Jr/Diz")).toEqual(["Jr/Diz", "Jr/Diz"]);
    expect(names.some((n) => /Jr\/Diz.*[12]/.test(n))).toBe(false);
  });
});
