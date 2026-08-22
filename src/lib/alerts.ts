// Admin overview alerts (spec 4.7), in priority order. Pure logic — kept
// out of the server-only data module so it is unit-testable.
import type { AdminGame, ParticipantFinance, Payout } from "@/lib/types";

interface ParticipantWithFinance {
  finance: ParticipantFinance;
}

export interface AdminAlert {
  level: "red" | "amber" | "blue";
  text: string;
  href: string;
}

export function buildAlerts(
  games: AdminGame[],
  payouts: Payout[],
  participants: ParticipantWithFinance[],
  claimDeadline: string,
  now = new Date(),
): AdminAlert[] {
  const alerts: AdminAlert[] = [];
  const code = (n: number) => `G${String(n).padStart(2, "0")}`;

  // Red: kickoff within 24 hours and digits not published.
  for (const g of games) {
    if (g.status === "void" || g.digits_published_at) continue;
    if (!g.kickoff_at) continue;
    const dt = new Date(g.kickoff_at).getTime() - now.getTime();
    if (dt > 0 && dt < 24 * 3600 * 1000) {
      alerts.push({
        level: "red",
        text: `${code(g.game_no)} kicks off within 24 hours and digits are not published`,
        href: "/admin/digits",
      });
    }
  }

  // Red: a game is final and has no payout recorded.
  const payoutByGame = new Map<string, Payout[]>();
  for (const p of payouts) {
    const list = payoutByGame.get(p.game_id) ?? [];
    list.push(p);
    payoutByGame.set(p.game_id, list);
  }
  for (const g of games) {
    if (g.status !== "final") continue;
    const list = (payoutByGame.get(g.id) ?? []).filter(
      (p) => p.status !== "void",
    );
    if (!list.some((p) => p.payout_type === "final")) {
      alerts.push({
        level: "red",
        text: `${code(g.game_no)} is final with no final payout recorded — review the winning block`,
        href: "/admin/payouts",
      });
    }
  }

  // Amber: unconfirmed game dates.
  const unconfirmed = games.filter(
    (g) => !g.date_confirmed && g.status !== "void",
  );
  if (unconfirmed.length > 0) {
    alerts.push({
      level: "amber",
      text: `${unconfirmed.length} game date${unconfirmed.length === 1 ? "" : "s"} unconfirmed (${unconfirmed
        .slice(0, 6)
        .map((g) => code(g.game_no))
        .join(", ")}${unconfirmed.length > 6 ? ", …" : ""})`,
      href: "/admin/games",
    });
  }

  // Amber: reserved blocks unpaid within 7 days of the claim deadline.
  const deadline = new Date(`${claimDeadline}T23:59:59-04:00`);
  const daysToDeadline =
    (deadline.getTime() - now.getTime()) / (24 * 3600 * 1000);
  if (daysToDeadline <= 7) {
    const unpaid = participants.filter(
      (p) =>
        p.finance.blocks_held > p.finance.blocks_assigned &&
        p.finance.amount_paid_cents < p.finance.amount_due_cents,
    );
    if (unpaid.length > 0) {
      alerts.push({
        level: "amber",
        text: `${unpaid.length} participant${unpaid.length === 1 ? "" : "s"} with reserved blocks still unpaid — claim deadline ${claimDeadline}`,
        href: "/admin/payments",
      });
    }
  }

  // Blue: payouts owed and unpaid.
  const owed = payouts.filter((p) => p.status === "owed");
  if (owed.length > 0) {
    const total = owed.reduce((s, p) => s + p.amount_cents, 0);
    alerts.push({
      level: "blue",
      text: `${owed.length} payout${owed.length === 1 ? "" : "s"} owed ($${(total / 100).toLocaleString("en-US")})`,
      href: "/admin/payouts",
    });
  }

  const order = { red: 0, amber: 1, blue: 2 } as const;
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
