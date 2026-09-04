import { describe, expect, it } from "vitest";
import {
  buildDraftMime,
  buildGameDayPack,
  digitsLive,
  etDateStamp,
  packBody,
  packFilenameBase,
  packRecipients,
  packSubject,
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

  it("reads TNF G0N: Away at Home, day time", () => {
    expect(packSubject(G01)).toBe(
      "TNF G01: New England Patriots at Seattle Seahawks, Wed 8:20 PM ET",
    );
  });

  it("handles the clock change: a December game is EST", () => {
    const g22: PackGame = {
      ...G01,
      game_no: 22,
      kickoff_at: "2026-12-26T01:15:00+00:00",
      holiday_label: "Christmas Day",
    };
    expect(packSubject(g22)).toContain("Fri 8:15 PM ET");
    expect(packFilenameBase(g22)).toBe("2026-12-25_TNF_G22_grid");
  });
});

describe("body", () => {
  it("carries the link, the game, kickoff and network, and the attached line", () => {
    const body = packBody(G01, "https://ad-26-tnf.vercel.app/");
    expect(body).toContain("Live grid: https://ad-26-tnf.vercel.app/grid?g=1");
    expect(body).toContain("G01: New England Patriots at Seattle Seahawks");
    expect(body).toContain("Wednesday, September 9, 8:20 PM ET on NBC");
    expect(body).toContain("The grid for this game is attached (PNG and PDF).");
    expect(body).not.toMatch(/\$|paid|owe|claim/i);
  });

  it("names the holiday when there is one", () => {
    expect(
      packBody({ ...G01, holiday_label: "Thanksgiving" }, "https://x.test"),
    ).toContain("(Thanksgiving)");
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
  });
});

describe("draft MIME", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  const msg = buildDraftMime({
    from: "Anthony <a@example.test>",
    bcc: ["one@example.test", "Two@example.test"],
    subject: "TNF G01: New England Patriots at Seattle Seahawks, Wed 8:20 PM ET",
    body: "Live grid: https://x.test/grid?g=1\n\nThe grid for this game is attached (PNG and PDF).",
    attachments: [{ filename: "2026-09-09_TNF_G01_grid.png", mimeType: "image/png", content: png }],
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
    expect(msg.indexOf('text/plain')).toBeLessThan(msg.indexOf("image/png"));
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
});
