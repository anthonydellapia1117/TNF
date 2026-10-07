import { describe, expect, it } from "vitest";
// The pack's recipient, storage and attachment logic. Its subject, body and
// MIME moved to src/lib/email on 2026-10-07; those tests live in
// tests/unit/email/.
import {
  buildGameDayPack,
  digitsLive,
  draftAttachments,
  dropFromBcc,
  gridObjectNames,
  ownerRecipients,
  packRecipients,
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
    const r = packRecipients([person({ full_name: "C", cc_email: "c@example.com" })]);
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

describe("owners on the To line", () => {
  it("is Anthony first, then the TNF_OWNER_EMAILS list, trimmed and deduped", () => {
    expect(
      ownerRecipients(" ron@example.com, Mike@example.com;RON@example.com\nnolan@example.com ", "anthony@example.com"),
    ).toEqual(["anthony@example.com", "ron@example.com", "Mike@example.com", "nolan@example.com"]);
  });

  it("never repeats Anthony and never yields an empty To", () => {
    expect(ownerRecipients("Anthony@example.com", "anthony@example.com")).toEqual(["anthony@example.com"]);
    expect(ownerRecipients(undefined, "anthony@example.com")).toEqual(["anthony@example.com"]);
    expect(ownerRecipients("", "anthony@example.com")).toEqual(["anthony@example.com"]);
  });

  it("refuses a blank admin address instead of dropping Anthony from To", () => {
    expect(() => ownerRecipients("ron@example.com", "")).toThrow(/admin address is blank/);
    expect(() => ownerRecipients(undefined, "   ")).toThrow(/admin address is blank/);
  });

  it("drops anyone on the To line from Bcc, case-insensitively", () => {
    expect(
      dropFromBcc(["holder@example.com", "RON@example.com", "anthony@example.com"], ["anthony@example.com", "ron@example.com"]),
    ).toEqual(["holder@example.com"]);
  });
});

describe("attachments", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  const files = [{ filename: "TNF_Holiday_Pool_2026_G01_grid_Nov_25.png", mimeType: "image/png", content: png }];

  it("attaches the files only when the grid is not linked", () => {
    expect(draftAttachments({ mode: "attached" }, files)).toEqual(files);
    expect(draftAttachments(LINKS, files)).toEqual([]);
    expect(draftAttachments({ mode: "live-only" }, files)).toEqual([]);
  });
});
