// Every broadcast carries every owner on To, from the owners table; no
// per-recipient email ever carries one (Anthony's rule, 2026-10-07).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envelopeFor, FAMILIES } from "@/lib/email/registry";
import { broadcastTo, type OwnerAddress } from "@/lib/email/envelope";

const ADMIN = "avd-primary@tnf.test";
// Shaped as the owners query returns it. MAP's second address is the one alt
// on the live table (2026-10-14); AVD carries one here too, so the rule is held
// for every owner's alt, not one row's. Reserved-domain addresses only.
const OWNERS: OwnerAddress[] = [
  { code: "BG", email: "bg@tnf.test", alt_email: null },
  { code: "AVD", email: "AVD-Primary@tnf.test ", alt_email: "avd-alt@tnf.test" },
  { code: "DN", email: "dn@tnf.test", alt_email: null },
  { code: "EJD", email: "ejd@tnf.test", alt_email: null },
  { code: "GD", email: "gd@tnf.test", alt_email: null },
  { code: "JPOD", email: "jpod@tnf.test", alt_email: null },
  { code: "MAP", email: "map@tnf.test", alt_email: "map-alt@tnf.test" },
  { code: "NL", email: "nl@tnf.test", alt_email: null },
  { code: "RM", email: "rm@tnf.test", alt_email: null },
  { code: "TJA", email: "tja@tnf.test", alt_email: null },
];
const TEN = [
  "avd-primary@tnf.test", "rm@tnf.test", "map@tnf.test", "jpod@tnf.test",
  "gd@tnf.test", "ejd@tnf.test", "nl@tnf.test", "bg@tnf.test", "tja@tnf.test", "dn@tnf.test",
];
const ALT = "avd-alt@tnf.test";
const MAP_ALT = "map-alt@tnf.test";
const HOLDERS = ["holder1@tnf.test", "Holder2@TNF.test", "holder2@tnf.test"];

const SAMPLE_KEY: Record<string, string> = {
  holder_checkin: "holder_checkin_2026-10-07",
  recruit: "recruit_2026-10-07",
  reply: "reply_t3_abc123",
  digest: "digest_2026-10-07",
  status: "status_2026-10-07",
  game_day: "game_day_g01",
  game_list: "game_list_1a116ebc30d629eb",
  answer: "answer_1a116ebc30d629eb",
};

describe("a broadcast", () => {
  const env = envelopeFor("game_day_g01", { adminEmail: ADMIN, owners: OWNERS, derived: HOLDERS });

  it("carries exactly the ten owner addresses on To, Anthony first, TJA then DN last", () => {
    expect(env.to).toEqual(TEN);
    expect(env.to).toHaveLength(10);
    expect(env.cc).toEqual([]);
  });

  it("puts an owner who also holds a block on To only, once", () => {
    const e = envelopeFor("game_day_g01", {
      adminEmail: ADMIN, owners: OWNERS, derived: [...HOLDERS, "RM@tnf.test", "avd-primary@tnf.test"],
    });
    expect(e.to.filter((a) => a === "rm@tnf.test")).toHaveLength(1);
    expect(e.bcc).not.toContain("rm@tnf.test");
    expect(e.bcc).not.toContain("avd-primary@tnf.test");
    expect(e.bcc).toEqual(["holder1@tnf.test", "holder2@tnf.test"]);
  });

  it("never carries an owner's alt address, on To or in Bcc", () => {
    const e = envelopeFor("game_day_g01", { adminEmail: ADMIN, owners: OWNERS, derived: [...HOLDERS, ALT, " AVD-ALT@tnf.test"] });
    expect([...e.to, ...e.cc, ...e.bcc]).not.toContain(ALT);
  });

  // Anthony, 2026-10-14: MAP's second address was an active prospect, so the
  // recruit broadcast reached him twice. Every owner's alt is out of Bcc.
  it("gives an owner whose second address is a prospect one copy, at his primary", () => {
    for (const key of ["game_day_g01", "recruit_broadcast_2026-10-14"]) {
      const e = envelopeFor(key, { adminEmail: ADMIN, owners: OWNERS, derived: [...HOLDERS, " Map-Alt@tnf.test", MAP_ALT] });
      expect(e.to.filter((a) => a === "map@tnf.test")).toHaveLength(1);
      expect([...e.to, ...e.cc, ...e.bcc]).not.toContain(MAP_ALT);
      expect(e.bcc).toEqual(["holder1@tnf.test", "holder2@tnf.test"]);
    }
  });

  it("refuses rather than sending short or wrong", () => {
    expect(() => envelopeFor("game_day_g01", { adminEmail: ADMIN, derived: HOLDERS })).toThrow(/needs the owners/);
    expect(() => broadcastTo(OWNERS.map((o) => (o.code === "NL" ? { ...o, email: null } : o)), ADMIN)).toThrow(/NL has no address/);
    expect(() => broadcastTo(OWNERS.filter((o) => o.code !== "AVD"), ADMIN)).toThrow(/no AVD row/);
    expect(() => broadcastTo(OWNERS, "someone-else@tnf.test")).toThrow(/not ADMIN_EMAIL/);
    expect(() => broadcastTo(OWNERS.map((o) => (o.code === "GD" ? { ...o, email: "bg@tnf.test" } : o)), ADMIN)).toThrow(/shares an address/);
    expect(() => broadcastTo(OWNERS.map((o) => (o.code === "MAP" ? { ...o, email: ALT } : o)), ADMIN)).toThrow(/alt address/);
  });
});

describe("an owner with no address on the owners table", () => {
  // The live table on 2026-10-08: DN has none. The refusal names DN and only DN.
  const dnMissing = OWNERS.map((o) => (o.code === "DN" ? { ...o, email: null } : o));

  it("refuses the broadcast, naming that owner and no other", () => {
    let msg = "";
    try {
      broadcastTo(dnMissing, ADMIN);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/owner DN has no address/);
    const named = OWNERS.map((o) => o.code).filter((c) => c !== "DN" && new RegExp(`\\b${c}\\b`).test(msg));
    expect(named).toEqual([]);
  });

  it("names every owner with no address in one refusal", () => {
    const two = dnMissing.map((o) => (o.code === "TJA" ? { ...o, email: " " } : o));
    expect(() => broadcastTo(two, ADMIN)).toThrow(/owners TJA, DN have no address/);
  });
});

// G4 (Anthony, 2026-10-13): for one send only, an explicit override that names
// DN leaves DN off To. The claim writes the audit row; the default still refuses.
describe("a one-time override naming an owner with no address", () => {
  const dnMissing = OWNERS.map((o) => (o.code === "DN" ? { ...o, email: null } : o));
  const NINE = TEN.filter((a) => a !== "dn@tnf.test");

  it("leaves off exactly the owner it names, Anthony still first", () => {
    expect(broadcastTo(dnMissing, ADMIN, { omit: ["DN"] })).toEqual(NINE);
    expect(broadcastTo(dnMissing, ADMIN, { omit: [" dn "] })).toEqual(NINE);
  });

  it("is never the default: without it the broadcast still refuses", () => {
    expect(() => broadcastTo(dnMissing, ADMIN)).toThrow(/owner DN has no address/);
    expect(() => broadcastTo(dnMissing, ADMIN, { omit: [] })).toThrow(/owner DN has no address/);
  });

  it("refuses to leave off an owner who has an address", () => {
    expect(() => broadcastTo(dnMissing, ADMIN, { omit: ["DN", "RM"] })).toThrow(/RM has an address/);
    expect(() => broadcastTo(OWNERS, ADMIN, { omit: ["DN"] })).toThrow(/DN has an address/);
  });

  it("refuses when another owner with no address is not named, and an unknown code", () => {
    const two = dnMissing.map((o) => (o.code === "TJA" ? { ...o, email: null } : o));
    expect(() => broadcastTo(two, ADMIN, { omit: ["DN"] })).toThrow(/owner TJA has no address/);
    expect(broadcastTo(two, ADMIN, { omit: ["DN", "TJA"] })).toEqual(NINE.filter((a) => a !== "tja@tnf.test"));
    expect(() => broadcastTo(dnMissing, ADMIN, { omit: ["DN", "XX"] })).toThrow(/no owner XX/);
    expect(() => broadcastTo(OWNERS.map((o) => (o.code === "AVD" ? { ...o, email: null } : o)), ADMIN, { omit: ["AVD"] })).toThrow(/AVD/);
  });

  it("carries through the envelope: nine on To, the rest in Bcc minus To", () => {
    const e = envelopeFor("recruit_broadcast_2026-10-07", {
      adminEmail: ADMIN, owners: dnMissing, derived: [...HOLDERS, "rm@tnf.test"], omit: ["DN"],
    });
    expect(e.to).toEqual(NINE);
    expect(e.bcc).toEqual(["holder1@tnf.test", "holder2@tnf.test"]);
    expect(() => envelopeFor("recruit_broadcast_2026-10-07", { adminEmail: ADMIN, owners: dnMissing, derived: HOLDERS }))
      .toThrow(/owner DN has no address/);
  });

  it("is refused on a per-recipient event, where no owner is ever addressed", () => {
    expect(() => envelopeFor("recruit_2026-10-07", { adminEmail: ADMIN, recipient: "holder1@tnf.test", omit: ["DN"] }))
      .toThrow(/broadcast/);
  });
});

describe("a per-recipient email", () => {
  const perRecipient = FAMILIES.filter((f) => !f.broadcast);

  it("is every family but the game-day pack and the recruit broadcast", () => {
    expect(perRecipient.map((f) => f.name).sort()).toEqual(["answer", "digest", "game_list", "holder_checkin", "recruit", "reply", "status"]);
    expect(FAMILIES.filter((f) => f.broadcast).map((f) => f.name).sort()).toEqual(["game_day", "recruit_broadcast"]);
  });

  for (const f of perRecipient) {
    it(`${f.name} carries its one recipient and no owner, even when owners are passed`, () => {
      const e = envelopeFor(SAMPLE_KEY[f.name], { adminEmail: ADMIN, recipient: "Holder1@tnf.test", owners: OWNERS, derived: HOLDERS });
      expect(e).toEqual({ to: ["holder1@tnf.test"], cc: [], bcc: [] });
      const owners = new Set([...TEN, ALT, MAP_ALT]);
      expect([...e.to, ...e.cc, ...e.bcc].some((a) => owners.has(a))).toBe(false);
    });
  }
});

describe("where the owner addresses come from", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const files = [
    "scripts/game-day-pack.mts", "scripts/email.mts", "src/lib/game-day-pack.ts",
    "src/lib/email/envelope.ts", "src/lib/email/registry.ts", "docs/ROUTINES.md", "CLAUDE.md",
  ];
  it("is never an environment variable", () => {
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      expect(text, f).not.toMatch(/OWNER_EMAILS/);
      expect(text, f).not.toMatch(/process\.env\.[A-Z_]*OWNER/);
    }
  });
});
