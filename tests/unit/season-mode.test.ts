import { describe, expect, it } from "vitest";
import {
  dashboardPanels,
  isSeasonMode,
  SALES_PANELS,
  showsPanel,
  type DashboardPanel,
} from "@/lib/season-mode";
import type { PoolConfig } from "@/lib/types";

const OPEN = { hasNextGame: true, openBlocks: 51 };
const SOLD_OUT = { hasNextGame: true, openBlocks: 0 };

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

describe("dashboardPanels — season mode ON", () => {
  const panels = dashboardPanels(true, OPEN);

  it("drops every sales panel, even with 51 blocks open", () => {
    for (const sales of SALES_PANELS) {
      expect(showsPanel(panels, sales)).toBe(false);
    }
  });

  it("leads with the next game, the grid, then recent winners", () => {
    expect(panels).toEqual<DashboardPanel[]>([
      "hero",
      "next_reveal",
      "grid_link",
      "recent_winners",
      "season_so_far",
      "hot_digits",
    ]);
  });

  it("keeps the season's own story — winners, recap, hot digits", () => {
    expect(showsPanel(panels, "recent_winners")).toBe(true);
    expect(showsPanel(panels, "season_so_far")).toBe(true);
    expect(showsPanel(panels, "hot_digits")).toBe(true);
    expect(showsPanel(panels, "next_reveal")).toBe(true);
  });

  it("shows no open count whether blocks are open or not", () => {
    for (const opts of [OPEN, SOLD_OUT]) {
      const p = dashboardPanels(true, opts);
      expect(showsPanel(p, "claim_cta")).toBe(false);
      expect(showsPanel(p, "blocks_committed")).toBe(false);
    }
  });
});

describe("dashboardPanels — season mode OFF (today's page)", () => {
  const panels = dashboardPanels(false, OPEN);

  it("keeps the sales framing intact", () => {
    for (const sales of SALES_PANELS) {
      expect(showsPanel(panels, sales)).toBe(true);
    }
  });

  it("still opens on the next game", () => {
    expect(panels[0]).toBe("hero");
  });

  it("hides the claim CTA when nothing is open, but keeps the rest", () => {
    const p = dashboardPanels(false, SOLD_OUT);
    expect(showsPanel(p, "claim_cta")).toBe(false);
    expect(showsPanel(p, "blocks_committed")).toBe(true);
    expect(showsPanel(p, "collected")).toBe(true);
  });
});

describe("dashboardPanels — shape guarantees", () => {
  it("omits the hero when there is no next game, in both modes", () => {
    for (const mode of [true, false]) {
      const p = dashboardPanels(mode, { hasNextGame: false, openBlocks: 51 });
      expect(showsPanel(p, "hero")).toBe(false);
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it("never repeats a panel", () => {
    for (const mode of [true, false]) {
      for (const opts of [OPEN, SOLD_OUT]) {
        const p = dashboardPanels(mode, opts);
        expect(new Set(p).size).toBe(p.length);
      }
    }
  });

  it("adds nothing but the grid link, and never a sales panel", () => {
    // Season mode is a subset of the off-season page plus exactly one new
    // panel: the grid link. Off-season the hero already carries a "View the
    // grid" link, so a standalone grid panel only exists once the dashboard
    // has stopped selling and the grid is the point.
    const off = new Set(dashboardPanels(false, OPEN));
    const added = dashboardPanels(true, OPEN).filter((p) => !off.has(p));
    expect(added).toEqual<DashboardPanel[]>(["grid_link"]);
    for (const p of added) {
      expect(SALES_PANELS).not.toContain(p);
    }
  });
});
