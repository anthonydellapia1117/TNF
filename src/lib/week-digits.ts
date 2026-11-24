// One day at a time (Anthony, 2026-11-23, Part N; it was one week at a time).
// A game's digits are drawn on its own kickoff date in ET, before kickoff, and
// published at once — never earlier, never for a week or a season in advance.
// Digits that exist early are digits someone could see or alter; under this
// model they do not exist until the morning of their game. The morning run
// draws through admin_draw_day (migration 43); this module is the same rule
// for the /admin/digits fallback, re-checked in the server actions.
//
// Pure logic, unit-tested. The screen only renders what these functions say.
// The week grouping below is navigation only; the gate is the day.
import {
  etDateOf,
  etWallClockToUtcISO,
  fmtDateET,
  fmtKickoffET,
  REVEAL_TIME_ET,
  revealSlotUtcISO,
} from "@/lib/format";
import { gameCode } from "@/lib/pool";
import type { AdminGame } from "@/lib/types";

/** The rule, in words the screen shows. */
export const DRAW_RULE = "A game's digits are drawn on its own game day (ET), before kickoff, and published at once.";

/**
 * The standing reveal slot on each game's OWN date. Never one shared instant
 * for a week — a Thanksgiving triple-header reveals three times on its one
 * date, and a week split across two dates reveals twice.
 */
export { REVEAL_TIME_ET };

export function revealAtISO(g: AdminGame): string | null {
  if (!g.kickoff_at) return null;
  return revealSlotUtcISO(etDateOf(g.kickoff_at));
}

export type DigitState = "none" | "assigned" | "scheduled" | "revealed";

export function digitState(g: AdminGame, nowMs: number): DigitState {
  if (g.digits_assigned_at === null) return "none";
  if (g.digits_published_at === null) return "assigned";
  return new Date(g.digits_published_at).getTime() <= nowMs
    ? "revealed"
    : "scheduled";
}

/** Why this game cannot be drawn right now — the RPC's own gates, verbatim. */
function ineligibility(g: AdminGame, nowMs: number): string | null {
  if (g.status === "void") return "void";
  if (!g.date_confirmed) return "date unconfirmed";
  if (g.kickoff_at === null) return "no kickoff time";
  if (new Date(g.kickoff_at).getTime() <= nowMs) return "past kickoff";
  return null;
}

export type Gate = { ok: true } | { ok: false; reason: string };

export interface BlockedGame {
  game: AdminGame;
  reason: string;
}

export interface PlannedReveal {
  game: AdminGame;
  /** 8:00 AM ET on the game's date, or null when that slot already passed. */
  revealAtISO: string | null;
  /** True when 8:00 AM has been and gone — publishing goes out immediately. */
  immediate: boolean;
}

export interface WeekPlan {
  week: number;
  label: string;
  games: AdminGame[];
  /** Unassigned and individually drawable — what one click would draw. */
  toAssign: AdminGame[];
  /** Unassigned but the database would refuse them, with the reason. */
  blocked: BlockedGame[];
  /** Drawn but not yet published — what the publish click would schedule. */
  toSchedule: PlannedReveal[];
  /** The one-week window over the games that would actually be drawn. */
  assign: Gate;
}

function sortByKickoff(games: AdminGame[]): AdminGame[] {
  return [...games].sort((a, b) =>
    (a.kickoff_at ?? "9999").localeCompare(b.kickoff_at ?? "9999"),
  );
}

/** Games grouped by their NFL week, weeks in schedule order. */
export function weekGroups(games: AdminGame[]): { week: number; games: AdminGame[] }[] {
  const by = new Map<number, AdminGame[]>();
  for (const g of games) {
    const list = by.get(g.week);
    if (list) list.push(g);
    else by.set(g.week, [g]);
  }
  return [...by.entries()]
    .map(([week, list]) => ({ week, games: sortByKickoff(list) }))
    .sort((a, b) =>
      (a.games[0]?.kickoff_at ?? "9999").localeCompare(
        b.games[0]?.kickoff_at ?? "9999",
      ),
    );
}

/** "Week 1 · Wed, Sep 9 – Thu, Sep 10", or one date when the week is one day. */
export function weekLabel(week: number, games: AdminGame[]): string {
  const dates = [
    ...new Set(
      games
        .map((g) => g.kickoff_at)
        .filter((k): k is string => k !== null)
        .map(etDateOf),
    ),
  ].sort();
  if (dates.length === 0) return `Week ${week}`;
  const first = fmtDateET(games.find((g) => g.kickoff_at)!.kickoff_at);
  if (dates.length === 1) return `Week ${week} · ${first}`;
  const lastGame = sortByKickoff(games).filter((g) => g.kickoff_at).pop()!;
  return `Week ${week} · ${first} – ${fmtDateET(lastGame.kickoff_at)}`;
}

/** The instant a game becomes drawable: one window before its kickoff. */
/** The instant a game becomes drawable: midnight ET starting its game day. */
export function assignUnlockISO(g: AdminGame): string | null {
  if (!g.kickoff_at) return null;
  return etWallClockToUtcISO(etDateOf(g.kickoff_at), "00:00");
}

/**
 * Refusal text for a game that is not on today's ET date, or null when it is.
 * This is the rule itself, not a screen's opinion of it: the weekly button,
 * the per-game button and both server actions ask this same question. A game
 * whose day has passed is past kickoff, which ineligibility already says.
 */
export function windowRefusal(g: AdminGame, nowMs: number): string | null {
  if (!g.kickoff_at) return null;
  if (etDateOf(g.kickoff_at) === etDateOf(new Date(nowMs).toISOString())) return null;
  return (
    `${gameCode(g.game_no)} kicks off ${fmtKickoffET(g.kickoff_at)}. Digits are ` +
    `drawn on game day only, so this unlocks ${fmtKickoffET(assignUnlockISO(g))}.`
  );
}

/**
 * The one-week window, applied to the games a click would actually draw.
 * A void or already-drawn game further out never holds a week back — only a
 * game we would really write digits for.
 */
export function assignGate(
  week: number,
  toAssign: AdminGame[],
  blocked: BlockedGame[],
  allGames: AdminGame[],
  nowMs: number,
): Gate {
  if (toAssign.length === 0) {
    if (blocked.length > 0) {
      const list = blocked
        .map((b) => `${gameCode(b.game.game_no)} (${b.reason})`)
        .join(", ");
      return { ok: false, reason: `Nothing to draw in week ${week} — ${list}.` };
    }
    return {
      ok: false,
      reason:
        allGames.length === 0
          ? `No games in week ${week}.`
          : `Week ${week} is already drawn — every game has its digits.`,
    };
  }
  // Every game a click would draw is on today's date (weekPlan puts any other
  // in blocked), so this is a guard against a caller that built its own list.
  const refusal = toAssign.map((g) => windowRefusal(g, nowMs)).find((r) => r !== null);
  return refusal ? { ok: false, reason: refusal } : { ok: true };
}

export function weekPlan(
  week: number,
  games: AdminGame[],
  nowMs: number,
): WeekPlan {
  const ordered = sortByKickoff(games);
  const toAssign: AdminGame[] = [];
  const blocked: BlockedGame[] = [];
  const toSchedule: PlannedReveal[] = [];

  for (const g of ordered) {
    if (g.digits_assigned_at === null) {
      const reason = ineligibility(g, nowMs) ?? (windowRefusal(g, nowMs) ? `drawn on game day, ${fmtDateET(g.kickoff_at)}` : null);
      if (reason) blocked.push({ game: g, reason });
      else toAssign.push(g);
      continue;
    }
    // Drawn and not published: publish now (Part N), never a later slot.
    if (digitState(g, nowMs) === "assigned") {
      toSchedule.push({ game: g, revealAtISO: null, immediate: true });
    }
  }

  return {
    week,
    label: weekLabel(week, ordered),
    games: ordered,
    toAssign,
    blocked,
    toSchedule,
    assign: assignGate(week, toAssign, blocked, ordered, nowMs),
  };
}

export function weekPlans(games: AdminGame[], nowMs: number): WeekPlan[] {
  return weekGroups(games).map((g) => weekPlan(g.week, g.games, nowMs));
}

/**
 * Where the screen opens: the next week that still has a game without
 * digits. Falls back to the week of the next kickoff, then the last week.
 */
export function defaultWeek(plans: WeekPlan[], nowMs: number): number | null {
  if (plans.length === 0) return null;
  const undrawn = plans.find((p) =>
    p.games.some((g) => g.digits_assigned_at === null),
  );
  if (undrawn) return undrawn.week;
  const upcoming = plans.find((p) =>
    p.games.some(
      (g) => g.kickoff_at !== null && new Date(g.kickoff_at).getTime() > nowMs,
    ),
  );
  return (upcoming ?? plans[plans.length - 1]).week;
}
