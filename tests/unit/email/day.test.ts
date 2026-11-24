import { describe, expect, it } from "vitest";
import { renderEvent, envelopeFor } from "@/lib/email/registry";
import { checkBroadcast, type BroadcastPlan } from "@/lib/email/broadcast";
import { dayEnvelope, type OwnerAddress } from "@/lib/email/envelope";
import { sampleDay, SAMPLE_COLS, SAMPLE_ROWS } from "@/lib/email/sample";
import { winningBlock } from "@/lib/pool";
import type { CommonFacts } from "@/lib/email/types";
import { COMMON, ctx, DAY_PUBLISHED, DAY_SCORED, dayGame } from "./fixtures";

// Part N (Anthony, approved 2026-11-23 2:53 PM ET): the kickoff, game-day and
// winners emails. Every value comes from the context; these pin the words that
// matter and every refusal that keeps a wrong email from going out.

const C250: CommonFacts = {
  ...COMMON,
  price_per_block_cents: 25000,
  holiday_halftime_cents: 75000,
  holiday_final_cents: 150000,
  regular_halftime_cents: 75000,
  regular_final_cents: 150000,
};
const on = (as_of_et: string) => ({ ...C250, as_of_et });
/** The plain text with its wrapping undone, for phrase checks. */
const flat = (r: { email: { text: string } }) => r.email.text.replace(/\s+/g, " ");

describe("kickoff", () => {
  const r = renderEvent(ctx("kickoff_2026-11-24", { common: on("2026-11-24") }));

  it("carries the board, how a block wins, both payouts and every game", () => {
    expect(r.email.text).toContain("https://ad-26-tnf.vercel.app/blocks");
    expect(flat(r)).toContain("Away digit picks the row, home digit picks the column");
    expect(r.email.text).toContain("Halftime 750, final 1,500");
    for (const n of ["G01", "G05", "G06", "G10"]) expect(r.email.text).toContain(n);
    expect(r.email.text).toContain("Wed Nov 25: G01, 8:00 PM ET, Packers at Rams");
    expect(r.email.text).toContain("Thu Nov 26: G04, 8:20 PM ET, Chiefs at Bills");
  });

  it("tells the unpaid to pay by the deadline, an absolute time, and nothing about anyone's status", () => {
    expect(flat(r)).toContain("Not paid yet? 250 a block, due by 11:59 PM Tue Nov 24.");
    expect(r.email.text).not.toMatch(/\$/);
    expect(r.email.text).not.toMatch(/tonight|today/i);
    expect(r.problems).toEqual([]);
  });

  it("renders only on its own date, unless it is a sample", () => {
    expect(() => renderEvent(ctx("kickoff_2026-11-24", { common: on("2026-11-23") }))).toThrow(/database date is 2026-11-23/);
    const s = renderEvent(ctx("kickoff_2026-11-24", { common: on("2026-11-23"), sample: true }));
    expect(s.email.subject.startsWith("SAMPLE - TNF Holiday Pool 2026")).toBe(true);
    expect(s.email.text).toContain("SAMPLE for review only");
  });

  it("goes on the claim deadline only", () => {
    expect(() => renderEvent(ctx("kickoff_2026-11-25", { common: on("2026-11-25") }))).toThrow(/not the claim deadline/);
  });
});

describe("gameday", () => {
  const r = renderEvent(ctx("gameday_2026-11-25", { common: on("2026-11-25"), day: DAY_PUBLISHED }));

  it("names each game, its kickoff, its rows (away) and columns (home), and its grid", () => {
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | Game day numbers | Nov 25");
    expect(r.email.text).toContain("G01: Packers at Rams, 8:00 PM ET, Netflix");
    expect(r.email.text).toContain("Rows, Packers (away): 4 0 7 1 9 2 8 5 3 6");
    expect(r.email.text).toContain("Columns, Rams (home): 2 9 0 6 3 8 1 7 5 4");
    expect(r.email.text).toContain("https://ad-26-tnf.vercel.app/grid?g=1");
    expect(r.problems).toEqual([]);
  });

  it("refuses a game whose digits are not published, or do not match their draw", () => {
    const unpub = { date: "2026-11-25", games: [dayGame()] };
    expect(() => renderEvent(ctx("gameday_2026-11-25", { common: on("2026-11-25"), day: unpub }))).toThrow(/not published/);
    const bad = { date: "2026-11-25", games: [{ ...DAY_PUBLISHED.games[0], digits_ok: false }] };
    expect(() => renderEvent(ctx("gameday_2026-11-25", { common: on("2026-11-25"), day: bad }))).toThrow(/do not match/);
  });

  it("refuses day facts for another date, or none", () => {
    expect(() => renderEvent(ctx("gameday_2026-11-25", { common: on("2026-11-25") }))).toThrow(/no day facts/);
    expect(() => renderEvent(ctx("gameday_2026-11-25", { common: on("2026-11-25"), day: { ...DAY_PUBLISHED, date: "2026-11-26" } }))).toThrow(/for 2026-11-26/);
  });
});

describe("winners", () => {
  it("states each score, block, name and amount, and nothing about payment status", () => {
    const r = renderEvent(ctx("winners_2026-11-25", { common: on("2026-11-25"), day: DAY_SCORED }));
    expect(r.email.subject).toBe("TNF Holiday Pool 2026 | Winners | Nov 25");
    expect(r.email.text).toContain("Halftime: Packers 10, Rams 7 - block 18, Sal - 750");
    expect(r.email.text).toContain("Final: Packers 24, Rams 27 - block 8, M & M - 1,500");
    expect(r.email.text).toContain("Next game day is Thu Nov 26.");
    expect(r.email.text).not.toMatch(/paid|owed|unpaid|\$/i);
    expect(r.problems).toEqual([]);
  });

  it("goes out the night of its games or the morning after, never later", () => {
    expect(() => renderEvent(ctx("winners_2026-11-25", { common: on("2026-11-26"), day: DAY_SCORED }))).not.toThrow();
    expect(() => renderEvent(ctx("winners_2026-11-25", { common: on("2026-11-27"), day: DAY_SCORED }))).toThrow(/morning after/);
  });

  it("refuses an unscored game, and a winner with no payout behind it (Anthony's call)", () => {
    expect(() => renderEvent(ctx("winners_2026-11-25", { common: on("2026-11-25"), day: DAY_PUBLISHED }))).toThrow(/not scored/);
    const unpaid = { ...DAY_SCORED, games: [{ ...DAY_SCORED.games[0], final_paid_out: false }] };
    expect(() => renderEvent(ctx("winners_2026-11-25", { common: on("2026-11-25"), day: unpaid }))).toThrow(/no payout behind it/);
  });

  it("says when it was the last game", () => {
    const g10 = { date: "2026-12-31", games: [{ ...DAY_SCORED.games[0], game_no: 10, kickoff_at: "2027-01-01T01:15:00+00:00" }] };
    const r = renderEvent(ctx("winners_2026-12-31", { common: on("2026-12-31"), day: g10 }));
    expect(r.email.text).toContain("That was the last game of the 2026 pool.");
  });
});

describe("samples", () => {
  it("fills made-up digits and scores into the live slate, winners computed with winningBlock", () => {
    const d = sampleDay(C250, "2026-11-26", true);
    expect(d.games.map((g) => g.game_no)).toEqual([2, 3, 4]);
    for (const g of d.games) {
      expect(g.halftime_block).toBe(winningBlock(SAMPLE_ROWS, SAMPLE_COLS, g.halftime_home!, g.halftime_away!));
      expect(g.final_block).toBe(winningBlock(SAMPLE_ROWS, SAMPLE_COLS, g.final_home!, g.final_away!));
    }
    const r = renderEvent(ctx("winners_2026-11-26", { common: on("2026-11-23"), day: d, sample: true }));
    expect(r.email.subject.startsWith("SAMPLE - ")).toBe(true);
    expect(flat(r)).toContain("SAMPLE for review only. The numbers below are made up.");
    expect(r.email.text).toContain("SAMPLE NAME");
  });
});

describe("the game-day envelope: To Anthony, Cc RM and MAP, Bcc holders", () => {
  const owners: OwnerAddress[] = [
    { code: "AVD", email: "avd@tnf.test", alt_email: null },
    { code: "RM", email: "rm@tnf.test", alt_email: null },
    { code: "MAP", email: "map@tnf.test", alt_email: "map-alt@tnf.test" },
    { code: "GD", email: "gd@tnf.test", alt_email: null },
    { code: "DN", email: null, alt_email: null },
  ];
  const derived = ["h1@tnf.test", "H2@tnf.test", "avd@tnf.test", "rm@tnf.test", "map-alt@tnf.test", "gd@tnf.test", "h1@tnf.test"];

  it("puts Anthony alone on To and RM and MAP on Cc; DN having no address does not matter", () => {
    const e = dayEnvelope(owners, "avd@tnf.test", derived);
    expect(e.to).toEqual(["avd@tnf.test"]);
    expect(e.cc).toEqual(["rm@tnf.test", "map@tnf.test"]);
    // An owner who holds a block (GD) is in Bcc as a holder; an alt never is.
    expect(e.bcc).toEqual(["gd@tnf.test", "h1@tnf.test", "h2@tnf.test"]);
  });

  it("is what envelopeFor builds for all three keys, and it takes no override", () => {
    for (const k of ["kickoff_2026-11-24", "gameday_2026-11-25", "winners_2026-11-25"]) {
      expect(envelopeFor(k, { adminEmail: "avd@tnf.test", owners, derived })).toEqual(dayEnvelope(owners, "avd@tnf.test", derived));
      expect(() => envelopeFor(k, { adminEmail: "avd@tnf.test", owners, derived, omit: ["DN"] })).toThrow(/leaves no owner off/);
    }
  });

  it("refuses when RM or MAP has no address, or AVD is not ADMIN_EMAIL", () => {
    expect(() => dayEnvelope(owners.map((o) => (o.code === "RM" ? { ...o, email: null } : o)), "avd@tnf.test", derived)).toThrow(/owner RM has no address/);
    expect(() => dayEnvelope(owners, "someone@tnf.test", derived)).toThrow(/not ADMIN_EMAIL/);
  });

  it("lets the Bcc check carry an owner who holds a block, never an alt", () => {
    const e = dayEnvelope(owners, "avd@tnf.test", derived);
    const plan: BroadcastPlan = { event_key: "gameday_2026-11-25", p: 0, h: 5, o: 0, t: 2, x: 0, bcc_count: 3,
      to: e.to, cc: e.cc, bcc: e.bcc, omitted_owners: [] };
    plan.h = 5; plan.t = 2;
    expect(() => checkBroadcast(plan, e, owners, [], { min: 1, max: 10 }, { ownersAsHolders: true })).not.toThrow();
    expect(() => checkBroadcast(plan, e, owners, [], { min: 1, max: 10 })).toThrow(/owner address in Bcc/);
    const withAlt = { ...e, bcc: [...e.bcc, "map-alt@tnf.test"] };
    expect(() => checkBroadcast({ ...plan, bcc: withAlt.bcc, bcc_count: 4, h: 6 }, withAlt, owners, [], { min: 1, max: 10 }, { ownersAsHolders: true })).toThrow(/owner address in Bcc/);
  });
});
