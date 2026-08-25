// The one dashboard card that always shows the most relevant thing right
// now: reveal countdown → kickoff countdown → live game → last winner →
// season summary. Pure logic, unit-tested; the component only renders.
import { etDateOf, nineAmETUtcISO } from "@/lib/format";
import { winningBlock } from "@/lib/pool";
import type { PublicGame, PublicPayout } from "@/lib/types";

export type RevealCardState =
  | { kind: "next_reveal"; game: PublicGame; revealAtISO: string | null }
  | { kind: "numbers_live"; game: PublicGame }
  | { kind: "live_now"; game: PublicGame; leaderBlock: number | null }
  | { kind: "last_winner"; lastGame: PublicGame; nextGame: PublicGame | null }
  | { kind: "season_summary" };

function revealed(g: PublicGame): boolean {
  return g.row_digits !== null && g.col_digits !== null;
}

/**
 * When the numbers drop for a game: the announced reveal time if one
 * exists, otherwise the pool's standing default of 9:00 AM ET on game day.
 */
export function revealTimeISO(g: PublicGame): string | null {
  if (g.digits_reveal_at) return g.digits_reveal_at;
  if (!g.kickoff_at) return null;
  return nineAmETUtcISO(etDateOf(g.kickoff_at));
}

export function revealCardState(
  games: PublicGame[],
  nowMs: number,
): RevealCardState {
  // A game underway right now beats everything — admin-flagged live, or
  // simply past kickoff with revealed digits and no final yet.
  const live = games.find(
    (g) =>
      g.status === "in_progress" ||
      g.status === "halftime" ||
      (revealed(g) &&
        g.status !== "final" &&
        g.status !== "void" &&
        g.kickoff_at !== null &&
        new Date(g.kickoff_at).getTime() <= nowMs),
  );
  if (live) {
    const leaderBlock =
      revealed(live) && live.live_home !== null && live.live_away !== null
        ? winningBlock(
            live.row_digits!,
            live.col_digits!,
            live.live_home,
            live.live_away,
          )
        : null;
    return { kind: "live_now", game: live, leaderBlock };
  }

  const upcoming = games
    .filter((g) => g.status !== "final" && g.status !== "void")
    .sort((a, b) =>
      (a.kickoff_at ?? "9999").localeCompare(b.kickoff_at ?? "9999"),
    )[0];

  const finals = games
    .filter((g) => g.status === "final")
    .sort((a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
  const lastFinal = finals[finals.length - 1];

  if (!upcoming) return { kind: "season_summary" };

  if (revealed(upcoming)) return { kind: "numbers_live", game: upcoming };

  // Digits not out yet: a fresh result holds the card until they drop;
  // before the first final (season start) it's the reveal countdown.
  if (lastFinal)
    return { kind: "last_winner", lastGame: lastFinal, nextGame: upcoming };
  return {
    kind: "next_reveal",
    game: upcoming,
    revealAtISO: revealTimeISO(upcoming),
  };
}

export interface SeasonSummary {
  gamesPlayed: number;
  totalWonCents: number;
  topWinner: { name: string; cents: number } | null;
}

export function seasonSummary(
  games: PublicGame[],
  payouts: PublicPayout[],
): SeasonSummary {
  const gamesPlayed = games.filter((g) => g.status === "final").length;
  const totalWonCents = payouts.reduce((s, p) => s + p.amount_cents, 0);
  const byName = new Map<string, number>();
  for (const p of payouts) {
    const name = p.display_name ?? `Block ${p.block_number}`;
    byName.set(name, (byName.get(name) ?? 0) + p.amount_cents);
  }
  let topWinner: SeasonSummary["topWinner"] = null;
  for (const [name, cents] of byName) {
    if (!topWinner || cents > topWinner.cents) topWinner = { name, cents };
  }
  return { gamesPlayed, totalWonCents, topWinner };
}
