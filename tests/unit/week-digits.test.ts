import { describe, expect, it } from "vitest";
import {
  ASSIGN_WINDOW_DAYS,
  assignUnlockISO,
  defaultWeek,
  digitState,
  revealAtISO,
  weekGroups,
  weekLabel,
  weekPlan,
  weekPlans,
  windowRefusal,
} from "@/lib/week-digits";
import type { AdminGame } from "@/lib/types";

function game(over: Partial<AdminGame> & { game_no: number }): AdminGame {
  return {
    id: over.id ?? `g-${over.game_no}`,
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

/** The real week 1: Wed Sep 9 8:20 PM ET and Thu Sep 10 8:35 PM ET. */
const G01 = game({ game_no: 1, week: 1, kickoff_at: "2026-09-10T00:20:00Z" });
const G02 = game({ game_no: 2, week: 1, kickoff_at: "2026-09-11T00:35:00Z" });

const ms = (iso: string) => new Date(iso).getTime();

describe("revealAtISO — 8:00 AM ET on each game's own date", () => {
  it("resolves 8:00 AM ET through EDT", () => {
    // Sep 9 is EDT (-04:00), so 8:00 AM ET is 12:00 UTC that day.
    expect(revealAtISO(G01)).toBe("2026-09-09T12:00:00.000Z");
  });

  it("resolves 8:00 AM ET through EST", () => {
    // Dec 24 is EST (-05:00), so 8:00 AM ET is 13:00 UTC that day.
    const g19 = game({ game_no: 19, week: 16, kickoff_at: "2026-12-25T01:15:00Z" });
    expect(revealAtISO(g19)).toBe("2026-12-24T13:00:00.000Z");
  });

  it("uses the game's OWN date, never one shared instant for the week", () => {
    // Week 1 straddles two ET dates: two reveals, a day apart.
    expect(revealAtISO(G01)).toBe("2026-09-09T12:00:00.000Z");
    expect(revealAtISO(G02)).toBe("2026-09-10T12:00:00.000Z");
    expect(revealAtISO(G01)).not.toBe(revealAtISO(G02));
  });

  it("gives a triple-header on one date three reveals at the same 8:00 AM", () => {
    // Thanksgiving: 1:00 PM, 4:30 PM and 8:20 PM ET all on Nov 26.
    const tg = [
      game({ game_no: 13, week: 12, kickoff_at: "2026-11-26T18:00:00Z" }),
      game({ game_no: 14, week: 12, kickoff_at: "2026-11-26T21:30:00Z" }),
      game({ game_no: 15, week: 12, kickoff_at: "2026-11-27T01:20:00Z" }),
    ];
    expect(tg.map(revealAtISO)).toEqual([
      "2026-11-26T13:00:00.000Z",
      "2026-11-26T13:00:00.000Z",
      "2026-11-26T13:00:00.000Z",
    ]);
  });

  it("returns null when there is no kickoff to hang a date on", () => {
    expect(revealAtISO(game({ game_no: 9, kickoff_at: null }))).toBeNull();
  });
});

describe("the one-week window", () => {
  it("refuses a game more than 7 days out and names it and the unlock time", () => {
    // 2026-09-03 4:16 AM ET. G02 kicks off in 7d 16h.
    const now = ms("2026-09-03T08:16:00Z");
    const refusal = windowRefusal(G02, now);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("G02");
    expect(refusal).toContain(`more than ${ASSIGN_WINDOW_DAYS} days out`);
    expect(refusal).toContain("Thu, Sep 3, 8:35 PM ET"); // when it unlocks
  });

  it("allows a game inside the window", () => {
    // Same instant: G01 is 6d 16h out.
    expect(windowRefusal(G01, ms("2026-09-03T08:16:00Z"))).toBeNull();
  });

  it("puts the boundary at exactly 7 days — inclusive", () => {
    const kickoff = ms("2026-09-11T00:35:00Z");
    const window = ASSIGN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    expect(windowRefusal(G02, kickoff - window)).toBeNull();
    expect(windowRefusal(G02, kickoff - window - 1)).not.toBeNull();
  });

  it("unlocks exactly one window before kickoff", () => {
    expect(assignUnlockISO(G02)).toBe("2026-09-04T00:35:00.000Z");
  });
});

describe("weekGroups and weekLabel", () => {
  it("groups by NFL week, in schedule order, games sorted by kickoff", () => {
    const groups = weekGroups([
      game({ game_no: 3, week: 2, kickoff_at: "2026-09-18T00:15:00Z" }),
      G02,
      G01,
    ]);
    expect(groups.map((g) => g.week)).toEqual([1, 2]);
    expect(groups[0].games.map((g) => g.game_no)).toEqual([1, 2]);
  });

  it("labels a two-date week with both ends", () => {
    expect(weekLabel(1, [G01, G02])).toBe("Week 1 · Wed, Sep 9 – Thu, Sep 10");
  });

  it("labels a one-date week with one date", () => {
    const tg = [
      game({ game_no: 13, week: 12, kickoff_at: "2026-11-26T18:00:00Z" }),
      game({ game_no: 15, week: 12, kickoff_at: "2026-11-27T01:20:00Z" }),
    ];
    expect(weekLabel(12, tg)).toBe("Week 12 · Thu, Nov 26");
  });
});

describe("weekPlan", () => {
  const now = ms("2026-09-03T08:16:00Z");

  it("refuses the whole week when its furthest undrawn game is out of range", () => {
    const plan = weekPlan(1, [G01, G02], now);
    expect(plan.toAssign.map((g) => g.game_no)).toEqual([1, 2]);
    expect(plan.assign.ok).toBe(false);
    expect(plan.assign.ok === false && plan.assign.reason).toContain("G02");
  });

  it("allows the week once every game it would draw is inside the window", () => {
    const plan = weekPlan(1, [G01, G02], ms("2026-09-04T01:00:00Z"));
    expect(plan.assign.ok).toBe(true);
  });

  it("does not let a game it would never draw hold the week back", () => {
    // G02 is out of range but void, so it is not part of the draw at all.
    const plan = weekPlan(1, [G01, { ...G02, status: "void" }], now);
    expect(plan.toAssign.map((g) => g.game_no)).toEqual([1]);
    expect(plan.blocked.map((b) => b.reason)).toEqual(["void"]);
    expect(plan.assign.ok).toBe(true);
  });

  it("mirrors the RPC's own gates as blocked reasons", () => {
    const plan = weekPlan(
      5,
      [
        game({ game_no: 30, week: 5, date_confirmed: false }),
        game({ game_no: 31, week: 5, kickoff_at: null }),
        game({ game_no: 32, week: 5, kickoff_at: "2026-09-01T00:00:00Z" }),
        game({ game_no: 33, week: 5, status: "void" }),
      ],
      now,
    );
    expect(plan.toAssign).toEqual([]);
    expect(plan.blocked.map((b) => `${b.game.game_no}:${b.reason}`).sort()).toEqual([
      "30:date unconfirmed",
      "31:no kickoff time",
      "32:past kickoff",
      "33:void",
    ]);
    expect(plan.assign.ok).toBe(false);
  });

  it("says so plainly when the week is already drawn", () => {
    const drawn = { ...G01, digits_assigned_at: "2026-09-03T09:00:00Z" };
    const plan = weekPlan(1, [drawn], now);
    expect(plan.assign.ok).toBe(false);
    expect(plan.assign.ok === false && plan.assign.reason).toContain(
      "already drawn",
    );
  });

  it("queues drawn-but-unpublished games for review, each at its own 8:00 AM", () => {
    const plan = weekPlan(
      1,
      [
        { ...G01, digits_assigned_at: "2026-09-03T09:00:00Z" },
        { ...G02, digits_assigned_at: "2026-09-03T09:00:00Z" },
      ],
      now,
    );
    expect(plan.toSchedule.map((r) => r.game.game_no)).toEqual([1, 2]);
    expect(plan.toSchedule.map((r) => r.revealAtISO)).toEqual([
      "2026-09-09T12:00:00.000Z",
      "2026-09-10T12:00:00.000Z",
    ]);
    expect(plan.toSchedule.every((r) => r.immediate)).toBe(false);
  });

  it("publishes immediately when 8:00 AM on game day has already passed", () => {
    // Drawn on game day at 10:00 AM ET — the 8:00 AM slot is behind us.
    const plan = weekPlan(
      1,
      [{ ...G01, digits_assigned_at: "2026-09-09T14:00:00Z" }],
      ms("2026-09-09T14:00:00Z"),
    );
    expect(plan.toSchedule[0].immediate).toBe(true);
    expect(plan.toSchedule[0].revealAtISO).toBeNull();
  });

  it("leaves an already-scheduled game out of the publish queue", () => {
    const plan = weekPlan(
      1,
      [
        {
          ...G01,
          digits_assigned_at: "2026-09-03T09:00:00Z",
          digits_published_at: "2026-09-09T12:00:00Z",
        },
      ],
      now,
    );
    expect(plan.toSchedule).toEqual([]);
  });
});

describe("digitState", () => {
  const now = ms("2026-09-05T00:00:00Z");
  it("reads none, assigned, scheduled and revealed apart", () => {
    expect(digitState(G01, now)).toBe("none");
    expect(digitState({ ...G01, digits_assigned_at: "2026-09-04T00:00:00Z" }, now)).toBe(
      "assigned",
    );
    expect(
      digitState(
        {
          ...G01,
          digits_assigned_at: "2026-09-04T00:00:00Z",
          digits_published_at: "2026-09-09T12:00:00Z",
        },
        now,
      ),
    ).toBe("scheduled");
    expect(
      digitState(
        {
          ...G01,
          digits_assigned_at: "2026-09-04T00:00:00Z",
          digits_published_at: "2026-09-04T12:00:00Z",
        },
        now,
      ),
    ).toBe("revealed");
  });
});

describe("defaultWeek", () => {
  const now = ms("2026-09-03T08:16:00Z");
  const G03 = game({ game_no: 3, week: 2, kickoff_at: "2026-09-18T00:15:00Z" });

  it("opens on the next week that still has an undrawn game", () => {
    expect(defaultWeek(weekPlans([G01, G02, G03], now), now)).toBe(1);
  });

  it("skips a week that is fully drawn", () => {
    const drawn = { digits_assigned_at: "2026-09-03T09:00:00Z" };
    const plans = weekPlans(
      [{ ...G01, ...drawn }, { ...G02, ...drawn }, G03],
      now,
    );
    expect(defaultWeek(plans, now)).toBe(2);
  });

  it("falls back to the week of the next kickoff once everything is drawn", () => {
    const drawn = { digits_assigned_at: "2026-09-03T09:00:00Z" };
    const plans = weekPlans(
      [
        { ...G01, ...drawn, kickoff_at: "2026-09-01T00:20:00Z" },
        { ...G03, ...drawn },
      ],
      now,
    );
    expect(defaultWeek(plans, now)).toBe(2);
  });

  it("returns null for an empty season", () => {
    expect(defaultWeek([], now)).toBeNull();
  });
});
