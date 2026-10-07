// Derived facts: the numbers an email states that are arithmetic on what the
// database returned, never stored. Each refuses rather than guesses when the
// database does not support a single answer (two payout tiers, a missing
// deadline, a game with no kickoff).

import type { CommonFacts, GameFact } from "./types.ts";
import { localYmd, monthDay, POOL_TZ } from "./format.ts";

export interface Payouts {
  halftimeCents: number;
  finalCents: number;
}

/**
 * The one payout tier. Every game pays the same since 2026-09-08 and the four
 * config keys carry the same numbers; if they ever disagree for a game on the
 * slate, "every game" would be false, so this throws.
 */
export function uniformPayouts(c: CommonFacts): Payouts {
  const tiers = new Set<string>();
  for (const g of c.games) {
    const t = g.game_type === "holiday"
      ? [c.holiday_halftime_cents, c.holiday_final_cents]
      : [c.regular_halftime_cents, c.regular_final_cents];
    tiers.add(t.join("/"));
  }
  if (tiers.size === 0) throw new Error("uniformPayouts: no games on the slate");
  if (tiers.size > 1) throw new Error(`uniformPayouts: games pay different amounts (${[...tiers].join(", ")})`);
  const [h, f] = [...tiers][0].split("/").map(Number);
  return { halftimeCents: h, finalCents: f };
}

export function kickoffOf(g: GameFact): string {
  if (!g.kickoff_at) throw new Error(`G${g.game_no} has no kickoff time; an email cannot state it`);
  return g.kickoff_at;
}

export function firstGame(c: CommonFacts): GameFact {
  const g = c.games[0];
  if (!g) throw new Error("no games on the slate");
  return g;
}

export function lastGame(c: CommonFacts): GameFact {
  const g = c.games[c.games.length - 1];
  if (!g) throw new Error("no games on the slate");
  return g;
}

export function claimDeadline(c: CommonFacts): string {
  if (!c.claim_deadline) throw new Error("config.claim_deadline is not set");
  return c.claim_deadline;
}

export function seasonYear(c: CommonFacts): string {
  return localYmd(kickoffOf(firstGame(c)), c.timezone || POOL_TZ).slice(0, 4);
}

/** Halftime and final, every game. */
export function chancesToWin(c: CommonFacts): number {
  return c.games.length * 2;
}

export function seasonPayoutCents(c: CommonFacts): number {
  const p = uniformPayouts(c);
  return c.games.length * (p.halftimeCents + p.finalCents);
}

/**
 * "Nov 25, 26, 27 / Dec 24, 25 / Dec 31": the distinct game dates, grouped by
 * week, a month name only where the month changes inside a group.
 */
export function gameDatesLine(c: CommonFacts): string {
  const byWeek = new Map<number, string[]>();
  for (const g of c.games) {
    const ymd = localYmd(kickoffOf(g), c.timezone || POOL_TZ);
    const list = byWeek.get(g.week) ?? [];
    if (!list.includes(ymd)) list.push(ymd);
    byWeek.set(g.week, list);
  }
  return [...byWeek.values()]
    .map((dates) => {
      let month = "";
      return dates
        .sort()
        .map((ymd) => {
          const [m, d] = monthDay(ymd).split(" ");
          const out = m === month ? d : `${m} ${d}`;
          month = m;
          return out;
        })
        .join(", ");
    })
    .join(" / ");
}

export function ymdOfGame(c: CommonFacts, g: GameFact): string {
  return localYmd(kickoffOf(g), c.timezone || POOL_TZ);
}
