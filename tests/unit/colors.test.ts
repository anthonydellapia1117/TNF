import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DARK_BG,
  DARK_SURFACE,
  ensureContrast,
  NFL_TEAMS,
  teamPalette,
} from "@/lib/nfl";

const TEAMS = Object.entries(NFL_TEAMS);

describe("team palette (spec A1/A2)", () => {
  it("ships all 32 teams", () => {
    expect(TEAMS.length).toBe(32);
  });

  it("every display variant clears WCAG 4.5:1 on the dark surfaces", () => {
    for (const [name, p] of TEAMS) {
      // The page background (#0B0D0F, spec A2)…
      expect(
        contrastRatio(p.display, DARK_BG),
        `${name} display on ${DARK_BG}`,
      ).toBeGreaterThanOrEqual(4.5);
      // …the card surface, and the lightest surface — all must pass.
      expect(
        contrastRatio(p.display, "#14171A"),
        `${name} display on #14171A`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(p.display, DARK_SURFACE),
        `${name} display on ${DARK_SURFACE}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("axis bar text clears 4.5:1 on its bar fill for all 32", () => {
    for (const [name, p] of TEAMS) {
      expect(
        contrastRatio(p.bar.fg, p.bar.bg),
        `${name} bar text on bar`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every axis bar registers against the page background", () => {
    for (const [name, p] of TEAMS) {
      expect(
        contrastRatio(p.bar.bg, DARK_BG),
        `${name} bar vs background`,
      ).toBeGreaterThanOrEqual(1.6);
    }
  });

  it("keeps the true brand colors alongside the display variant", () => {
    // Bears navy is nearly the page background — display must be lightened,
    // primary must stay the real brand color.
    const chi = teamPalette("Chicago Bears");
    expect(chi.primary).toBe("#0B162A");
    expect(contrastRatio(chi.primary, DARK_BG)).toBeLessThan(1.6);
    expect(chi.display).not.toBe(chi.primary);
    // A bright primary passes through untouched.
    const kc = teamPalette("Kansas City Chiefs");
    expect(kc.primary).toBe("#E31837");
  });

  it("ensureContrast returns the input when it already passes", () => {
    expect(ensureContrast("#FFB612", DARK_SURFACE)).toBe("#FFB612");
  });

  it("falls back safely for unknown teams", () => {
    const p = teamPalette("TBD");
    expect(p.abbr).toBe("TBD");
    expect(contrastRatio(p.display, DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("winner treatment contrast (grid item 3)", () => {
  it("every winner pairing clears WCAG 4.5:1", async () => {
    const { contrastRatio, bestTextOn } = await import("@/lib/nfl");
    const {
      WIN_OUTLINE,
      WIN_FILL,
      WIN_FILL_TEXT,
      WIN_OUTLINE_ON_FILL,
      BADGE_BG,
      BADGE_TEXT,
    } = await import("@/lib/winner-colors");
    const PAGE_BG = "#0B0D0F";
    // Green outline on the dark page.
    expect(contrastRatio(WIN_OUTLINE, PAGE_BG)).toBeGreaterThanOrEqual(4.5);
    // Both-winners outline shade, on the page and against the fill it sits on.
    expect(contrastRatio(WIN_OUTLINE_ON_FILL, PAGE_BG)).toBeGreaterThanOrEqual(4.5);
    // Recolored text on the green fill — computed, and it must clear.
    expect(WIN_FILL_TEXT).toBe(bestTextOn(WIN_FILL));
    expect(contrastRatio(WIN_FILL_TEXT, WIN_FILL)).toBeGreaterThanOrEqual(4.5);
    // Badge text on both badge backgrounds.
    expect(contrastRatio(BADGE_TEXT, BADGE_BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(WIN_FILL_TEXT, WIN_FILL)).toBeGreaterThanOrEqual(4.5);
  });

  it("bestTextOn always returns the higher-contrast of white and near-black", async () => {
    const { contrastRatio, bestTextOn } = await import("@/lib/nfl");
    for (const bg of ["#10B981", "#FFFFFF", "#0B0D0F", "#F59E0B", "#4F7CFF"]) {
      const pick = bestTextOn(bg);
      const other = pick === "#FFFFFF" ? "#0B0D0F" : "#FFFFFF";
      expect(contrastRatio(pick, bg)).toBeGreaterThanOrEqual(
        contrastRatio(other, bg),
      );
    }
  });
});
