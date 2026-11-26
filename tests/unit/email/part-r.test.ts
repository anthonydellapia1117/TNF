import { describe, expect, it } from "vitest";
import { renderEvent } from "@/lib/email/registry";
import { blockListLines } from "@/lib/email/events/day";
import { lintEmail } from "@/lib/email/lint";
import { buildMime } from "@/lib/email/mime";
import { gridImageModel } from "@/lib/grid-image";
import type { BlockListEntry, CommonFacts, DayFacts } from "@/lib/email/types";
import type { PublicBlock, PublicGame } from "@/lib/types";
import { COMMON, ctx, dayGame } from "./fixtures";

// Part R (Anthony, 2026-11-25 8:20 PM ET): the game-day email carries, per
// game, a grid picture in Comfortable view, then all 100 blocks, one line
// each, with names and emails. The repo is public: every address in these
// fixtures is fake (.test), and nothing here is a real person's.

const C250: CommonFacts = {
  ...COMMON,
  price_per_block_cents: 25000,
  holiday_halftime_cents: 75000,
  holiday_final_cents: 150000,
  regular_halftime_cents: 75000,
  regular_final_cents: 150000,
  as_of_et: "2026-11-26",
};

const ROWS = [4, 0, 7, 1, 9, 2, 8, 5, 3, 6];
const COLS = [2, 9, 0, 6, 3, 8, 1, 7, 5, 4];
const pub = (over: Parameters<typeof dayGame>[0]) =>
  dayGame({ status: "published", published: true, digits_ok: true, row_digits: ROWS, col_digits: COLS, ...over });

/** Thanksgiving: G02, G03 and G04, as the 9:10 run sends them. */
const THANKSGIVING: DayFacts = {
  date: "2026-11-26",
  games: [
    pub({ game_no: 2, kickoff_at: "2026-11-26T18:00:00+00:00", away_team: "Chicago Bears", home_team: "Detroit Lions", network: "CBS" }),
    pub({ game_no: 3, kickoff_at: "2026-11-26T21:30:00+00:00", away_team: "Philadelphia Eagles", home_team: "Dallas Cowboys", network: "FOX" }),
    pub({ game_no: 4, kickoff_at: "2026-11-27T01:20:00+00:00", away_team: "Kansas City Chiefs", home_team: "Buffalo Bills", network: "NBC" }),
  ],
};

function entries(over: Record<number, Partial<BlockListEntry>> = {}): BlockListEntry[] {
  return Array.from({ length: 100 }, (_, i) => {
    const block = i + 1;
    return { block, board: `Name${block}`, real: `Real Person ${block}`, email: `holder${block}@tnf.test`, ...over[block] };
  });
}

const render = (list: BlockListEntry[] | undefined, args: Record<string, string> = {}, day = THANKSGIVING) =>
  renderEvent(ctx("gameday_2026-11-26", { common: C250, day, ...(list ? { block_list: list } : {}) }), args);

describe("the block list lines", () => {
  it('is "<block> - <board name> (<real name, only if different>) - <email, or no email on file>"', () => {
    const lines = blockListLines(
      entries({
        1: { board: "nerdz", real: "Raychel Neil", email: "r@tnf.test" },
        2: { board: "Cappy Lay", real: "Cappy Lay", email: null },
        3: { board: "AAA", real: "aaa", email: "A@TNF.TEST" },
        4: { board: "M & M", real: "M & M", email: "mm@tnf.test" },
        5: { board: null, real: null, email: null },
      }),
    );
    expect(lines).toHaveLength(100);
    expect(lines[0]).toBe("1 - nerdz (Raychel Neil) - r@tnf.test");
    expect(lines[1]).toBe("2 - Cappy Lay - no email on file");
    expect(lines[2]).toBe("3 - AAA - a@tnf.test");
    expect(lines[3]).toBe("4 - M & M - mm@tnf.test");
    expect(lines[4]).toBe("5 - open");
    expect(lines[99]).toMatch(/^100 - Name100 \(Real Person 100\) - holder100@tnf\.test$/);
  });

  it("is in ascending block order whatever order the export came in", () => {
    const shuffled = entries().reverse();
    expect(blockListLines(shuffled).map((l) => Number(l.split(" - ")[0]))).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it("refuses a list that is not all 100 blocks, once each", () => {
    expect(() => blockListLines(entries().slice(1))).toThrow(/block 1 is missing/);
    expect(() => blockListLines([...entries(), { block: 50, board: "x", real: null, email: null }])).toThrow(/block 50 appears twice/);
    expect(() => blockListLines([...entries().slice(0, 99), { block: 101, board: "x", real: null, email: null }])).toThrow(/not 1 to 100/);
  });

  it("writes a hyphen where a name carries an en or em dash", () => {
    const lines = blockListLines(entries({ 9: { board: "Ed – D", real: "Ed—Dee" } }));
    expect(lines[8]).toBe("9 - Ed - D (Ed-Dee) - holder9@tnf.test");
  });
});

describe("gameday with pictures and the block list", () => {
  const r = render(entries());

  it("renders clean: the lint has no finding", () => {
    expect(r.problems).toEqual([]);
  });

  it("names a picture per game, inline by Content-ID, in game order", () => {
    expect(r.spec.images?.map((i) => [i.gameNo, i.cid])).toEqual([
      [2, "grid-g02@tnf"],
      [3, "grid-g03@tnf"],
      [4, "grid-g04@tnf"],
    ]);
    for (const cid of ["grid-g02@tnf", "grid-g03@tnf", "grid-g04@tnf"]) {
      expect(r.email.html).toContain(`<img src="cid:${cid}"`);
    }
    expect(r.email.html.match(/<img\b/g)).toHaveLength(3);
  });

  it("still states each game, its kickoff and its row and column digits", () => {
    expect(r.email.text).toContain("G02: Bears at Lions, 1:00 PM ET, CBS");
    expect(r.email.text).toContain("G04: Chiefs at Bills, 8:20 PM ET, NBC");
    expect(r.email.text).toContain("Rows, Bears (away): 4 0 7 1 9 2 8 5 3 6");
    expect(r.email.text).toContain("Columns, Lions (home): 2 9 0 6 3 8 1 7 5 4");
  });

  it("carries all 100 blocks, in order, each as its own line, after the games", () => {
    const text = r.email.text;
    const at = (needle: string) => text.indexOf(needle);
    expect(at("1 - Name1 (Real Person 1) - holder1@tnf.test")).toBeGreaterThan(at("Rows, Bears"));
    let last = -1;
    for (let n = 1; n <= 100; n++) {
      const i = at(`\n${n} - Name${n} (Real Person ${n}) - holder${n}@tnf.test`);
      expect(i, `block ${n}`).toBeGreaterThan(last);
      last = i;
    }
    expect(r.email.html).toContain("100 - Name100 (Real Person 100) - holder100@tnf.test");
  });

  it("links the one link, bare, once, and no ?g=", () => {
    expect(r.email.text.match(/https:\/\/ad-26-tnf\.vercel\.app\/grid/g)).toHaveLength(1);
    expect(r.email.text).not.toContain("?g=");
    expect(r.email.html).toContain('<a href="https://ad-26-tnf.vercel.app/grid" style="color:#1a4fa0;">https://ad-26-tnf.vercel.app/grid</a>');
  });

  it("keeps every plain-text line under 70 characters, a long name and address wrapped", () => {
    const long = render(entries({ 12: { board: "Philadelphia Poultry", real: "Ernie Q. Longnamestein Sr", email: "philadelphiapoultryincorporated@tnf.test" } }));
    expect(long.problems).toEqual([]);
    for (const line of long.email.text.split("\n")) expect(line.length).toBeLessThanOrEqual(69);
    expect(long.email.text.replace(/\s+/g, " ")).toContain("12 - Philadelphia Poultry (Ernie Q. Longnamestein Sr) - philadelphiapoultryincorporated@tnf.test");
  });

  it("with --arg images=off keeps the list and drops every picture", () => {
    const off = render(entries(), { images: "off" });
    expect(off.problems).toEqual([]);
    expect(off.spec.images).toBeUndefined();
    expect(off.email.html).not.toMatch(/<img\b/);
    expect(off.email.text).toContain("50 - Name50 (Real Person 50) - holder50@tnf.test");
  });

  it("without a block list it is the Part N email, word for word: no pictures, no list", () => {
    const old = render(undefined);
    expect(old.spec.images).toBeUndefined();
    expect(old.spec.list).toBeUndefined();
    expect(old.email.text).toContain("Grid: https://ad-26-tnf.vercel.app/grid");
    expect(old.email.html).not.toMatch(/<img\b/);
    expect(old.email.text).not.toMatch(/holder\d+@/);
  });

  it("a single game gets one picture", () => {
    const one = render(entries(), {}, { date: "2026-11-26", games: [THANKSGIVING.games[0]] });
    expect(one.spec.images).toHaveLength(1);
    expect(one.email.html.match(/<img\b/g)).toHaveLength(1);
  });

  it("refuses unpublished digits and a bad list exactly as before", () => {
    const unpub = { date: "2026-11-26", games: [pub({ game_no: 2, published: false, row_digits: null, col_digits: null })] };
    expect(() => render(entries(), {}, unpub)).toThrow(/not published/);
    expect(() => render(entries().slice(0, 99))).toThrow(/block 100 is missing/);
  });
});

describe("the lint and the images", () => {
  const base = { subject: "TNF Holiday Pool 2026 | x", text: "x\n" };

  it("refuses any image when none is allowed", () => {
    expect(lintEmail({ ...base, html: '<p><img src="cid:a@tnf"></p>' })).toContain("html: an image");
  });

  it("allows an inline picture by cid, and refuses a remote one", () => {
    expect(lintEmail({ ...base, html: '<p><img src="cid:grid-g02@tnf" alt="x"></p>' }, { images: true })).toEqual([]);
    expect(lintEmail({ ...base, html: '<p><img src="https://x.test/a.png"></p>' }, { images: true })).toContain(
      "html: an image that is not an inline picture by cid",
    );
  });
});

describe("the MIME with inline pictures", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const email = { subject: "TNF Holiday Pool 2026 | Game day numbers", text: "plain\n", html: '<p><img src="cid:grid-g02@tnf"></p>' };
  const raw = buildMime({
    from: "A <a@tnf.test>", to: ["a@tnf.test"], cc: ["c@tnf.test"], bcc: ["b@tnf.test"], email,
    inline: [{ cid: "grid-g02@tnf", filename: "grid-g02.png", mimeType: "image/png", content: png }],
    boundary: "t",
  }).toString("utf8");

  it("puts the HTML and its pictures in multipart/related inside multipart/alternative", () => {
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="alt-t"');
    expect(raw).toContain('Content-Type: multipart/related; boundary="rel-t"');
    expect(raw.indexOf("alt-t")).toBeLessThan(raw.indexOf("rel-t"));
    expect(raw).toContain("Content-ID: <grid-g02@tnf>");
    expect(raw).toContain('Content-Disposition: inline; filename="grid-g02.png"');
    expect(raw).toContain("Content-Type: image/png");
    expect(raw).toContain("--rel-t--");
    expect(raw).toContain("--alt-t--");
  });

  it("keeps the plain-text part standing alone, first, and the Bcc on the header", () => {
    expect(raw.indexOf('Content-Type: text/plain')).toBeLessThan(raw.indexOf("multipart/related"));
    expect(raw).toContain("Bcc: b@tnf.test");
  });

  it("is unchanged with no pictures: no related part", () => {
    const plain = buildMime({ from: "A <a@tnf.test>", to: ["a@tnf.test"], email, boundary: "t" }).toString("utf8");
    expect(plain).not.toContain("multipart/related");
    expect(plain).not.toContain("Content-ID");
  });
});

describe("the grid picture's data", () => {
  const game = (over: Partial<PublicGame> = {}): PublicGame => ({
    id: "g", game_no: 2, week: 12, kickoff_at: "2026-11-26T18:00:00+00:00", date_confirmed: true, game_type: "holiday",
    holiday_label: null, home_team: "Detroit Lions", away_team: "Chicago Bears", network: null,
    row_digits: ROWS, col_digits: COLS, digits_assigned: true, digits_published_at: "2026-11-26T14:10:00+00:00",
    live_home: null, live_away: null, live_updated_at: null, halftime_home: null, halftime_away: null, halftime_block: null,
    halftime_scored_at: null, final_home: null, final_away: null, final_block: null, final_scored_at: null, status: "published",
    ...over,
  });
  const board = (names: Record<number, string | null> = {}): PublicBlock[] =>
    Array.from({ length: 100 }, (_, i) => ({
      block_number: i + 1, status: "assigned", display_name: names[i + 1] === undefined ? `Name${i + 1}` : names[i + 1],
      owner_group: null, participant_id: null, assignment_method: null,
    }));

  it("has all 100 blocks, each with its number and the name the board shows, row-major", () => {
    const m = gridImageModel(game(), board({ 3: "AAA", 23: "PAAA M", 7: null }));
    expect(m.cells).toHaveLength(100);
    expect(m.cells.map((c) => c.n)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(m.cells[2]).toMatchObject({ n: 3, name: "AAA", row: 0, col: 2 });
    expect(m.cells[22]).toMatchObject({ n: 23, name: "PAAA M", row: 2, col: 2 });
    expect(m.cells[6].name).toBeNull();
    expect(m.cells[99]).toMatchObject({ n: 100, row: 9, col: 9 });
  });

  it("carries the published digits on the right axes: away is the row, home the column", () => {
    const m = gridImageModel(game(), board());
    expect(m.rowTeam).toBe("Chicago Bears");
    expect(m.rowDigits).toEqual(ROWS);
    expect(m.colTeam).toBe("Detroit Lions");
    expect(m.colDigits).toEqual(COLS);
    expect(m.code).toBe("G02");
  });

  it("refuses a game whose digits are not published, so no picture states numbers it does not have", () => {
    expect(() => gridImageModel(game({ digits_published_at: null }), board())).toThrow(/not published/);
    expect(() => gridImageModel(game({ row_digits: null }), board())).toThrow(/not published/);
    expect(() => gridImageModel(game({ col_digits: [1, 2, 3] }), board())).toThrow(/not published/);
  });
});
