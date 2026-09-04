import { describe, expect, it } from "vitest";
import {
  revealCardState,
  revealTimeISO,
  seasonStory,
  seasonSummary,
} from "@/lib/next-reveal";
import type { PublicGame, PublicPayout } from "@/lib/types";

const NOW = new Date("2026-09-01T12:00:00Z").getTime();

function game(over: Partial<PublicGame>): PublicGame {
  return {
    id: over.id ?? crypto.randomUUID(),
    game_no: 1,
    week: 1,
    kickoff_at: "2026-09-10T00:20:00Z",
    date_confirmed: true,
    game_type: "regular",
    holiday_label: null,
    home_team: "Seattle Seahawks",
    away_team: "New England Patriots",
    network: null,
    row_digits: null,
    col_digits: null,
    digits_assigned: false,
    digits_published_at: null,
    digits_reveal_at: null,
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
    status: "scheduled",
    ...over,
  };
}

const ROWS = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6];
const COLS = [8, 2, 4, 0, 6, 1, 9, 3, 7, 5];

function payout(over: Partial<PublicPayout>): PublicPayout {
  return {
    id: crypto.randomUUID(),
    game_id: over.game_id ?? crypto.randomUUID(),
    payout_type: "final",
    block_number: 13,
    participant_id: null,
    display_name: "Breeze (Agnes)",
    amount_cents: 100000,
    created_at: "2026-09-11T04:00:00Z",
    ...over,
  };
}

describe("revealCardState — one card, four states", () => {
  it("before digits: NEXT REVEAL with the announced or default drop time", () => {
    const s = revealCardState([game({})], NOW);
    expect(s.kind).toBe("next_reveal");
    if (s.kind === "next_reveal") {
      // Default: 8:00 AM ET on game day (Sep 9 ET for the Sep 10 UTC kickoff).
      expect(s.revealAtISO).toBe("2026-09-09T12:00:00.000Z");
    }
  });

  it("an explicitly scheduled reveal time wins over the standing slot", () => {
    const g = game({ digits_reveal_at: "2026-09-09T16:00:00Z" });
    expect(revealTimeISO(g)).toBe("2026-09-09T16:00:00Z");
  });

  it("after digits publish, before kickoff: YOUR NUMBERS ARE LIVE", () => {
    const g = game({
      row_digits: ROWS,
      col_digits: COLS,
      digits_published_at: "2026-09-01T09:00:00Z",
      status: "published",
    });
    expect(revealCardState([g], NOW).kind).toBe("numbers_live");
  });

  it("during the game: LIVE NOW with the leading block from live scores", () => {
    const g = game({
      row_digits: ROWS,
      col_digits: COLS,
      digits_published_at: "2026-09-01T09:00:00Z",
      status: "in_progress",
      live_home: 27,
      live_away: 14,
    });
    const s = revealCardState([g], NOW);
    expect(s.kind).toBe("live_now");
    // Worked example from the spec: home 27, away 14 → block 89.
    // AWAY 4 picks the row, HOME 7 picks the column. The pre-2026-09-04
    // orientation gave 13 here; if that ever comes back, the live card is
    // naming the wrong person on screen during the game.
    if (s.kind === "live_now") expect(s.leaderBlock).toBe(89);
  });

  it("past kickoff with revealed digits counts as live even without scores", () => {
    const g = game({
      row_digits: ROWS,
      col_digits: COLS,
      digits_published_at: "2026-08-30T09:00:00Z",
      kickoff_at: "2026-09-01T00:20:00Z", // already kicked off vs NOW
      status: "published",
    });
    const s = revealCardState([g], NOW);
    expect(s.kind).toBe("live_now");
    if (s.kind === "live_now") expect(s.leaderBlock).toBeNull();
  });

  it("after a final, before the next game's digits: LAST WINNER", () => {
    const done = game({ status: "final", kickoff_at: "2026-08-27T00:20:00Z" });
    const next = game({ game_no: 2, kickoff_at: "2026-09-10T00:35:00Z" });
    const s = revealCardState([done, next], NOW);
    expect(s.kind).toBe("last_winner");
    if (s.kind === "last_winner") {
      expect(s.lastGame.id).toBe(done.id);
      expect(s.nextGame?.game_no).toBe(2);
    }
  });

  it("once the next game's digits are out, the winner card yields", () => {
    const done = game({ status: "final", kickoff_at: "2026-08-27T00:20:00Z" });
    const next = game({
      game_no: 2,
      kickoff_at: "2026-09-10T00:35:00Z",
      row_digits: ROWS,
      col_digits: COLS,
      digits_published_at: "2026-09-01T09:00:00Z",
      status: "published",
    });
    expect(revealCardState([done, next], NOW).kind).toBe("numbers_live");
  });

  it("seasonStory: pre-season points at the opener, no zeros against a total", () => {
    const s = seasonStory([game({}), game({ game_no: 2 })], []);
    expect(s.preSeason).toBe(true);
    expect(s.firstKickoffISO).toBe("2026-09-10T00:20:00Z");
  });

  it("seasonStory: the story rows — played, paid, biggest, most wins", () => {
    const g1 = game({ status: "final" });
    const g13 = game({
      game_no: 13,
      status: "final",
      game_type: "holiday",
      holiday_label: "Thanksgiving",
      kickoff_at: "2026-11-26T18:00:00Z",
    });
    const open = game({ game_no: 14 });
    const s = seasonStory(
      [g1, g13, open],
      [
        payout({ game_id: g1.id, amount_cents: 100000, display_name: "Breeze" }),
        payout({ game_id: g1.id, payout_type: "halftime", amount_cents: 75000, display_name: "Breeze" }),
        payout({ game_id: g13.id, amount_cents: 150000, display_name: "Scro" }),
      ],
    );
    expect(s.preSeason).toBe(false);
    expect(s.gamesPlayed).toBe(2);
    expect(s.gamesTotal).toBe(3);
    expect(s.paidOutCents).toBe(325000);
    expect(s.biggestWin).toEqual({ cents: 150000, label: "G13 Thanksgiving" });
    expect(s.mostWins).toEqual({ name: "Breeze", count: 2 });
  });

  it("season over: SEASON SUMMARY", () => {
    const g1 = game({ status: "final" });
    const g2 = game({ game_no: 2, status: "final" });
    expect(revealCardState([g1, g2], NOW).kind).toBe("season_summary");
    const summary = seasonSummary(
      [g1, g2],
      [
        payout({ amount_cents: 100000, display_name: "Breeze (Agnes)" }),
        payout({ amount_cents: 75000, display_name: "Scro" }),
        payout({ amount_cents: 50000, display_name: "Scro" }),
      ],
    );
    expect(summary.gamesPlayed).toBe(2);
    expect(summary.totalWonCents).toBe(225000);
    expect(summary.topWinner).toEqual({ name: "Scro", cents: 125000 });
  });
});
