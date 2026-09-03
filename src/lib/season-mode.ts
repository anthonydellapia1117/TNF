// Season mode: one predicate every public surface asks, so the answer cannot
// drift between the dashboard, /blocks, /block/[n] and the link preview.
//
// Off (the default) the public side is a sales page: open counts, a claim
// CTA, a claim-by countdown. On, it is a season in progress — next game,
// the grid, recent winners — and every sales surface is gone.
//
// Pure logic, unit-tested. Components render what these functions say.
import type { PoolConfig } from "@/lib/types";

/** The public side reads as a season in progress, not a pool being sold. */
export function isSeasonMode(
  config: Pick<PoolConfig, "season_mode"> | null | undefined,
): boolean {
  // A config row read before migration 15 has no column at all; a pool that
  // has not opted in is not in season mode.
  return config?.season_mode === true;
}

/**
 * Every panel the public dashboard can render, in the order it renders.
 * Naming them lets the ordering rule live in one tested place instead of
 * being implied by the shape of the JSX.
 */
export type DashboardPanel =
  | "hero" // the next game
  | "grid_link" // straight into the current grid
  | "recent_winners"
  | "season_so_far"
  | "hot_digits"
  | "next_reveal"
  | "blocks_committed" // committed/100 with a progress bar — sellout framing
  | "collected" // money in
  | "claim_deadline" // days left to claim
  | "claim_cta"; // "Get in the pool · N blocks open · Claim a block"

/** The sales surfaces. Every one of these is gone in season mode. */
export const SALES_PANELS: readonly DashboardPanel[] = [
  "blocks_committed",
  "collected",
  "claim_deadline",
  "claim_cta",
] as const;

/**
 * What the public dashboard shows, in order.
 *
 * Season mode leads with the next game, the current grid, and recent
 * winners — in that order — and drops every panel in SALES_PANELS. Off, the
 * layout is what it has always been: hero, the four stat cards, then the
 * claim CTA beside recent winners.
 *
 * The claim CTA also disappears when nothing is open, season mode or not:
 * "0 blocks open · Claim a block" was never a thing to show anyone.
 */
export function dashboardPanels(
  seasonMode: boolean,
  opts: { hasNextGame: boolean; openBlocks: number },
): DashboardPanel[] {
  const panels: DashboardPanel[] = [];
  if (opts.hasNextGame) panels.push("hero");

  if (seasonMode) {
    // The next game and when its numbers drop are one unit — on a game-day
    // morning the reveal countdown is the most time-sensitive thing on the
    // page. Then the grid, then what has already been won.
    panels.push(
      "next_reveal",
      "grid_link",
      "recent_winners",
      "season_so_far",
      "hot_digits",
    );
    return panels;
  }

  panels.push("blocks_committed", "collected", "next_reveal", "claim_deadline");
  if (opts.openBlocks > 0) panels.push("claim_cta");
  panels.push("recent_winners", "season_so_far", "hot_digits");
  return panels;
}

/** True when this panel is on the dashboard for these settings. */
export function showsPanel(
  panels: DashboardPanel[],
  panel: DashboardPanel,
): boolean {
  return panels.includes(panel);
}
