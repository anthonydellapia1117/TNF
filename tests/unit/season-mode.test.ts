import { describe, expect, it } from "vitest";
import {
  dashboardPanels,
  isSeasonMode,
  PRESEASON_PANELS,
  SEASON_PANELS,
  showsPanel,
  type DashboardPanel,
} from "@/lib/season-mode";
import type { PoolConfig } from "@/lib/types";

const WITH_GAME = { hasNextGame: true };

describe("isSeasonMode", () => {
  it("is off by default — nothing changes until it is flipped", () => {
    expect(isSeasonMode({ season_mode: false })).toBe(false);
  });

  it("is on only for a literal true", () => {
    expect(isSeasonMode({ season_mode: true })).toBe(true);
  });

  it("treats a missing or unreadable config as off, never on", () => {
    expect(isSeasonMode(null)).toBe(false);
    expect(isSeasonMode(undefined)).toBe(false);
    // A row read before migration 15 simply has no column.
    expect(isSeasonMode({} as Pick<PoolConfig, "season_mode">)).toBe(false);
  });

  it("requires the real boolean — a truthy string does not turn it on", () => {
    // config.season_mode is `boolean not null`, so Postgres and PostgREST
    // always hand over a real true/false. Anything else arrived through a
    // path that does not exist, and the string "false" is the exact value a
    // loose truthy check would read as ON. Only a literal true counts.
    const truthy = ["true", "false", 1, "1", {}] as unknown[];
    for (const v of truthy) {
      expect(
        isSeasonMode({ season_mode: v } as Pick<PoolConfig, "season_mode">),
      ).toBe(false);
    }
  });
});

describe("dashboardPanels — nothing administrative is even expressible", () => {
  // Collection status, blocks committed and the claim CTA are not viewer
  // panels any more, in either mode. The strongest form of that guarantee is
  // that DashboardPanel has no name for them, so these strings cannot be
  // returned by construction — this test pins the intent in case someone
  // widens the type later.
  const ADMIN_ONLY = ["collected", "blocks_committed", "claim_cta"];

  it("never returns a collection, committed-count or claim panel", () => {
    for (const mode of [true, false]) {
      for (const hasNextGame of [true, false]) {
        const panels: string[] = dashboardPanels(mode, { hasNextGame });
        for (const forbidden of ADMIN_ONLY) {
          expect(panels).not.toContain(forbidden);
        }
      }
    }
  });
});

describe("dashboardPanels — season mode ON", () => {
  const panels = dashboardPanels(true, WITH_GAME);

  it("leads with the next game, its reveal, and the holiday ahead", () => {
    expect(panels).toEqual<DashboardPanel[]>([
      "hero",
      "next_reveal",
      "holiday_next",
      "grid_link",
      "recent_winners",
      "season_so_far",
      "hot_digits",
      "close_calls",
      "hot_cells",
    ]);
  });

  it("drops the pre-season panels and adds the season ones", () => {
    for (const p of PRESEASON_PANELS) expect(showsPanel(panels, p)).toBe(false);
    for (const p of SEASON_PANELS) expect(showsPanel(panels, p)).toBe(true);
  });
});

describe("dashboardPanels — season mode OFF", () => {
  const panels = dashboardPanels(false, WITH_GAME);

  it("keeps the claim-by deadline and holds back the grid panel", () => {
    for (const p of PRESEASON_PANELS) expect(showsPanel(panels, p)).toBe(true);
    for (const p of SEASON_PANELS) expect(showsPanel(panels, p)).toBe(false);
  });

  it("still opens on the next game", () => {
    expect(panels[0]).toBe("hero");
  });
});

describe("dashboardPanels — the fan panels are unconditional", () => {
  const FAN: DashboardPanel[] = [
    "recent_winners",
    "season_so_far",
    "hot_digits",
    "close_calls",
    "hot_cells",
    "holiday_next",
    "next_reveal",
  ];

  it("shows every fan panel in both modes, game or no game", () => {
    for (const mode of [true, false]) {
      for (const hasNextGame of [true, false]) {
        const panels = dashboardPanels(mode, { hasNextGame });
        for (const p of FAN) expect(showsPanel(panels, p)).toBe(true);
      }
    }
  });
});

describe("dashboardPanels — shape guarantees", () => {
  it("omits the hero when there is no next game, in both modes", () => {
    for (const mode of [true, false]) {
      const p = dashboardPanels(mode, { hasNextGame: false });
      expect(showsPanel(p, "hero")).toBe(false);
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it("never repeats a panel", () => {
    for (const mode of [true, false]) {
      for (const hasNextGame of [true, false]) {
        const p = dashboardPanels(mode, { hasNextGame });
        expect(new Set(p).size).toBe(p.length);
      }
    }
  });

  it("differs between modes only by the two mode-specific panels", () => {
    const on = new Set(dashboardPanels(true, WITH_GAME));
    const off = new Set(dashboardPanels(false, WITH_GAME));
    const onlyOn = [...on].filter((p) => !off.has(p));
    const onlyOff = [...off].filter((p) => !on.has(p));
    expect(onlyOn).toEqual([...SEASON_PANELS]);
    expect(onlyOff).toEqual([...PRESEASON_PANELS]);
  });
});
