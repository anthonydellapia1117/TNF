// A1/A2: all 32 team palettes (primary + secondary hex from
// teampalettes.com/nfl), shipped statically — never fetched at runtime.
// Several NFL primaries are far too dark for a dark UI, so every team also
// carries a computed `display` variant, lightened just enough to clear
// WCAG 4.5:1 on the app's lightest dark surface (#1C2024) — which means it
// clears it on the darker surfaces too. tests/unit/colors.test.ts asserts
// all 32 pass. Same palette module as the sibling pool app: two apps, one
// visual language.
//
// A5: color and typography only — no logos. NFL marks are trademarked and
// this site is shared publicly; a well-set name in team color reads better
// at grid density anyway.

export interface TeamPalette {
  abbr: string;
  primary: string;
  secondary: string;
  /** Contrast-safe variant for text and small marks on dark surfaces. */
  display: string;
  /** Solid axis bar: background + the text color that reads on it. */
  bar: { bg: string; fg: string };
}

/** Back-compat shape used across the app: `color` is the display variant. */
export interface TeamInfo {
  abbr: string;
  color: string;
}

const RAW: Record<string, [abbr: string, primary: string, secondary: string]> = {
  "Arizona Cardinals": ["ARI", "#97233F", "#000000"],
  "Atlanta Falcons": ["ATL", "#A71930", "#000000"],
  "Baltimore Ravens": ["BAL", "#241773", "#9E7C0C"],
  "Buffalo Bills": ["BUF", "#00338D", "#C60C30"],
  "Carolina Panthers": ["CAR", "#0085CA", "#101820"],
  "Chicago Bears": ["CHI", "#0B162A", "#C83803"],
  "Cincinnati Bengals": ["CIN", "#FB4F14", "#000000"],
  "Cleveland Browns": ["CLE", "#311D00", "#FF3C00"],
  "Dallas Cowboys": ["DAL", "#003594", "#B0B7BC"],
  "Denver Broncos": ["DEN", "#FB4F14", "#002244"],
  "Detroit Lions": ["DET", "#0076B6", "#B0B7BC"],
  "Green Bay Packers": ["GB", "#203731", "#FFB612"],
  "Houston Texans": ["HOU", "#03202F", "#A71930"],
  "Indianapolis Colts": ["IND", "#002C5F", "#A2AAAD"],
  "Jacksonville Jaguars": ["JAX", "#101820", "#D7A22A"],
  "Kansas City Chiefs": ["KC", "#E31837", "#FFB81C"],
  "Los Angeles Chargers": ["LAC", "#0080C6", "#FFC20E"],
  "Los Angeles Rams": ["LA", "#003594", "#FFA300"],
  "Las Vegas Raiders": ["LV", "#000000", "#A5ACAF"],
  "Miami Dolphins": ["MIA", "#008E97", "#FC4C02"],
  "Minnesota Vikings": ["MIN", "#4F2683", "#FFC62F"],
  "New England Patriots": ["NE", "#002244", "#C60C30"],
  "New Orleans Saints": ["NO", "#D3BC8D", "#101820"],
  "New York Giants": ["NYG", "#0B2265", "#A71930"],
  "New York Jets": ["NYJ", "#125740", "#000000"],
  "Philadelphia Eagles": ["PHI", "#004C54", "#A5ACAF"],
  "Pittsburgh Steelers": ["PIT", "#FFB612", "#101820"],
  "Seattle Seahawks": ["SEA", "#002244", "#69BE28"],
  "San Francisco 49ers": ["SF", "#AA0000", "#B3995D"],
  "Tampa Bay Buccaneers": ["TB", "#D50A0A", "#FF7900"],
  "Tennessee Titans": ["TEN", "#0C2340", "#4B92DB"],
  "Washington Commanders": ["WAS", "#5A1414", "#FFB612"],
};

/** The page background — what axis bars must stand apart from. */
export const DARK_BG = "#0B0D0F";
/** The lightest dark surface team text must read against. */
export const DARK_SURFACE = "#1C2024";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix a color toward white until it clears `min` contrast on `bg`. */
export function ensureContrast(hex: string, bg: string, min = 4.5): string {
  if (contrastRatio(hex, bg) >= min) return hex;
  const [r, g, b] = hexToRgb(hex);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = rgbToHex(
      r + (255 - r) * t,
      g + (255 - g) * t,
      b + (255 - b) * t,
    );
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return "#ffffff";
}

// The axis bar is a large solid fill, so it uses the TRUE brand color —
// unless that color sits too close to the page background to register as a
// bar at all, in which case fall back: secondary, then the display variant
// (spec A3). Text on the bar is white or near-black, whichever reads.
const BAR_MIN = 1.6;

function barFor(primary: string, secondary: string, display: string) {
  const bg =
    contrastRatio(primary, DARK_BG) >= BAR_MIN
      ? primary
      : contrastRatio(secondary, DARK_BG) >= BAR_MIN
        ? secondary
        : display;
  const fg =
    contrastRatio("#FFFFFF", bg) >= contrastRatio(DARK_BG, bg)
      ? "#FFFFFF"
      : DARK_BG;
  return { bg, fg };
}

export const NFL_TEAMS: Record<string, TeamPalette> = Object.fromEntries(
  Object.entries(RAW).map(([name, [abbr, primary, secondary]]) => {
    // Prefer whichever brand color already reads well; lighten if neither.
    const base =
      contrastRatio(primary, DARK_SURFACE) >=
      contrastRatio(secondary, DARK_SURFACE)
        ? primary
        : secondary;
    const display = ensureContrast(base, DARK_SURFACE);
    return [
      name,
      { abbr, primary, secondary, display, bar: barFor(primary, secondary, display) },
    ];
  }),
);

const FALLBACK: TeamPalette = {
  abbr: "TBD",
  primary: "#3F4650",
  secondary: "#8A9099",
  display: "#8A9099",
  bar: { bg: "#3F4650", fg: "#FFFFFF" },
};

function abbreviate(name: string): string {
  if (!name || name.toUpperCase() === "TBD") return "TBD";
  const words = name.split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 3)
  )
    .toUpperCase()
    .slice(0, 3);
}

/** Full palette for a team; safe fallback for unknown names. */
export function teamPalette(name: string): TeamPalette {
  return NFL_TEAMS[name] ?? { ...FALLBACK, abbr: abbreviate(name) };
}

/** Back-compat accessor: `color` is the contrast-safe display variant. */
export function teamInfo(name: string): TeamInfo {
  const p = teamPalette(name);
  return { abbr: p.abbr, color: p.display };
}

/** "DAL @ WAS" — the game sub-tab label. */
export function matchupLabel(away: string, home: string): string {
  return `${teamPalette(away).abbr} @ ${teamPalette(home).abbr}`;
}
