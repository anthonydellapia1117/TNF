// Every broadcast carries every owner on To, from the owners table; no
// per-recipient email ever carries one (Anthony's rule, 2026-10-07).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envelopeFor, FAMILIES } from "@/lib/email/registry";
import { broadcastTo, type OwnerAddress } from "@/lib/email/envelope";

const ADMIN = "avd-primary@tnf.test";
// Shaped as the owners query returns it. AVD alone carries an alt address, as
// on the live table (Anthony's work address); here a reserved-domain stand-in.
const OWNERS: OwnerAddress[] = [
  { code: "BG", email: "bg@tnf.test", alt_email: null },
  { code: "AVD", email: "AVD-Primary@tnf.test ", alt_email: "avd-work@tnf.test" },
  { code: "EJD", email: "ejd@tnf.test", alt_email: null },
  { code: "GD", email: "gd@tnf.test", alt_email: null },
  { code: "JPOD", email: "jpod@tnf.test", alt_email: null },
  { code: "MAP", email: "map@tnf.test", alt_email: null },
  { code: "NL", email: "nl@tnf.test", alt_email: null },
  { code: "RM", email: "rm@tnf.test", alt_email: null },
];
const EIGHT = [
  "avd-primary@tnf.test", "rm@tnf.test", "map@tnf.test", "jpod@tnf.test",
  "gd@tnf.test", "ejd@tnf.test", "nl@tnf.test", "bg@tnf.test",
];
const ALT = "avd-work@tnf.test";
const HOLDERS = ["holder1@tnf.test", "Holder2@TNF.test", "holder2@tnf.test"];

const SAMPLE_KEY: Record<string, string> = {
  holder_checkin: "holder_checkin_2026-10-07",
  recruit: "recruit_2026-10-07",
  reply: "reply_t3_abc123",
  digest: "digest_2026-10-07",
  status: "status_2026-10-07",
  game_day: "game_day_g01",
};

describe("a broadcast", () => {
  const env = envelopeFor("game_day_g01", { adminEmail: ADMIN, owners: OWNERS, derived: HOLDERS });

  it("carries exactly the eight owner addresses on To, Anthony first", () => {
    expect(env.to).toEqual(EIGHT);
    expect(env.to).toHaveLength(8);
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

  it("never carries Anthony's work address, on To or in Bcc", () => {
    const e = envelopeFor("game_day_g01", { adminEmail: ADMIN, owners: OWNERS, derived: [...HOLDERS, ALT, " AVD-WORK@tnf.test"] });
    expect([...e.to, ...e.cc, ...e.bcc]).not.toContain(ALT);
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

describe("a per-recipient email", () => {
  const perRecipient = FAMILIES.filter((f) => !f.broadcast);

  it("is every family but the game-day pack", () => {
    expect(perRecipient.map((f) => f.name).sort()).toEqual(["digest", "holder_checkin", "recruit", "reply", "status"]);
    expect(FAMILIES.filter((f) => f.broadcast).map((f) => f.name)).toEqual(["game_day"]);
  });

  for (const f of perRecipient) {
    it(`${f.name} carries its one recipient and no owner, even when owners are passed`, () => {
      const e = envelopeFor(SAMPLE_KEY[f.name], { adminEmail: ADMIN, recipient: "Holder1@tnf.test", owners: OWNERS, derived: HOLDERS });
      expect(e).toEqual({ to: ["holder1@tnf.test"], cc: [], bcc: [] });
      const owners = new Set([...EIGHT, ALT]);
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
