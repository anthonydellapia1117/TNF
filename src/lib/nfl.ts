// All 32 NFL teams: abbreviation plus a display color tuned to stay legible
// on the dark surface (#0B0D0F). Where an official primary is too dark
// (navies, midnight greens), the team's brighter secondary carries the axis.

export interface TeamInfo {
  abbr: string;
  color: string;
}

export const NFL_TEAMS: Record<string, TeamInfo> = {
  "Arizona Cardinals": { abbr: "ARI", color: "#D64562" },
  "Atlanta Falcons": { abbr: "ATL", color: "#E31837" },
  "Baltimore Ravens": { abbr: "BAL", color: "#8B7BE8" },
  "Buffalo Bills": { abbr: "BUF", color: "#3B6EF5" },
  "Carolina Panthers": { abbr: "CAR", color: "#0085CA" },
  "Chicago Bears": { abbr: "CHI", color: "#E64B14" },
  "Cincinnati Bengals": { abbr: "CIN", color: "#FB4F14" },
  "Cleveland Browns": { abbr: "CLE", color: "#FF3C00" },
  "Dallas Cowboys": { abbr: "DAL", color: "#5C8AE6" },
  "Denver Broncos": { abbr: "DEN", color: "#FB4F14" },
  "Detroit Lions": { abbr: "DET", color: "#0076B6" },
  "Green Bay Packers": { abbr: "GB", color: "#FFB612" },
  "Houston Texans": { abbr: "HOU", color: "#D93A4E" },
  "Indianapolis Colts": { abbr: "IND", color: "#4D82D6" },
  "Jacksonville Jaguars": { abbr: "JAX", color: "#00A9B5" },
  "Kansas City Chiefs": { abbr: "KC", color: "#E31837" },
  "Las Vegas Raiders": { abbr: "LV", color: "#A5ACAF" },
  "Los Angeles Chargers": { abbr: "LAC", color: "#0080C6" },
  "Los Angeles Rams": { abbr: "LA", color: "#FFA300" },
  "Miami Dolphins": { abbr: "MIA", color: "#00B8C4" },
  "Minnesota Vikings": { abbr: "MIN", color: "#9B7BEA" },
  "New England Patriots": { abbr: "NE", color: "#D6304A" },
  "New Orleans Saints": { abbr: "NO", color: "#D3BC8D" },
  "New York Giants": { abbr: "NYG", color: "#4D6FE8" },
  "New York Jets": { abbr: "NYJ", color: "#1FA36B" },
  "Philadelphia Eagles": { abbr: "PHI", color: "#17B0A6" },
  "Pittsburgh Steelers": { abbr: "PIT", color: "#FFB612" },
  "San Francisco 49ers": { abbr: "SF", color: "#E0453B" },
  "Seattle Seahawks": { abbr: "SEA", color: "#69BE28" },
  "Tampa Bay Buccaneers": { abbr: "TB", color: "#E23636" },
  "Tennessee Titans": { abbr: "TEN", color: "#4B92DB" },
  "Washington Commanders": { abbr: "WAS", color: "#C15062" },
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
