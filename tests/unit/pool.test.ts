import { describe, expect, it } from "vitest";
import { amountBadge, claimedEntries } from "@/lib/pool";
import {
  adjacentBlocks,
  blockDigits,
  blockPosition,
  buildListExport,
  echoConfirm,
  gameCode,
  gridAxes,
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
  season_mode: false,
};

describe("winningBlock", () => {
  // AWAY selects the row, HOME selects the column — the orientation of the
  // hand-built 2025 grid. Reversed 2026-09-04; see src/lib/pool.ts.
  const ROWS = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6]; // away axis, down the side
  const COLS = [8, 2, 4, 0, 6, 1, 9, 3, 7, 5]; // home axis, across the top

  it("returns block 89 for the worked example", () => {
    // home 27 -> digit 7, away 14 -> digit 4.
    // row = position of AWAY 4 in rows = 8; col = position of HOME 7 in cols = 8.
    expect(winningBlock(ROWS, COLS, 27, 14)).toBe(8 * 10 + 8 + 1);
    expect(winningBlock(ROWS, COLS, 27, 14)).toBe(89);
  });

  it("is NOT the transposed reading — 89, never 13", () => {
    // This is the whole point of the 2026-09-04 reversal. Under the old
    // orientation (home selects the row) these same inputs gave 13. If this
    // ever returns 13 again someone has flipped the axes back and every
    // payout is going to the wrong person.
    expect(winningBlock(ROWS, COLS, 27, 14)).not.toBe(13);
  });

  it("is asymmetric in home and away, so the axes cannot be swapped silently", () => {
    // With two DIFFERENT permutations, swapping the scores must change the
    // answer. A test using one array for both axes passes under either
    // orientation and proves nothing about which team is on which axis.
    expect(winningBlock(ROWS, COLS, 27, 14)).not.toBe(
      winningBlock(ROWS, COLS, 14, 27),
    );
  });

  it("puts the away digit on the row and the home digit on the column", () => {
    // Stated directly rather than through a worked example, so the intent
    // survives even if the example numbers are ever edited.
    for (const [home, away] of [
      [3, 8],
      [27, 14],
      [10, 25],
      [46, 46],
    ]) {
      const expectedRow = ROWS.indexOf(away % 10);
      const expectedCol = COLS.indexOf(home % 10);
      expect(winningBlock(ROWS, COLS, home, away)).toBe(
        expectedRow * 10 + expectedCol + 1,
      );
    }
  });

  it("covers the corners", () => {
    const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(winningBlock(identity, identity, 0, 0)).toBe(1);
    expect(winningBlock(identity, identity, 9, 9)).toBe(100);
    // Orientation-sensitive even on the identity permutation: away 7 is the
    // row, home 0 the column. The old orientation gave 8.
    expect(winningBlock(identity, identity, 30, 7)).toBe(71);
  });

  it("uses only the last digit", () => {
    // Orientation-neutral by design: this asserts the mod-10 reduction, not
    // which axis is which. The tests above carry the orientation.
    const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(winningBlock(identity, identity, 27, 14)).toBe(
      winningBlock(identity, identity, 7, 4),
    );
  });
});

describe("gridAxes — what the screen says must match what pays", () => {
  const GAME = { home_team: "Seattle Seahawks", away_team: "New England Patriots" };

  it("puts AWAY on the row axis and HOME on the column axis", () => {
    expect(gridAxes(GAME)).toEqual({
      rowLabel: "away",
      rowTeam: "New England Patriots",
      colLabel: "home",
      colTeam: "Seattle Seahawks",
    });
  });

  it("never labels both axes the same team", () => {
    const a = gridAxes(GAME);
    expect(a.rowLabel).not.toBe(a.colLabel);
    expect(a.rowTeam).not.toBe(a.colTeam);
  });

  it("agrees with winningBlock about which score drives the row", () => {
    // The real invariant: the digit array drawn down the SIDE must be the one
    // winningBlock indexes with the row-axis team's score. Build a score where
    // the two teams' last digits differ, and check the block winningBlock
    // returns sits at the row the axis labelling predicts.
    const rows = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6];
    const cols = [8, 2, 4, 0, 6, 1, 9, 3, 7, 5];
    const scores = { home: 27, away: 14 };
    const axes = gridAxes(GAME);

    const rowScore = axes.rowLabel === "away" ? scores.away : scores.home;
    const colScore = axes.colLabel === "home" ? scores.home : scores.away;

    const block = winningBlock(rows, cols, scores.home, scores.away);
    const { row, col } = blockPosition(block);
    expect(rows[row]).toBe(rowScore % 10);
    expect(cols[col]).toBe(colScore % 10);
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
    const rows = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6]; // away axis
    const cols = [8, 2, 4, 0, 6, 1, 9, 3, 7, 5]; // home axis
    // Block 13 = row 1, col 2 → away digit rows[1]=7, home digit cols[2]=4.
    // Transposed from the pre-2026-09-04 reading, which had home 7 / away 4.
    expect(blockDigits(13, rows, cols)).toEqual({ away: 7, home: 4 });
    expect(blockDigits(13, null, cols)).toBeNull();
  });

  it("agrees with winningBlock: a block's own digits win it", () => {
    // The two functions are inverses. If one is flipped and the other is
    // not, this fails — which is the failure mode that would pay the wrong
    // person while every screen still looked coherent.
    const rows = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6];
    const cols = [8, 2, 4, 0, 6, 1, 9, 3, 7, 5];
    for (const n of [1, 13, 47, 89, 100]) {
      const d = blockDigits(n, rows, cols)!;
      expect(winningBlock(rows, cols, d.home, d.away)).toBe(n);
    }
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

describe("amountBadge — grid-density prize labels", () => {
  it("abbreviates exactly as specified", () => {
    expect(amountBadge(75000)).toBe("$750");
    expect(amountBadge(100000)).toBe("$1K");
    expect(amountBadge(150000)).toBe("$1.5K");
    expect(amountBadge(200000)).toBe("$2K");
  });
});
