// One week at a time. Digits are drawn for the games of a single week, the
// week they are needed — never for the whole season in advance. Digits that
// exist months early are digits someone could see or alter; under this model
// they do not exist until their week comes up.
//
// Pure logic, unit-tested. The screen only renders what these functions say,
// and every gate here mirrors a gate the database already enforces, so the
// UI never offers something admin_assign_digits would refuse.
import {
  etDateOf,
  fmtDateET,
  fmtKickoffET,
  REVEAL_TIME_ET,
  revealSlotUtcISO,
} from "@/lib/format";
import { gameCode } from "@/lib/pool";
import type { AdminGame } from "@/lib/types";

/** A game further out than this cannot be drawn yet. */
export const ASSIGN_WINDOW_DAYS = 7;
const WINDOW_MS = ASSIGN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
export function assignUnlockISO(g: AdminGame): string | null {
  if (!g.kickoff_at) return null;
  return new Date(new Date(g.kickoff_at).getTime() - WINDOW_MS).toISOString();
}

/**
 * Refusal text for a single game still outside the one-week window, or null
 * when it is inside. This is the rule itself, not a screen's opinion of it —
 * both the weekly draw and the per-game draw ask this same question.
 */
export function windowRefusal(g: AdminGame, nowMs: number): string | null {
  if (!g.kickoff_at) return null;
  const kickoffMs = new Date(g.kickoff_at).getTime();
  if (kickoffMs - nowMs <= WINDOW_MS) return null;
  return (
    `${gameCode(g.game_no)} kicks off ${fmtKickoffET(g.kickoff_at)} — more than ` +
    `${ASSIGN_WINDOW_DAYS} days out. Digits are drawn one week at a time, so ` +
    `this unlocks ${fmtKickoffET(assignUnlockISO(g))}.`
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
  // The furthest game we would draw sets the gate: assigning the week means
  // assigning all of it, so all of it has to be inside the window.
  const furthest = sortByKickoff(toAssign).pop()!;
  const refusal = windowRefusal(furthest, nowMs);
  return refusal === null ? { ok: true } : { ok: false, reason: refusal };
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
      const reason = ineligibility(g, nowMs);
      if (reason) blocked.push({ game: g, reason });
      else toAssign.push(g);
      continue;
    }
    if (digitState(g, nowMs) === "assigned") {
      const at = revealAtISO(g);
      const immediate = at === null || new Date(at).getTime() <= nowMs;
      toSchedule.push({ game: g, revealAtISO: immediate ? null : at, immediate });
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
