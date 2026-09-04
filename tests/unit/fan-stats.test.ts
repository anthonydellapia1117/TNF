import { describe, expect, it } from "vitest";
import {
  closeCalls,
  digitReport,
  hotCells,
  nextHolidayGame,
  repeatWinners,
  scoredEvents,
} from "@/lib/fan-stats";
import { winningBlock } from "@/lib/pool";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

// Identity permutations keep the arithmetic legible: with rows = cols =
// [0..9], the block for (home, away) is homeDigit * 10 + awayDigit + 1.
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function game(over: Partial<PublicGame> & { game_no: number }): PublicGame {
  return {
    id: `g-${over.game_no}`,
    week: over.game_no,
    kickoff_at: "2026-09-10T00:20:00Z",
    date_confirmed: true,
    game_type: "regular",
    holiday_label: null,
    home_team: "Seattle Seahawks",
    away_team: "New England Patriots",
    network: null,
    row_digits: ROWS,
    col_digits: COLS,
    digits_assigned: true,
    digits_reveal_at: null,
    digits_published_at: "2026-09-09T12:00:00Z",
    live_home: null,
    live_away: null,
    live_updated_at: null,
    halftime_home: null,
    halftime_away: null,
    halftime_block: null,
    halftime_scored_at: null,
    final_home: null,
    final_away: null,
    final_block: null,
    final_scored_at: null,
    status: "final",
    ...over,
  };
}

function block(n: number, name: string | null): PublicBlock {
  return {
    block_number: n,
    status: name === null ? "available" : "assigned",
    display_name: name,
    owner_group: null,
    participant_id: name === null ? null : `p-${n}`,
    assignment_method: null,
  };
}

const CONFIG = {
  holiday_final_cents: 150000,
  regular_final_cents: 100000,
} as Pick<PoolConfig, "holiday_final_cents" | "regular_final_cents">;

describe("scoredEvents", () => {
  it("is empty pre-season — no scores, nothing to say", () => {
    expect(scoredEvents([game({ game_no: 1, status: "scheduled" })])).toEqual([]);
  });

  it("picks up halftime and final separately, oldest game first", () => {
    const events = scoredEvents([
      game({ game_no: 2, halftime_home: 7, halftime_away: 3, final_home: 24, final_away: 17 }),
      game({ game_no: 1, final_home: 10, final_away: 0 }),
    ]);
    expect(events.map((e) => `${e.game.game_no}:${e.payoutType}`)).toEqual([
      "1:final",
      "2:halftime",
      "2:final",
    ]);
  });

  it("skips a game whose digits have not been revealed", () => {
    // The public projection withholds digits until the reveal, so there is
    // no cell to reason about even though the score is in.
    const g = game({
      game_no: 1,
      row_digits: null,
      col_digits: null,
      final_home: 24,
      final_away: 17,
    });
    expect(scoredEvents([g])).toEqual([]);
  });

  it("skips a void game", () => {
    const g = game({ game_no: 1, status: "void", final_home: 24, final_away: 17 });
    expect(scoredEvents([g])).toEqual([]);
  });
});

describe("digitReport", () => {
  it("reports every digit as never-won pre-season, and no hottest", () => {
    const r = digitReport([game({ game_no: 1, status: "scheduled" })]);
    expect(r.totalEvents).toBe(0);
    expect(r.neverWon).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.hottest).toEqual([]);
  });

  it("counts both scores of every event", () => {
    const r = digitReport([
      game({ game_no: 1, halftime_home: 7, halftime_away: 3, final_home: 24, final_away: 17 }),
    ]);
    // 7 and 3 at halftime; 4 and 7 at the final. 7 twice.
    expect(r.counts[7]).toBe(2);
    expect(r.counts[3]).toBe(1);
    expect(r.counts[4]).toBe(1);
    expect(r.totalEvents).toBe(2);
    expect(r.hottest).toEqual([7]);
    expect(r.neverWon).toEqual([0, 1, 2, 5, 6, 8, 9]);
  });

  it("reports every digit tied for hottest, ascending", () => {
    const r = digitReport([game({ game_no: 1, final_home: 3, final_away: 8 })]);
    expect(r.hottest).toEqual([3, 8]);
  });

  it("takes the last digit, not the score", () => {
    const r = digitReport([game({ game_no: 1, final_home: 34, final_away: 20 })]);
    expect(r.counts[4]).toBe(1);
    expect(r.counts[0]).toBe(1);
    expect(r.counts[34 % 10]).toBe(1);
  });
});

describe("closeCalls", () => {
  // AWAY is the row axis, HOME the column axis (see winningBlock). With both
  // permutations the identity, block = awayDigit*10 + homeDigit + 1.
  // Final 24-17 → away digit 7, home digit 4 → 7*10+4+1 = 75. The old
  // orientation put this at 48.
  const G = game({ game_no: 1, final_home: 24, final_away: 17 });

  it("finds the four one-point-away blocks", () => {
    expect(winningBlock(ROWS, COLS, 24, 17)).toBe(75);
    // home 25 → 76, home 23 → 74, away 18 → 85, away 16 → 65
    const owned = [76, 74, 85, 65].map((n) => block(n, `Owner ${n}`));
    const calls = closeCalls([G], [...owned, block(75, "Winner")]);
    expect(calls.map((c) => c.blockNumber).sort((a, b) => a - b)).toEqual([
      65, 74, 76, 85,
    ]);
  });

  it("never lists the block that actually won, at any score", () => {
    // A one-point move always changes a last digit, so a near miss can never
    // be the winner itself. Checked across a spread of scores rather than
    // one lucky pair: a wider variation set (±10, say) would land on the
    // winning cell and this would catch it.
    const owned = Array.from({ length: 100 }, (_, i) =>
      block(i + 1, `Owner ${i + 1}`),
    );
    for (const home of [0, 3, 7, 10, 17, 24, 30, 41]) {
      for (const away of [0, 1, 6, 9, 13, 20, 27, 34]) {
        const g = game({ game_no: 1, final_home: home, final_away: away });
        const winner = winningBlock(ROWS, COLS, home, away);
        const calls = closeCalls([g], owned, 99);
        expect(calls.map((c) => c.blockNumber)).not.toContain(winner);
        expect(calls.length).toBeGreaterThan(0);
      }
    }
  });

  it("skips unowned blocks — an open number missing out is not a story", () => {
    const calls = closeCalls([G], [block(76, null), block(74, "Rob")]);
    expect(calls.map((c) => c.blockNumber)).toEqual([74]);
  });

  it("names the team and the direction the score had to move", () => {
    // Block 76 is the home-plus-one variation: home 25, away 17.
    const calls = closeCalls([G], [block(76, "Rob")]);
    expect(calls[0].team).toBe("Seattle Seahawks"); // home
    expect(calls[0].delta).toBe(1); // 24 → 25
    expect(calls[0].actual).toEqual({ home: 24, away: 17 });
  });

  it("does not invent a negative score", () => {
    // Away 0: there is no away −1, so only three variations exist.
    const g = game({ game_no: 1, final_home: 24, final_away: 0 });
    const winner = winningBlock(ROWS, COLS, 24, 0); // 5
    const owned = Array.from({ length: 100 }, (_, i) =>
      block(i + 1, `Owner ${i + 1}`),
    );
    const calls = closeCalls([g], owned, 99);
    expect(calls.map((c) => c.blockNumber)).not.toContain(winner);
    // home 25 → 6, home 23 → 4, away 1 → 15. Three, not four.
    expect(calls.map((c) => c.blockNumber).sort((a, b) => a - b)).toEqual([
      4, 6, 15,
    ]);
  });

  it("is empty pre-season", () => {
    expect(
      closeCalls([game({ game_no: 1, status: "scheduled" })], [block(1, "Rob")]),
    ).toEqual([]);
  });

  it("puts the most recent game first, finals before halftimes", () => {
    const owned = Array.from({ length: 100 }, (_, i) =>
      block(i + 1, `Owner ${i + 1}`),
    );
    const calls = closeCalls(
      [
        game({ game_no: 1, final_home: 24, final_away: 17 }),
        game({ game_no: 2, halftime_home: 7, halftime_away: 3, final_home: 10, final_away: 6 }),
      ],
      owned,
      99,
    );
    expect(calls[0].gameNo).toBe(2);
    expect(calls[0].payoutType).toBe("final");
    expect(calls[calls.length - 1].gameNo).toBe(1);
  });

  it("honours the limit", () => {
    const owned = Array.from({ length: 100 }, (_, i) =>
      block(i + 1, `Owner ${i + 1}`),
    );
    expect(closeCalls([G], owned, 2)).toHaveLength(2);
  });
});

describe("hotCells", () => {
  it("is empty pre-season", () => {
    expect(hotCells([game({ game_no: 1, status: "scheduled" })])).toEqual([]);
  });

  it("counts digit pairs, not blocks — digits are redrawn every game", () => {
    // Same 4-7 pair twice, through different permutations.
    const shifted = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const cells = hotCells([
      game({ game_no: 1, final_home: 24, final_away: 17 }),
      game({ game_no: 2, final_home: 34, final_away: 27, row_digits: shifted, col_digits: shifted }),
    ]);
    expect(cells[0]).toEqual({ homeDigit: 4, awayDigit: 7, hits: 2 });
  });

  it("orders by hits, then by digit pair", () => {
    const cells = hotCells([
      game({ game_no: 1, final_home: 3, final_away: 1 }),
      game({ game_no: 2, final_home: 3, final_away: 1 }),
      game({ game_no: 3, final_home: 7, final_away: 0 }),
      game({ game_no: 4, final_home: 1, final_away: 2 }),
    ]);
    expect(cells.map((c) => `${c.homeDigit}-${c.awayDigit}:${c.hits}`)).toEqual([
      "3-1:2",
      "1-2:1",
      "7-0:1",
    ]);
  });

  it("keeps home and away distinct — 7-0 is not 0-7", () => {
    const cells = hotCells([
      game({ game_no: 1, final_home: 7, final_away: 0 }),
      game({ game_no: 2, final_home: 0, final_away: 7 }),
    ]);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.hits === 1)).toBe(true);
  });
});

describe("nextHolidayGame", () => {
  const NOW = new Date("2026-09-03T12:00:00Z").getTime();

  it("finds the soonest holiday game ahead and its premium", () => {
    const r = nextHolidayGame(
      [
        game({ game_no: 1, status: "scheduled", kickoff_at: "2026-09-10T00:20:00Z" }),
        game({
          game_no: 13,
          status: "scheduled",
          game_type: "holiday",
          holiday_label: "Thanksgiving",
          kickoff_at: "2026-11-26T18:00:00Z",
        }),
        game({
          game_no: 20,
          status: "scheduled",
          game_type: "holiday",
          holiday_label: "Christmas Day",
          kickoff_at: "2026-12-25T18:00:00Z",
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(r?.game.game_no).toBe(13);
    expect(r?.finalPremiumCents).toBe(50000); // $1,500 vs $1,000
    expect(r?.remaining).toBe(2);
  });

  it("skips a holiday game already played or voided", () => {
    const r = nextHolidayGame(
      [
        game({
          game_no: 13,
          status: "final",
          game_type: "holiday",
          kickoff_at: "2026-11-26T18:00:00Z",
        }),
        game({
          game_no: 20,
          status: "void",
          game_type: "holiday",
          kickoff_at: "2026-12-25T18:00:00Z",
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(r).toBeNull();
  });

  it("returns null once every holiday game is behind us", () => {
    const r = nextHolidayGame(
      [
        game({
          game_no: 13,
          status: "scheduled",
          game_type: "holiday",
          kickoff_at: "2026-11-26T18:00:00Z",
        }),
      ],
      CONFIG,
      new Date("2026-12-31T00:00:00Z").getTime(),
    );
    expect(r).toBeNull();
  });

  it("never reports a negative premium", () => {
    const r = nextHolidayGame(
      [
        game({
          game_no: 13,
          status: "scheduled",
          game_type: "holiday",
          kickoff_at: "2026-11-26T18:00:00Z",
        }),
      ],
      { holiday_final_cents: 90000, regular_final_cents: 100000 },
      NOW,
    );
    expect(r?.finalPremiumCents).toBe(0);
  });
});

describe("repeatWinners", () => {
  const p = (name: string | null, block_number = 1) => ({
    display_name: name,
    block_number,
  });

  it("is empty pre-season", () => {
    expect(repeatWinners([])).toEqual([]);
  });

  it("lists only names with more than one win", () => {
    expect(
      repeatWinners([p("Rob"), p("Rob"), p("Sal"), p("Nicco"), p("Nicco"), p("Nicco")]),
    ).toEqual([
      { name: "Nicco", wins: 3 },
      { name: "Rob", wins: 2 },
    ]);
  });

  it("falls back to the block number when a payout has no name", () => {
    expect(repeatWinners([p(null, 41), p(null, 41)])).toEqual([
      { name: "Block 41", wins: 2 },
    ]);
  });

  it("breaks a tie alphabetically", () => {
    expect(repeatWinners([p("Zed"), p("Zed"), p("Abe"), p("Abe")])).toEqual([
      { name: "Abe", wins: 2 },
      { name: "Zed", wins: 2 },
    ]);
  });
});
