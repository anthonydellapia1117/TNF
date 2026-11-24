import { describe, expect, it } from "vitest";
import {
  defaultGridGame,
  matchBlocks,
  matchDigits,
  matchSummary,
  normalizeQuery,
} from "@/lib/grid-search";
import { contrastRatio } from "@/lib/nfl";
import {
  SEARCH_BORDER,
  SEARCH_FILL,
  SEARCH_FILL_TEXT,
} from "@/lib/search-colors";
import type { PublicGame } from "@/lib/types";

// The board as v_public_blocks showed it on 2026-11-24: block number and the
// name the board shows, nothing else. Every name here is already public on
// /grid and /players.
const BOARD: [number, string][] = [
  [1, "nerdz"],
  [2, "Cappy Lay"],
  [3, "AAA"],
  [4, "Sal"],
  [5, "Marc Franklin"],
  [6, "Eddie/richie"],
  [7, "E. Nards"],
  [8, "LZ"],
  [9, "Ed D"],
  [10, "E. Nards"],
  [11, "Scro"],
  [12, "Philadelphia Poultry"],
  [13, "EAGLESFOR50"],
  [14, "Sr Rex"],
  [15, "Nicco Esgro"],
  [16, "RO"],
  [17, "Ed D"],
  [18, "mike capelli"],
  [19, "Cappy Lay"],
  [20, "Pellegrino"],
  [21, "Captain"],
  [22, "Meatballs"],
  [23, "PAAA M"],
  [24, "Nicco Esgro"],
  [25, "Philadelphia Poultry"],
  [26, "Gab"],
  [27, "Gurt"],
  [28, "Scro"],
  [29, "ILM!"],
  [30, "TNat"],
  [31, "E. Spec"],
  [32, "nerdz"],
  [33, "Jpg"],
  [34, "T"],
  [35, "Astorga"],
  [36, "Jr/Diz"],
  [37, "Mario Tropea Jr."],
  [38, "Jr/Diz"],
  [39, "Sal"],
  [40, "JA Paint"],
  [41, "EAGLESFOR50"],
  [42, "Ed D"],
  [43, "mike capelli"],
  [44, "Meatballs"],
  [45, "Dan DeSilvio"],
  [46, "Francomb Contracting"],
  [47, "mike capelli"],
  [48, "RO"],
  [49, "E. Spec"],
  [50, "T"],
  [51, "Gurt"],
  [52, "Sr Rex"],
  [53, "Gab"],
  [54, "BHee"],
  [55, "Perry T"],
  [56, "AG"],
  [57, "JA Paint"],
  [58, "A. Capelli"],
  [59, "E. Spec"],
  [60, "Perry T"],
  [61, "AG"],
  [62, "E. Spec"],
  [63, "Frank Animal"],
  [64, "Jr/Diz"],
  [65, "Jpg"],
  [66, "Perry T"],
  [67, "ILM!"],
  [68, "Galle Electric"],
  [69, "Eddie/richie"],
  [70, "M & M"],
  [71, "Joe Longo"],
  [72, "Pellegrino"],
  [73, "Astorga"],
  [74, "Billy Fulg"],
  [75, "Siggee"],
  [76, "BHee"],
  [77, "M & M"],
  [78, "A. Capelli"],
  [79, "Marc M"],
  [80, "Frank Animal"],
  [81, "LZ"],
  [82, "mike capelli"],
  [83, "Billy Fulg"],
  [84, "Ed D"],
  [85, "Galle Electric"],
  [86, "G/Hollywood"],
  [87, "Francomb Contracting"],
  [88, "Slav"],
  [89, "Siggee"],
  [90, "Jr/Diz"],
  [91, "Mario Tropea Jr."],
  [92, "TNat"],
  [93, "Rob Gambino"],
  [94, "PRESTIGE PULLZ"],
  [95, "Captain"],
  [96, "Perry T"],
  [97, "Marc M"],
  [98, "G/Hollywood"],
  [99, "Rob Gambino"],
  [100, "Joe Longo"],
];
const blocks = BOARD.map(([block_number, display_name]) => ({
  block_number,
  display_name,
}));

describe("the /grid name search (Part Q)", () => {
  it("narrows live: A, then AA, then AAA leaves exactly 3 (AAA) and 23 (PAAA M)", () => {
    const a = matchBlocks(blocks, "A");
    const aa = matchBlocks(blocks, "AA");
    const aaa = matchBlocks(blocks, "AAA");
    expect(a.length).toBeGreaterThan(aa.length);
    expect(aa.every((n) => a.includes(n))).toBe(true);
    expect(aaa.every((n) => aa.includes(n))).toBe(true);
    expect(aaa).toEqual([3, 23]);
    expect(matchSummary(aaa)).toBe("2 blocks: 3, 23");
  });

  it("clearing leaves none: empty or blank matches no block", () => {
    expect(matchBlocks(blocks, "")).toEqual([]);
    expect(matchBlocks(blocks, "   ")).toEqual([]);
    expect(normalizeQuery("  AaA ")).toBe("aaa");
  });

  it("is case-insensitive and matches any part of the shown name", () => {
    expect(matchBlocks(blocks, "aaa")).toEqual([3, 23]);
    expect(matchBlocks(blocks, "NERDZ")).toEqual([1, 32]);
    expect(matchBlocks(blocks, "poultry")).toEqual([12, 25]);
    expect(matchBlocks(blocks, " capelli ")).toEqual([18, 43, 47, 58, 78, 82]);
  });

  it("searches only the name on the board, never a real name that is not shown", () => {
    const withHidden = [
      {
        block_number: 1,
        display_name: "nerdz",
        full_name: "Raychel Neil",
        email: "x@y",
      },
      { block_number: 2, display_name: null, full_name: "Somebody Open" },
    ];
    expect(matchBlocks(withHidden, "Raychel")).toEqual([]);
    expect(matchBlocks(withHidden, "x@y")).toEqual([]);
    expect(matchBlocks(withHidden, "Somebody")).toEqual([]);
    expect(matchBlocks(withHidden, "nerd")).toEqual([1]);
  });

  it("says how many and which", () => {
    expect(matchSummary([])).toBe("No blocks match");
    expect(matchSummary([7])).toBe("1 block: 7");
  });

  it("gives each match its row (away) and column (home) digit for the game shown", () => {
    const g01 = {
      row_digits: [4, 9, 5, 7, 6, 3, 0, 1, 2, 8],
      col_digits: [4, 3, 2, 8, 1, 6, 7, 9, 0, 5],
    };
    expect(matchDigits(3, g01)).toEqual({ away: 4, home: 2 });
    expect(matchDigits(23, g01)).toEqual({ away: 5, home: 2 });
    expect(matchDigits(3, { row_digits: null, col_digits: null })).toBeNull();
  });

  it("reads outdoors: dark text on the yellow, a darker border", () => {
    expect(contrastRatio(SEARCH_FILL_TEXT, SEARCH_FILL)).toBeGreaterThanOrEqual(
      7,
    );
    expect(contrastRatio(SEARCH_BORDER, SEARCH_FILL)).toBeGreaterThanOrEqual(3);
  });
});

const game = (
  game_no: number,
  kickoff_at: string,
  status: PublicGame["status"] = "scheduled",
): PublicGame => ({
  id: `g${game_no}`,
  game_no,
  week: 12,
  kickoff_at,
  date_confirmed: true,
  game_type: "holiday",
  holiday_label: null,
  home_team: "Home",
  away_team: "Away",
  network: null,
  row_digits: null,
  col_digits: null,
  digits_assigned: false,
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
  status,
});
// The 2026 holiday kickoffs, in UTC.
const SLATE = () => [
  game(1, "2026-11-26T01:00:00+00:00", "published"), // Wed Nov 25 8:00 PM ET
  game(2, "2026-11-26T18:00:00+00:00"), // Thu 1:00 PM
  game(3, "2026-11-26T21:30:00+00:00"), // Thu 4:30 PM
  game(4, "2026-11-27T01:20:00+00:00"), // Thu 8:20 PM ET
  game(5, "2026-11-27T20:00:00+00:00"), // Fri 3:00 PM
  game(6, "2026-12-25T01:15:00+00:00"), // Thu Dec 24 8:15 PM ET
];
const pick = (games: PublicGame[], now: string) =>
  defaultGridGame(games, now)?.game_no;

describe("the game /grid opens on (Part Q)", () => {
  it("before the first game day: the next game", () => {
    expect(pick(SLATE(), "2026-11-24T15:00:00Z")).toBe(1);
  });

  it("on a game day: today's game, before and after it is final that night", () => {
    expect(pick(SLATE(), "2026-11-25T14:10:00Z")).toBe(1);
    const s = SLATE();
    s[0].status = "final";
    expect(pick(s, "2026-11-26T04:30:00Z")).toBe(1); // 11:30 PM ET Wed, G01 final
  });

  it("Thanksgiving goes by kickoff, not status: every game stays published until the day is final", () => {
    const s = SLATE();
    s[0].status = "final";
    expect(pick(s, "2026-11-26T14:00:00Z")).toBe(2); // 9:00 AM ET, nothing kicked off
    expect(pick(s, "2026-11-26T20:00:00Z")).toBe(2); // 3:00 PM, G02 on
    expect(pick(s, "2026-11-26T21:45:00Z")).toBe(3); // 4:45 PM, G03 kicked off, G02 still published
    expect(pick(s, "2026-11-27T02:00:00Z")).toBe(4); // 9:00 PM, G04 on, all three published
    for (const g of s) g.status = "final";
    expect(pick(s, "2026-11-27T04:59:00Z")).toBe(4); // 11:59 PM ET, all final
  });

  it("a game being played wins over everything", () => {
    const s = SLATE();
    s[0].status = "in_progress";
    expect(pick(s, "2026-11-26T05:30:00Z")).toBe(1); // 12:30 AM ET Thu, G01 still going
  });

  it("between game days: the next game to be played, never a void one", () => {
    const s = SLATE().map((g) => ({
      ...g,
      status: g.game_no <= 5 ? ("final" as const) : g.status,
    }));
    expect(pick(s, "2026-12-01T12:00:00Z")).toBe(6);
    s[5].status = "void";
    expect(pick(s, "2026-12-01T12:00:00Z")).toBe(5);
  });
});
