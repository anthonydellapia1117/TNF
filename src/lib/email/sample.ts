// Review copies of the game-day emails (Part N): the live game list with
// made-up digits and scores, marked SAMPLE. Never sent, never claimed; the
// command only drafts a sample To Anthony.

import type { CommonFacts, DayFacts, DayGame } from "./types.ts";
import { ymdOfGame } from "./facts.ts";
import { winningBlock } from "../pool.ts";

/** Fixed, obviously made-up permutations: one rows, one columns. */
export const SAMPLE_ROWS = [3, 8, 1, 6, 0, 9, 4, 7, 2, 5];
export const SAMPLE_COLS = [7, 2, 9, 4, 1, 6, 0, 5, 8, 3];
/** Made-up scores: away, home at halftime, then final. */
const SAMPLE_SCORES: [number, number, number, number][] = [
  [10, 7, 24, 27],
  [3, 14, 20, 17],
  [0, 0, 13, 16],
  [7, 10, 23, 30],
  [17, 3, 27, 13],
];

/** One game date's games from the live slate, with sample digits and, for winners, sample scores. */
export function sampleDay(common: CommonFacts, date: string, withScores: boolean): DayFacts {
  const games = common.games.filter((g) => ymdOfGame(common, g) === date);
  if (games.length === 0) throw new Error(`sampleDay: no games on ${date}`);
  return {
    date,
    games: games.map((g, i): DayGame => {
      const s = SAMPLE_SCORES[i % SAMPLE_SCORES.length];
      const ht = withScores ? winningBlock(SAMPLE_ROWS, SAMPLE_COLS, s[1], s[0]) : null;
      const fin = withScores ? winningBlock(SAMPLE_ROWS, SAMPLE_COLS, s[3], s[2]) : null;
      return {
        game_no: g.game_no,
        week: g.week,
        kickoff_at: g.kickoff_at ?? "",
        holiday_label: g.holiday_label,
        away_team: g.away_team,
        home_team: g.home_team,
        network: g.network,
        status: withScores ? "final" : "published",
        published: true,
        row_digits: SAMPLE_ROWS,
        col_digits: SAMPLE_COLS,
        digits_ok: true,
        halftime_away: withScores ? s[0] : null,
        halftime_home: withScores ? s[1] : null,
        halftime_block: ht,
        final_away: withScores ? s[2] : null,
        final_home: withScores ? s[3] : null,
        final_block: fin,
        halftime_name: withScores ? "SAMPLE NAME" : null,
        final_name: withScores ? "SAMPLE NAME" : null,
        halftime_paid_out: withScores,
        final_paid_out: withScores,
      };
    }),
  };
}
