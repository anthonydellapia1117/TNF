// All 32 NFL teams: abbreviation plus a display color tuned to stay legible
// on the dark surface (#0B0D0F). Where an official primary is too dark
// (navies, midnight greens), the team's brighter secondary carries the axis.

export interface TeamInfo {
  abbr: string;
  color: string;
}

// Every color clears WCAG 4.5:1 against the surface (#14171A), so team-
// colored text passes contrast at any size the app uses.
export const NFL_TEAMS: Record<string, TeamInfo> = {
  "Arizona Cardinals": { abbr: "ARI", color: "#D9546F" },
  "Atlanta Falcons": { abbr: "ATL", color: "#E8425B" },
  "Baltimore Ravens": { abbr: "BAL", color: "#8B7BE8" },
  "Buffalo Bills": { abbr: "BUF", color: "#4B7AF6" },
  "Carolina Panthers": { abbr: "CAR", color: "#0587CB" },
  "Chicago Bears": { abbr: "CHI", color: "#E64B14" },
  "Cincinnati Bengals": { abbr: "CIN", color: "#FB4F14" },
  "Cleveland Browns": { abbr: "CLE", color: "#FF3C00" },
  "Dallas Cowboys": { abbr: "DAL", color: "#5C8AE6" },
  "Denver Broncos": { abbr: "DEN", color: "#FB4F14" },
  "Detroit Lions": { abbr: "DET", color: "#2489C0" },
  "Green Bay Packers": { abbr: "GB", color: "#FFB612" },
  "Houston Texans": { abbr: "HOU", color: "#DD4E60" },
  "Indianapolis Colts": { abbr: "IND", color: "#4D82D6" },
  "Jacksonville Jaguars": { abbr: "JAX", color: "#00A9B5" },
  "Kansas City Chiefs": { abbr: "KC", color: "#E8425B" },
  "Las Vegas Raiders": { abbr: "LV", color: "#A5ACAF" },
  "Los Angeles Chargers": { abbr: "LAC", color: "#0F88C9" },
  "Los Angeles Rams": { abbr: "LA", color: "#FFA300" },
  "Miami Dolphins": { abbr: "MIA", color: "#00B8C4" },
  "Minnesota Vikings": { abbr: "MIN", color: "#9B7BEA" },
  "New England Patriots": { abbr: "NE", color: "#DD5167" },
  "New Orleans Saints": { abbr: "NO", color: "#D3BC8D" },
  "New York Giants": { abbr: "NYG", color: "#5B7BEA" },
  "New York Jets": { abbr: "NYJ", color: "#1FA36B" },
  "Philadelphia Eagles": { abbr: "PHI", color: "#17B0A6" },
  "Pittsburgh Steelers": { abbr: "PIT", color: "#FFB612" },
  "San Francisco 49ers": { abbr: "SF", color: "#E14C43" },
  "Seattle Seahawks": { abbr: "SEA", color: "#69BE28" },
  "Tampa Bay Buccaneers": { abbr: "TB", color: "#E54A4A" },
  "Tennessee Titans": { abbr: "TEN", color: "#4B92DB" },
  "Washington Commanders": { abbr: "WAS", color: "#C76272" },
};

const FALLBACK: TeamInfo = { abbr: "TBD", color: "#8A9099" };

export function teamInfo(name: string): TeamInfo {
  return NFL_TEAMS[name] ?? { ...FALLBACK, abbr: abbreviate(name) };
}

function abbreviate(name: string): string {
  if (!name || name.toUpperCase() === "TBD") return "TBD";
  const words = name.split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? words.map((w) => w[0]).join("")
      : name.slice(0, 3)
  ).toUpperCase().slice(0, 3);
}

/** "DAL @ WAS" — the game sub-tab label (spec 4.1). */
export function matchupLabel(away: string, home: string): string {
  return `${teamInfo(away).abbr} @ ${teamInfo(home).abbr}`;
}
