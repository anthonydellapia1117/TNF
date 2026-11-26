import { describe, expect, it } from "vitest";
import { envelopeFor, familyOf, renderEvent } from "@/lib/email/registry";
import { blocksNamed, markedBlocks, note } from "@/lib/email/events/note";
import { buildMime } from "@/lib/email/mime";
import type { CommonFacts, DayFacts, EmailContext, HolderFacts } from "@/lib/email/types";
import { COMMON, dayGame } from "./fixtures";

// Part S (Anthony, 2026-11-26 12:41 PM ET): a note to one holder, in his own
// words, with that date's grid pictures. Every address here is fake (.test).

const C: CommonFacts = { ...COMMON, price_per_block_cents: 25000, as_of_et: "2026-11-26" };
const ROWS = [5, 6, 7, 1, 0, 4, 3, 8, 9, 2];
const COLS = [2, 0, 1, 5, 6, 9, 3, 8, 7, 4];
const pub = (over: Parameters<typeof dayGame>[0]) =>
  dayGame({ status: "published", published: true, digits_ok: true, row_digits: ROWS, col_digits: COLS, ...over });

const THANKSGIVING: DayFacts = {
  date: "2026-11-26",
  games: [
    pub({ game_no: 2, kickoff_at: "2026-11-26T18:00:00+00:00", away_team: "Chicago Bears", home_team: "Detroit Lions", network: "CBS" }),
    pub({ game_no: 3, kickoff_at: "2026-11-26T21:30:00+00:00", away_team: "Philadelphia Eagles", home_team: "Dallas Cowboys", network: "FOX" }),
    pub({ game_no: 4, kickoff_at: "2026-11-27T01:20:00+00:00", away_team: "Kansas City Chiefs", home_team: "Buffalo Bills", network: "NBC" }),
  ],
};

const HOLDER: HolderFacts = {
  people: [{ full_name: "Pat Holder / Sam", display_alias: "Pat/Sam", via: "primary", owner_group: "RM" }],
  blocks: [
    { block_number: 3, status: "assigned", owner_group: "RM", owner_full_name: "Ronnie Malandro", ledger_paid: true },
    { block_number: 23, status: "assigned", owner_group: "RM", owner_full_name: "Ronnie Malandro", ledger_paid: true },
  ],
};

const KEY = "note_2026-11-26_pat-sam";
const LINES = [
  "Pat, my mistake. You and Sam were never put on the board in September.",
  "That's fixed: you have blocks 3 and 23, showing as Pat/Sam.",
  "The three grids for Thu Nov 26 are below.",
  "The live grid has a name search: https://ad-26-tnf.vercel.app/grid.",
  "You'll get every game-day and winners email from here on.",
].join("\n");

const nctx = (over: Partial<EmailContext> = {}): EmailContext => ({
  event_key: KEY, recipient: "pat@tnf.test", common: C, holder: HOLDER, people: HOLDER.people, day: THANKSGIVING, ...over,
});
const ARGS = { lines: LINES, subject: "Your blocks", grids: "2,3,4" };

describe("note_<date>_<name> (Part S)", () => {
  it("renders Anthony's words verbatim, the pictures after them, signed Anthony, and passes the lint", () => {
    const r = renderEvent(nctx(), ARGS);
    expect(r.problems).toEqual([]);
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | Your blocks");
    expect(r.spec.greeting).toBeNull();
    expect(r.spec.images?.map((i) => [i.cid, i.gameNo, i.alt])).toEqual([
      ["grid-g02@tnf", 2, "G02 grid, Bears at Lions"],
      ["grid-g03@tnf", 3, "G03 grid, Eagles at Cowboys"],
      ["grid-g04@tnf", 4, "G04 grid, Chiefs at Bills"],
    ]);
    const t = r.email.text;
    expect(t.startsWith("Pat, my mistake.")).toBe(true);
    expect(t.indexOf("from here on.")).toBeLessThan(t.indexOf("[Picture: G02 grid, Bears at Lions]"));
    expect(t.trimEnd().endsWith("Anthony")).toBe(true);
    expect(r.email.html).toContain('<img src="cid:grid-g04@tnf"');
    expect(r.email.html).toContain('<a href="https://ad-26-tnf.vercel.app/grid"');
  });

  it("carries no picture when no grids are named, and still passes", () => {
    const r = renderEvent(nctx(), { lines: LINES.replace("The three grids for Thu Nov 26 are below.\n", ""), subject: "Your blocks" });
    expect(r.spec.images).toBeUndefined();
    expect(r.problems).toEqual([]);
    expect(r.email.html).not.toMatch(/<img/);
  });

  it("is per recipient: To the one holder, nobody on Cc or Bcc", () => {
    expect(familyOf(KEY).broadcast).toBe(false);
    expect(envelopeFor(KEY, { adminEmail: "anthony@tnf.test", recipient: "Pat@tnf.test" })).toEqual({ to: ["pat@tnf.test"], cc: [], bcc: [] });
  });

  it("puts each picture inline by Content-ID in a multipart/related message", () => {
    const r = renderEvent(nctx(), ARGS);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const mime = buildMime({
      from: "Anthony <anthony@tnf.test>", to: ["pat@tnf.test"], email: r.email,
      inline: (r.spec.images ?? []).map((i) => ({ cid: i.cid, filename: `${i.cid.split("@")[0]}.png`, mimeType: "image/png", content: png })),
    }).toString("utf8");
    expect(mime).toMatch(/multipart\/related/);
    expect(mime.match(/Content-ID: <grid-g0[234]@tnf>/g)).toHaveLength(3);
  });

  it("refuses a block the recipient does not hold", () => {
    expect(() => renderEvent(nctx(), { ...ARGS, lines: LINES.replace("3 and 23", "3 and 24") })).toThrow(/block 24 is named but the recipient does not hold it/);
    expect(() => renderEvent(nctx({ holder: undefined }), ARGS)).toThrow(/no holder facts/);
  });

  it("refuses a picture of a game not on its date, not published, or not matching its draw", () => {
    expect(() => renderEvent(nctx(), { ...ARGS, grids: "2,5" })).toThrow(/G05 is not a game on 2026-11-26/);
    const unpublished: DayFacts = { ...THANKSGIVING, games: [{ ...THANKSGIVING.games[0], published: false, row_digits: null, col_digits: null }] };
    expect(() => renderEvent(nctx({ day: unpublished }), { ...ARGS, grids: "2" })).toThrow(/G02 digits are not published/);
    const bad: DayFacts = { ...THANKSGIVING, games: [{ ...THANKSGIVING.games[0], digits_ok: false }] };
    expect(() => renderEvent(nctx({ day: bad }), { ...ARGS, grids: "2" })).toThrow(/do not match their draw row/);
    expect(() => renderEvent(nctx(), { ...ARGS, grids: "2,2" })).toThrow(/named twice/);
    expect(() => renderEvent(nctx(), { ...ARGS, grids: "two" })).toThrow(/game numbers/);
    expect(() => renderEvent(nctx({ day: { ...THANKSGIVING, date: "2026-11-27" } }), ARGS)).toThrow(/day facts are for 2026-11-27/);
    expect(() => renderEvent(nctx({ day: undefined }), ARGS)).toThrow(/need the day facts/);
  });

  it("renders only on its own date", () => {
    expect(() => renderEvent(nctx({ common: { ...C, as_of_et: "2026-11-27" } }), ARGS)).toThrow(/renders only on its own day/);
  });

  it("keeps the lint: a relative date, a dollar sign or filler is a finding", () => {
    expect(renderEvent(nctx(), { ...ARGS, lines: LINES.replace("The three grids for Thu Nov 26", "Today's three grids") }).problems.join())
      .toMatch(/relative date/);
    expect(renderEvent(nctx(), { ...ARGS, lines: `${LINES}\nIt was $500.` }).problems.join()).toMatch(/dollar sign/);
    expect(renderEvent(nctx(), { ...ARGS, lines: `${LINES}\nLet me know if that works.` }).problems.join()).toMatch(/filler/);
  });

  it("needs lines and a subject, and stays short", () => {
    expect(() => note(nctx(), { subject: "x" })).toThrow(/--lines is required/);
    expect(() => note(nctx(), { lines: LINES })).toThrow(/--subject is required/);
    expect(() => note(nctx(), { subject: "x", lines: "One. Two. Three. Four. Five. Six. Seven. Eight. Nine." })).toThrow(/9 sentences/);
  });

  it("accepts only note_<YYYY-MM-DD>_<lower-case name>", () => {
    expect(familyOf("note_2026-11-26_pat-sam").name).toBe("note");
    expect(familyOf("note_2026-11-26_pat").name).toBe("note");
    for (const k of ["note_2026-11-26_Pat", "note_2026-11-26_pat_sam", "note_2026-11-26_", "note_2026-11-26_pat-", "note_pat", "note_2026-11-26_pat@tnf.test"]) {
      expect(() => familyOf(k), k).toThrow(/no email event/);
    }
  });

  it("reads every block number in a sentence that names a block, however it is joined", () => {
    expect(blocksNamed(["you have blocks 3 and 23, showing as Pat/Sam."])).toEqual([3, 23]);
    expect(blocksNamed(["Block 7 is yours.", "So are blocks 8, 9 & 10."])).toEqual([7, 8, 9, 10]);
    // The review of PR 52: each of these let 24 past the old guard.
    expect(blocksNamed(["you have blocks 3, 23, and 24."])).toEqual([3, 23, 24]);
    expect(blocksNamed(["blocks 3 or 24"])).toEqual([3, 24]);
    expect(blocksNamed(["block 3 and also 24"])).toEqual([3, 24]);
    expect(blocksNamed(["block 3 (and 24)"])).toEqual([3, 24]);
    expect(blocksNamed(["blocks: 24"])).toEqual([24]);
    expect(blocksNamed(["Block #24 is yours."])).toEqual([24]);
    expect(blocksNamed(["they can take my spots 3 and 24"])).toEqual([3, 24]);
    expect(blocksNamed(["boxes 3 and 24"])).toEqual([3, 24]);
  });

  it("does not read a date, a time, a game code, a URL or a number over 100 as a block", () => {
    expect(blocksNamed(["The three grids for Thu Nov 26 are below."])).toEqual([]);
    expect(blocksNamed(["Your blocks 3 and 23 play G02 on Thu Nov 26 at 1:00 PM."])).toEqual([3, 23]);
    expect(blocksNamed(["blocks 3 and 23, 2026."])).toEqual([3, 23]);
    expect(blocksNamed(["Find block 3 at https://ad-26-tnf.vercel.app/grid?g=24."])).toEqual([3]);
  });

  it("refuses a block that is not the recipient's in any of those phrasings", () => {
    for (const bad of ["you have blocks 3, 23, and 24.", "block 3 (and 24) is yours.", "Block #24 is yours.", "spots 3 and 24 are yours."]) {
      expect(() => renderEvent(nctx(), { ...ARGS, lines: bad }), bad).toThrow(/block 24 is named but the recipient does not hold it/);
    }
  });

  // The second review of PR 52: the guard failed open on a word that starts
  // like a month ("Mark 24"), on "#24" with no block word, and on a number in
  // the next sentence; and it failed closed on "1,500". Every number now
  // counts, wherever it is, unless it is plainly not a block or is declared.
  it("counts every number in the note, whatever word comes before it or whichever sentence it is in", () => {
    expect(blocksNamed(["Your blocks: Santos 3 and Mark 24."])).toEqual([3, 24]);
    expect(blocksNamed(["you have blocks 3 and 23, and maybe 24 too."])).toEqual([3, 23, 24]);
    expect(blocksNamed(["blocks 3 and 23 are Jane 24's old spots."])).toEqual([3, 23, 24]);
    expect(blocksNamed(["Mark, you're on #3 and #24 now."])).toEqual([3, 24]);
    expect(blocksNamed(["That's fixed: you have 3 or 24."])).toEqual([3, 24]);
    expect(blocksNamed(["you have blocks 3 and 23.", "Santos also has 24."])).toEqual([3, 23, 24]);
    expect(blocksNamed(["The three grids for Thu Nov 26 are below.", "Kickoff is Sept 3."])).toEqual([]);
    expect(blocksNamed(["If block 3 or 23 hits the final it pays 1,500."])).toEqual([3, 23]);
  });

  it("refuses every one of those that names a block the recipient does not hold", () => {
    for (const bad of [
      "Your blocks: Santos 3 and Mark 24.",
      "you have blocks 3 and 23, and maybe 24 too.",
      "Mark, you're on #3 and #24 now.",
      "That's fixed: you have 3 or 24.",
      "you have blocks 3 and 23.\nSantos also has 24.",
    ]) {
      expect(() => renderEvent(nctx(), { ...ARGS, lines: bad }), bad).toThrow(/block 24 is named but the recipient does not hold it/);
    }
  });

  it("lets a score or a count through only when it is declared, and never a number written as a block", () => {
    const score = "Mark, block 23 hit the G04 halftime, Chiefs 13 Bills 10.";
    expect(() => renderEvent(nctx(), { ...ARGS, lines: score })).toThrow(/block 13 is named/);
    expect(renderEvent(nctx(), { ...ARGS, lines: score, not_blocks: "13,10" }).problems).toEqual([]);
    expect(() => renderEvent(nctx(), { ...ARGS, lines: "you have blocks 3 and 24.", not_blocks: "24" })).toThrow(/24 is written as a block/);
    expect(() => renderEvent(nctx(), { ...ARGS, lines: "you have blocks 3, 23, and 24.", not_blocks: "24" })).toThrow(/24 is written as a block/);
    expect(() => renderEvent(nctx(), { ...ARGS, lines: "Block #24 is yours.", not_blocks: "24" })).toThrow(/24 is written as a block/);
    expect(() => renderEvent(nctx(), { ...ARGS, not_blocks: "13" })).toThrow(/not_blocks names 13, which the note does not say/);
    expect(() => renderEvent(nctx(), { ...ARGS, not_blocks: "x" })).toThrow(/whole numbers/);
    expect(markedBlocks(["you have blocks 3, 23, and 24.", "Chiefs 13 Bills 10."])).toEqual([3, 23, 24]);
  });

  it("passes Anthony's note to Mark exactly as it goes out", () => {
    const mark = [
      "Mark, my mistake. You and Santos were never put on the board in September.",
      "That's fixed: you have blocks 3 and 23, showing as Mark/Santos.",
      "The three grids for Thu Nov 26 are below.",
      "The live grid has a name search: https://ad-26-tnf.vercel.app/grid.",
      "You'll get every game-day and winners email from here on.",
    ].join("\n");
    expect(blocksNamed(mark.split("\n"))).toEqual([3, 23]);
    const r = renderEvent(nctx({ event_key: "note_2026-11-26_mark-santos" }), { lines: mark, subject: "Mark/Santos on blocks 3 and 23", grids: "2,3,4" });
    expect(r.problems).toEqual([]);
    expect(r.spec.images?.map((i) => i.gameNo)).toEqual([2, 3, 4]);
  });

  it("refuses a key the ledger cannot take (over 80 characters)", () => {
    const long = `note_2026-11-26_${"a".repeat(65)}`;
    expect(long.length).toBe(81);
    expect(() => note(nctx({ event_key: long }), ARGS)).toThrow(/81 characters; the ledger takes 80/);
    const ok = `note_2026-11-26_${"a".repeat(64)}`;
    expect(() => note(nctx({ event_key: ok }), ARGS)).not.toThrow();
  });
});
