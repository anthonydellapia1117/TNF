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
