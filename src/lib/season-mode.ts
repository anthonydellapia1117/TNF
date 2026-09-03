// What the public home page shows, and in what order.
//
// The viewer side is for a TNF fan, not an administrator. Collection status,
// blocks committed and the claim CTA are gone from it outright — they live on
// /admin, which is the only place that needs them. What is left is the
// season: the next game, the grid, who is winning, and how the digits are
// falling.
//
// season_mode remains an admin toggle for the handful of sales surfaces that
// are still legitimately pre-season — the claim-by deadline card here, the
// block-is-open nudge on /block/[n], the "BLOCKS OPEN" headline on the link
// preview, and two meta descriptions.
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
 * Every panel the public home page can render, in the order it renders.
 * Naming them lets the ordering rule live in one tested place instead of
 * being implied by the shape of the JSX.
 *
 * There is deliberately no panel here for collected money, blocks
 * committed, or claiming a block. Those are administrative and this type is
 * the list of things a viewer may see.
 */
export type DashboardPanel =
  | "hero" // the next game
  | "next_reveal" // when its digits drop
  | "holiday_next" // the next holiday game, which pays more
  | "claim_deadline" // days left to claim — the last pre-season card
  | "grid_link" // straight into the current grid
  | "recent_winners"
  | "season_so_far"
  | "hot_digits" // which last digits keep hitting, and which never have
  | "close_calls" // blocks one point from a win
  | "hot_cells"; // the score patterns that keep coming up

/**
 * Panels that only make sense while blocks are still being sold. Season mode
 * drops them. The list is short because the genuinely administrative ones
 * are not viewer panels at all any more.
 */
export const PRESEASON_PANELS: readonly DashboardPanel[] = [
  "claim_deadline",
] as const;

/** Panels that exist only once the page has stopped selling. */
export const SEASON_PANELS: readonly DashboardPanel[] = ["grid_link"] as const;

/**
 * The home page, in order. One ordering with two conditionals, rather than
 * two orderings that can drift apart.
 */
export function dashboardPanels(
  seasonMode: boolean,
  opts: { hasNextGame: boolean },
): DashboardPanel[] {
  const panels: DashboardPanel[] = [];
  if (opts.hasNextGame) panels.push("hero");

  // The next game and when its numbers drop are one unit — on a game-day
  // morning the reveal countdown is the most time-sensitive thing here.
  panels.push("next_reveal", "holiday_next");
  if (!seasonMode) panels.push("claim_deadline");
  if (seasonMode) panels.push("grid_link");

  panels.push(
    "recent_winners",
    "season_so_far",
    "hot_digits",
    "close_calls",
    "hot_cells",
  );
  return panels;
}

/** True when this panel is on the home page for these settings. */
export function showsPanel(
  panels: DashboardPanel[],
  panel: DashboardPanel,
): boolean {
  return panels.includes(panel);
}
