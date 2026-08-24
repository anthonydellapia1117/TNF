import { describe, expect, it } from "vitest";
import { buildAlerts } from "@/lib/alerts";
import type { AdminGame, ParticipantFinance, Payout } from "@/lib/types";

const NOW = new Date("2026-08-22T12:00:00Z");

function game(over: Partial<AdminGame>): AdminGame {
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
    digit_seed: null,
    digits_assigned_at: null,
    digits_published_at: null,
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
    notes: null,
    ...over,
  };
}

function payout(over: Partial<Payout>): Payout {
  return {
    id: crypto.randomUUID(),
    game_id: over.game_id ?? crypto.randomUUID(),
    payout_type: "final",
    block_number: 15,
    participant_id: null,
    display_name: null,
    amount_cents: 100000,
    created_at: "2026-09-10T04:00:00Z",
    status: "owed",
    paid_on: null,
    method: null,
    note: null,
    ...over,
  };
}

function person(finance: Partial<ParticipantFinance>) {
  return {
    finance: {
      participant_id: crypto.randomUUID(),
      blocks_held: 0,
      blocks_assigned: 0,
      amount_due_cents: 0,
      amount_paid_cents: 0,
      ...finance,
    },
  };
}

describe("buildAlerts", () => {
  it("flags imminent kickoff with unpublished digits as red", () => {
    const g = game({ kickoff_at: "2026-08-22T20:00:00Z" }); // 8h away
    const alerts = buildAlerts([g], [], [], "2026-09-04", NOW);
    expect(alerts.some((a) => a.level === "red" && /24 hours/.test(a.text))).toBe(true);
  });

  it("does not flag a game with published digits", () => {
    const g = game({
      kickoff_at: "2026-08-22T20:00:00Z",
      digits_published_at: "2026-08-20T00:00:00Z",
      status: "published",
    });
    const alerts = buildAlerts([g], [], [], "2026-09-04", NOW);
    expect(alerts.some((a) => /24 hours/.test(a.text))).toBe(false);
  });

  it("does not nag a game whose reveal is scheduled before kickoff", () => {
    const g = game({
      kickoff_at: "2026-08-22T20:00:00Z", // 8h away
      digits_published_at: "2026-08-22T16:00:00Z", // reveal in 4h
      status: "published",
    });
    const alerts = buildAlerts([g], [], [], "2026-09-04", NOW);
    expect(alerts.some((a) => a.level === "red")).toBe(false);
  });

  it("flags a reveal scheduled after kickoff as red", () => {
    const g = game({
      kickoff_at: "2026-08-22T20:00:00Z",
      digits_published_at: "2026-08-23T09:00:00Z", // after the game
      status: "published",
    });
    const alerts = buildAlerts([g], [], [], "2026-09-04", NOW);
    expect(
      alerts.some((a) => a.level === "red" && /after kickoff/.test(a.text)),
    ).toBe(true);
  });

  it("flags a final game with no final payout as red (the review case)", () => {
    const g = game({ status: "final", final_block: 13 });
    const alerts = buildAlerts([g], [], [], "2026-09-04", NOW);
    expect(alerts.some((a) => a.level === "red" && /no final payout/.test(a.text))).toBe(true);
    // A voided payout doesn't count as recorded.
    const voided = payout({ game_id: g.id, status: "void" });
    expect(
      buildAlerts([g], [voided], [], "2026-09-04", NOW).some((a) =>
        /no final payout/.test(a.text),
      ),
    ).toBe(true);
    // A real owed payout clears it.
    const owed = payout({ game_id: g.id });
    expect(
      buildAlerts([g], [owed], [], "2026-09-04", NOW).some((a) =>
        /no final payout/.test(a.text),
      ),
    ).toBe(false);
  });

  it("counts unconfirmed dates as amber", () => {
    const alerts = buildAlerts(
      [game({ date_confirmed: false }), game({ date_confirmed: false, game_no: 2 })],
      [],
      [],
      "2026-09-04",
      NOW,
    );
    const amber = alerts.find((a) => a.level === "amber");
    expect(amber?.text).toContain("2 game dates unconfirmed");
  });

  it("flags unpaid reserved blocks only inside the 7-day deadline window", () => {
    const unpaid = person({
      blocks_held: 1,
      blocks_assigned: 0,
      amount_due_cents: 50000,
      amount_paid_cents: 0,
    });
    const farOut = buildAlerts([], [], [unpaid], "2026-09-04", NOW);
    expect(farOut.some((a) => /unpaid/.test(a.text))).toBe(false);
    const nearDeadline = new Date("2026-08-30T12:00:00Z");
    const near = buildAlerts([], [], [unpaid], "2026-09-04", nearDeadline);
    expect(near.some((a) => a.level === "amber" && /unpaid/.test(a.text))).toBe(true);
  });

  it("lists owed payouts as blue and sorts red before amber before blue", () => {
    const g = game({ status: "final", final_block: 13, date_confirmed: false });
    const owed = payout({ game_id: g.id, payout_type: "halftime", amount_cents: 75000 });
    const alerts = buildAlerts([g], [owed], [], "2026-09-04", NOW);
    const levels = alerts.map((a) => a.level);
    expect([...levels].sort((a, b) => {
      const order = { red: 0, amber: 1, blue: 2 } as const;
      return order[a] - order[b];
    })).toEqual(levels);
    expect(alerts.some((a) => a.level === "blue" && /\$750/.test(a.text))).toBe(true);
  });
});
