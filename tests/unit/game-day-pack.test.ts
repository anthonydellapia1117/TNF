import { describe, expect, it } from "vitest";
import {
  buildDraftMime,
  buildGameDayPack,
  digitsLive,
  draftAttachments,
  etDateStamp,
  gridObjectNames,
  hyphenate,
  packBody,
  packFilenameBase,
  packRecipients,
  packSubject,
  packTemplateFields,
  publicObjectUrl,
  type PackGame,
  type PackParticipant,
} from "@/lib/game-day-pack";

const DIGITS = [3, 7, 1, 9, 0, 4, 8, 2, 6, 5];

// G01 as seeded: Wednesday September 9, 8:20 PM ET, stored as 00:20 UTC on
// the 10th. The ET date is the one that matters everywhere below.
const G01: PackGame = {
  game_no: 1,
  week: 1,
  kickoff_at: "2026-09-10T00:20:00+00:00",
  away_team: "New England Patriots",
  home_team: "Seattle Seahawks",
  network: "NBC",
  holiday_label: null,
  row_digits: DIGITS,
  col_digits: DIGITS,
};

const BASE = "https://ad-26-tnf.vercel.app/";
const SUPABASE = "https://bqisojzdwodwaznzwega.supabase.co";
const LINKS = {
  mode: "links" as const,
  pngUrl: `${SUPABASE}/storage/v1/object/public/game-day/2026-09-09_TNF_G01_grid.png`,
  pdfUrl: `${SUPABASE}/storage/v1/object/public/game-day/2026-09-09_TNF_G01_grid.pdf`,
};

const person = (over: Partial<PackParticipant> & { full_name: string }): PackParticipant => ({
  display_alias: null,
  email: null,
  cc_email: null,
  blocks: [1],
  ...over,
});

describe("file name and subject", () => {
  it("stamps the game's ET date, not the UTC date and not the run date", () => {
    expect(etDateStamp(G01.kickoff_at!)).toBe("2026-09-09");
    expect(packFilenameBase(G01)).toBe("2026-09-09_TNF_G01_grid");
  });

  it("pads the game code and survives a missing kickoff", () => {
    expect(packFilenameBase({ game_no: 13, kickoff_at: null })).toBe(
      "0000-00-00_TNF_G13_grid",
    );
  });

  it("reads like the template title: TNF | Week N | Away at Home", () => {
    expect(packSubject(G01)).toBe("TNF | Week 1 | New England Patriots at Seattle Seahawks");
  });

  it("handles the clock change: a December game is EST", () => {
    const g22: PackGame = {
      ...G01,
      game_no: 22,
      week: 17,
      kickoff_at: "2026-12-26T01:15:00+00:00",
      holiday_label: "Christmas Day",
    };
    expect(packTemplateFields(g22, BASE).kickoff_time).toBe("8:15 PM ET");
    expect(packFilenameBase(g22)).toBe("2026-12-25_TNF_G22_grid");
  });
});

describe("template fields", () => {
  it("fills the design-kit fields from the public game row", () => {
    expect(packTemplateFields(G01, BASE)).toEqual({
      live_grid_url: "https://ad-26-tnf.vercel.app/grid?g=1",
      away_team: "New England Patriots",
      home_team: "Seattle Seahawks",
      game_date: "Wednesday, September 9",
      kickoff_time: "8:20 PM ET",
      network: "NBC",
      week_number: "1",
      broadcast_line: "G01 | NBC",
      grid_image_url: null,
    });
  });

  it("carries the holiday on the broadcast line and the PNG as the board image", () => {
    const f = packTemplateFields({ ...G01, holiday_label: "Thanksgiving" }, BASE, LINKS);
    expect(f.broadcast_line).toBe("G01 | NBC | Thanksgiving");
    expect(f.grid_image_url).toBe(LINKS.pngUrl);
  });

  it("says TBD instead of inventing a date, time or network", () => {
    const f = packTemplateFields({ ...G01, kickoff_at: null, network: null }, BASE);
    expect(f.game_date).toBe("Date TBD");
    expect(f.kickoff_time).toBe("Time TBD");
    expect(f.network).toBe("TBD");
    expect(f.broadcast_line).toBe("G01");
  });
});

describe("body", () => {
  it("carries the link, the game, kickoff and network, and the attached line by default", () => {
    const body = packBody(G01, BASE);
    expect(body).toContain("Live grid: https://ad-26-tnf.vercel.app/grid?g=1");
    expect(body).toContain("New England Patriots at Seattle Seahawks");
    expect(body).toContain("Date: Wednesday, September 9");
    expect(body).toContain("Kickoff: 8:20 PM ET");
    expect(body).toContain("Network: NBC");
    expect(body).toContain("Week 1");
    expect(body).toContain("The grid for this game is attached (PNG and PDF).");
    expect(body).not.toMatch(/\$|paid|owe|claim/i);
  });

  it("links both files and drops the attached line when the grid is uploaded", () => {
    const body = packBody(G01, BASE, { grid: LINKS });
    expect(body).toContain(`Grid PNG: ${LINKS.pngUrl}`);
    expect(body).toContain(`Grid PDF: ${LINKS.pdfUrl}`);
    expect(body).not.toContain("attached");
  });

  it("points to the live grid alone when there are no files", () => {
    const body = packBody(G01, BASE, { grid: { mode: "live-only" } });
    expect(body).toContain("Live grid: https://ad-26-tnf.vercel.app/grid?g=1");
    expect(body).not.toContain("attached");
    expect(body).not.toContain("Grid PNG");
  });

  it("names the holiday when there is one", () => {
    expect(packBody({ ...G01, holiday_label: "Thanksgiving" }, "https://x.test")).toContain(
      "Thanksgiving",
    );
  });

  it("follows the template module order: hero, board, notes, lock, payouts, footer", () => {
    const body = packBody(G01, BASE, {
      grid: LINKS,
      notes: { headline: "Two contenders", paragraphs: ["First.", "Second."] },
      lock: { pick: "Seahawks", odds: "-3", book: "DK", statusLine: "Locked at kickoff" },
      payouts: { halftimeCents: 75000, finalCents: 100000 },
    });
    const at = (s: string) => {
      const i = body.indexOf(s);
      expect(i, `missing "${s}"`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const hero = at("New England Patriots at Seattle Seahawks");
    const board = at("THE BOARD");
    const notes = at("GAME NOTES");
    const lock = at("THE LOCK");
    const payouts = at("PAYOUTS THIS GAME");
    const footer = at("Anthony DellaPia");
    expect([hero, board, notes, lock, payouts, footer]).toEqual(
      [hero, board, notes, lock, payouts, footer].slice().sort((a, b) => a - b),
    );
    expect(body).toContain("Halftime: $750");
    expect(body).toContain("Final: $1,000");
  });

  it("omits notes, lock and payouts when they are not supplied, never invents them", () => {
    const body = packBody(G01, BASE);
    expect(body).not.toContain("GAME NOTES");
    expect(body).not.toContain("THE LOCK");
    expect(body).not.toContain("PAYOUTS");
  });

  it("never carries an em dash or an en dash, even when the data does", () => {
    const dashed: PackGame = {
      ...G01,
      away_team: "New England Patriots \u2014 road",
      holiday_label: "Thanksgiving \u2013 night",
    };
    const pack = buildGameDayPack(dashed, [], BASE, {
      grid: LINKS,
      notes: { headline: "A \u2014 B", paragraphs: ["x \u2013 y"] },
    });
    expect(pack.subject).not.toMatch(/[\u2013\u2014]/);
    expect(pack.body).not.toMatch(/[\u2013\u2014]/);
    expect(pack.subject).toContain("New England Patriots - road");
    expect(hyphenate("a \u2014 b \u2013 c")).toBe("a - b - c");
  });
});

describe("storage names", () => {
  it("derives the object names from the file name base and the public URL from the project", () => {
    expect(gridObjectNames("2026-09-09_TNF_G01_grid")).toEqual({
      png: "2026-09-09_TNF_G01_grid.png",
      pdf: "2026-09-09_TNF_G01_grid.pdf",
    });
    expect(publicObjectUrl(`${SUPABASE}/`, "2026-09-09_TNF_G01_grid.png")).toBe(LINKS.pngUrl);
  });
});

describe("recipients", () => {
  it("is every holder's email plus cc_email, each address once", () => {
    const r = packRecipients([
      person({ full_name: "frank animal", email: "bobm@mmelectrical.net", blocks: [63] }),
      person({ full_name: "M & M", email: "bobm@mmelectrical.net", blocks: [70] }),
      person({
        full_name: "Raychel Neil",
        display_alias: "nerdz",
        email: "rayplay1107@gmail.com",
        cc_email: "ray@economydelivers.com",
      }),
      person({ full_name: "Ed D", blocks: [9, 42, 93] }),
      person({ full_name: "Eric Nardini", email: " En927898@gmail.com " }),
    ]);
    expect(r.bcc).toEqual([
      "bobm@mmelectrical.net",
      "En927898@gmail.com",
      "ray@economydelivers.com",
      "rayplay1107@gmail.com",
    ]);
    expect(r.noEmail).toEqual([{ name: "Ed D", blocks: [9, 42, 93] }]);
    expect(r.counts).toEqual({
      holders: 5,
      blocksHeld: 7,
      withEmail: 4,
      withoutEmail: 1,
      ccAddresses: 1,
      shared: 1,
      distinct: 4,
    });
  });

  it("dedupes case-insensitively and keeps the first casing", () => {
    const r = packRecipients([
      person({ full_name: "A", email: "Vincent@reisenagency.com" }),
      person({ full_name: "B", cc_email: "vincent@REISENAGENCY.com" }),
    ]);
    expect(r.bcc).toEqual(["Vincent@reisenagency.com"]);
    expect(r.counts.shared).toBe(1);
  });

  it("does not count a cc-only holder as missing an email", () => {
    const r = packRecipients([person({ full_name: "C", cc_email: "c@x.test" })]);
    expect(r.noEmail).toEqual([]);
    expect(r.counts.withEmail).toBe(0);
    expect(r.counts.distinct).toBe(1);
  });
});

describe("digits", () => {
  it("are live only when both axes are full permutations in the projection", () => {
    expect(digitsLive(G01)).toBe(true);
    expect(digitsLive({ row_digits: null, col_digits: DIGITS })).toBe(false);
    expect(digitsLive({ row_digits: [1, 2], col_digits: DIGITS })).toBe(false);
  });

  it("flows through the built pack", () => {
    const pack = buildGameDayPack({ ...G01, row_digits: null }, [], "https://x.test");
    expect(pack.digitsLive).toBe(false);
    expect(pack.gameCode).toBe("G01");
    expect(pack.recipients.bcc).toEqual([]);
    expect(pack.grid).toEqual({ mode: "attached" });
  });
});

describe("draft MIME", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  const files = [{ filename: "2026-09-09_TNF_G01_grid.png", mimeType: "image/png", content: png }];
  const msg = buildDraftMime({
    from: "Anthony <a@example.test>",
    bcc: ["one@example.test", "Two@example.test"],
    subject: "TNF | Week 1 | New England Patriots at Seattle Seahawks",
    body: "Live grid: https://x.test/grid?g=1\n\nThe grid for this game is attached (PNG and PDF).",
    attachments: files,
    boundary: "b0undary",
    date: new Date("2026-09-09T11:30:00Z"),
  }).toString("utf8");

  it("puts every recipient in Bcc and nothing in To", () => {
    expect(msg).toContain("\r\nBcc: one@example.test, Two@example.test\r\n");
    expect(msg).not.toMatch(/^To:/m);
  });

  it("is CRLF multipart/mixed with the body first and the file as an attachment", () => {
    expect(msg.startsWith("From: Anthony <a@example.test>\r\n")).toBe(true);
    expect(msg).toContain('Content-Type: multipart/mixed; boundary="b0undary"');
    expect(msg).toContain('Content-Disposition: attachment; filename="2026-09-09_TNF_G01_grid.png"');
    expect(msg.endsWith("--b0undary--\r\n")).toBe(true);
    expect(msg.indexOf("text/plain")).toBeLessThan(msg.indexOf("image/png"));
    expect(msg).not.toMatch(/[^\r]\n/); // every line ends CRLF
  });

  it("round-trips the attachment bytes and the body through base64", () => {
    const section = msg.split("--b0undary")[2];
    const encoded = section.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(new Uint8Array(Buffer.from(encoded, "base64"))).toEqual(png);
    const bodySection = msg.split("--b0undary")[1];
    const bodyEncoded = bodySection.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(bodyEncoded, "base64").toString("utf8")).toContain("attached (PNG and PDF)");
  });

  it("attaches the files only when the grid is not linked", () => {
    expect(draftAttachments({ mode: "attached" }, files)).toEqual(files);
    expect(draftAttachments(LINKS, files)).toEqual([]);
    expect(draftAttachments({ mode: "live-only" }, files)).toEqual([]);
  });

  it("is a plain single-part message with no attachment when the body carries the links", () => {
    const pack = buildGameDayPack(G01, [person({ full_name: "A", email: "a@x.test" })], BASE, {
      grid: LINKS,
    });
    const linked = buildDraftMime({
      from: "a@example.test",
      bcc: pack.recipients.bcc,
      subject: pack.subject,
      body: pack.body,
      attachments: draftAttachments(pack.grid, files),
      boundary: "b0undary",
      date: new Date("2026-09-09T11:30:00Z"),
    }).toString("utf8");
    expect(linked).not.toContain("Content-Disposition: attachment");
    expect(linked).not.toContain("multipart/mixed");
    expect(linked).toContain('Content-Type: text/plain; charset="UTF-8"');
    const encoded = linked.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(decoded).toContain(LINKS.pngUrl);
    expect(decoded).toContain(LINKS.pdfUrl);
    expect(linked).not.toMatch(/[^\r]\n/);
  });
});
