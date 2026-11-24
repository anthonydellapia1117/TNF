import { describe, expect, it } from "vitest";
import {
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

// Part N (Anthony, 2026-11-23): one day at a time. A game is drawn only on
// its own ET kickoff date, before kickoff, and published at once.
const TG1 = game({ game_no: 1, week: 12, kickoff_at: "2026-11-26T01:00:00Z" }); // Wed Nov 25 8:00 PM ET
const TG2 = game({ game_no: 2, week: 12, kickoff_at: "2026-11-26T18:00:00Z" }); // Thu Nov 26 1:00 PM ET
const TG4 = game({ game_no: 4, week: 12, kickoff_at: "2026-11-27T01:20:00Z" }); // Thu Nov 26 8:20 PM ET
const TG5 = game({ game_no: 5, week: 12, kickoff_at: "2026-11-27T20:00:00Z" }); // Fri Nov 27 3:00 PM ET

describe("the game-day window", () => {
  it("refuses a game on any day but its own and names it and the unlock time", () => {
    // Wed Nov 25 9:10 AM ET: G02 is Thursday's.
    const refusal = windowRefusal(TG2, ms("2026-11-25T14:10:00Z"));
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("G02");
    expect(refusal).toContain("drawn on game day only");
    expect(refusal).toContain("Thu, Nov 26, 12:00 AM ET"); // midnight ET starting its day
  });

  it("allows a game on its own ET date, the evening game included", () => {
    // G01 kicks off Thu 01:00 UTC, which is Wed 8:00 PM ET: Wednesday's game.
    expect(windowRefusal(TG1, ms("2026-11-25T14:10:00Z"))).toBeNull();
    // G04 kicks off Fri 01:20 UTC, which is Thu 8:20 PM ET: Thursday's game.
    expect(windowRefusal(TG4, ms("2026-11-26T14:10:00Z"))).toBeNull();
    expect(windowRefusal(TG4, ms("2026-11-25T14:10:00Z"))).not.toBeNull();
  });

  it("puts the boundary at midnight ET, in EST", () => {
    // Thu Nov 26 00:00 ET is 05:00 UTC.
    expect(windowRefusal(TG2, ms("2026-11-26T04:59:59.999Z"))).not.toBeNull();
    expect(windowRefusal(TG2, ms("2026-11-26T05:00:00Z"))).toBeNull();
    expect(assignUnlockISO(TG2)).toBe("2026-11-26T05:00:00.000Z");
  });

  it("never opens a week early: the old 7-day window is gone", () => {
    // Fri Nov 20 3:00 PM ET opened week 12 under the week rule; now nothing is drawable.
    const plan = weekPlan(12, [TG1, TG2, TG4, TG5], ms("2026-11-20T20:00:00Z"));
    expect(plan.toAssign).toEqual([]);
    expect(plan.assign.ok).toBe(false);
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
  it("draws only today's games: Wednesday is G01 and nothing else", () => {
    const plan = weekPlan(12, [TG1, TG2, TG4, TG5], ms("2026-11-25T14:10:00Z"));
    expect(plan.toAssign.map((g) => g.game_no)).toEqual([1]);
    expect(plan.blocked.map((b) => `${b.game.game_no}:${b.reason}`)).toEqual([
      "2:drawn on game day, Thu, Nov 26",
      "4:drawn on game day, Thu, Nov 26",
      "5:drawn on game day, Fri, Nov 27",
    ]);
    expect(plan.assign.ok).toBe(true);
  });

  it("draws Thursday's three on Thursday, never Wednesday's again", () => {
    const g1 = { ...TG1, digits_assigned_at: "2026-11-25T14:10:00Z", digits_published_at: "2026-11-25T14:10:00Z" };
    const g3 = game({ game_no: 3, week: 12, kickoff_at: "2026-11-26T21:30:00Z" });
    const plan = weekPlan(12, [g1, TG2, g3, TG4, TG5], ms("2026-11-26T14:10:00Z"));
    expect(plan.toAssign.map((g) => g.game_no)).toEqual([2, 3, 4]);
    expect(plan.blocked.map((b) => b.game.game_no)).toEqual([5]);
    expect(plan.toSchedule).toEqual([]);
  });

  it("mirrors the RPC's own gates as blocked reasons", () => {
    const now = ms("2026-09-03T08:16:00Z");
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
    const drawn = { ...TG1, digits_assigned_at: "2026-11-25T14:10:00Z" };
    const plan = weekPlan(12, [drawn], ms("2026-11-25T15:00:00Z"));
    expect(plan.assign.ok).toBe(false);
    expect(plan.assign.ok === false && plan.assign.reason).toContain("already drawn");
  });

  it("publishes a drawn-but-unpublished game at once, never at a later slot", () => {
    const plan = weekPlan(12, [{ ...TG1, digits_assigned_at: "2026-11-25T14:10:00Z" }], ms("2026-11-25T14:11:00Z"));
    expect(plan.toSchedule.map((r) => r.game.game_no)).toEqual([1]);
    expect(plan.toSchedule[0].immediate).toBe(true);
    expect(plan.toSchedule[0].revealAtISO).toBeNull();
  });

  it("leaves an already-published game out of the publish queue", () => {
    const plan = weekPlan(
      12,
      [{ ...TG1, digits_assigned_at: "2026-11-25T14:10:00Z", digits_published_at: "2026-11-25T14:10:00Z" }],
      ms("2026-11-25T15:00:00Z"),
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
