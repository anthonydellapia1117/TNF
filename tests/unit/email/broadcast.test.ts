// G4 (Anthony, 2026-10-13): before a broadcast goes, print the arithmetic,
// and stop if Bcc is under 100 or over 200, if any Bcc address is an owner, or
// if the plan the database derived and the envelope the command built are not
// the same people.

import { describe, expect, it } from "vitest";
import { checkBroadcast, envelopeMd5, planArithmetic, type BroadcastPlan } from "@/lib/email/broadcast";
import type { OwnerAddress } from "@/lib/email/envelope";

const OWNERS: OwnerAddress[] = [
  { code: "AVD", email: "avd@tnf.test", alt_email: null },
  { code: "RM", email: "rm@tnf.test", alt_email: "rm-alt@tnf.test" },
  { code: "DN", email: null, alt_email: null },
];
const BCC = Array.from({ length: 5 }, (_, i) => `p${i}@tnf.test`);
const PLAN: BroadcastPlan = {
  event_key: "recruit_broadcast_2026-10-07",
  p: 4, h: 3, o: 1, t: 1, x: 0, bcc_count: 5,
  to: ["avd@tnf.test", "rm@tnf.test"],
  bcc: BCC,
  omitted_owners: ["DN"],
};
const ENV = { to: ["avd@tnf.test", "rm@tnf.test"], bcc: [...BCC] };
const RANGE = { min: 5, max: 6 };
const check = (plan = PLAN, env = ENV, omit = ["DN"], range = RANGE) => () => checkBroadcast(plan, env, OWNERS, omit, range);

describe("the broadcast arithmetic", () => {
  it("prints P + H - O - T - X = Bcc", () => {
    expect(planArithmetic(PLAN)).toBe("P 4 + H 3 - O 1 - T 1 - X 0 = Bcc 5");
  });

  it("passes when the plan and the envelope agree and Bcc is inside the range", () => {
    expect(check()).not.toThrow();
  });

  it("refuses arithmetic that does not add up, or a Bcc list that is not its count", () => {
    expect(check({ ...PLAN, o: 0 })).toThrow(/does not add up/);
    expect(check({ ...PLAN, bcc_count: 6 })).toThrow(/does not add up/);
  });

  it("refuses Bcc outside the range, at either end", () => {
    expect(check(PLAN, ENV, ["DN"], { min: 6, max: 9 })).toThrow(/Bcc is 5, outside 6 to 9/);
    expect(check(PLAN, ENV, ["DN"], { min: 1, max: 4 })).toThrow(/Bcc is 5, outside 1 to 4/);
  });

  it("refuses an owner address in Bcc, primary or alt", () => {
    const withAlt = { ...ENV, bcc: [...BCC.slice(1), "rm-alt@tnf.test"] };
    expect(check({ ...PLAN, bcc: withAlt.bcc }, withAlt)).toThrow(/owner address in Bcc/);
    const withPrimary = { ...ENV, bcc: [...BCC.slice(1), "RM@tnf.test"] };
    expect(check({ ...PLAN, bcc: withPrimary.bcc.map((a) => a.toLowerCase()) }, withPrimary)).toThrow(/owner address in Bcc/);
  });

  it("refuses an envelope that is not the plan's people", () => {
    expect(check(PLAN, { ...ENV, bcc: [...BCC.slice(1), "stray@tnf.test"] })).toThrow(/Bcc differs from the plan/);
    expect(check(PLAN, { ...ENV, to: ["avd@tnf.test"] })).toThrow(/To differs from the plan/);
  });

  it("refuses an override that is not exactly the owners the plan says have no address", () => {
    expect(check(PLAN, ENV, [])).toThrow(/override names none; owners with no address: DN/);
    expect(check(PLAN, ENV, ["DN", "RM"])).toThrow(/override names DN, RM; owners with no address: DN/);
  });
});

describe("the envelope md5", () => {
  it("is order-free and case-free, and changes when anyone changes", () => {
    const a = envelopeMd5(ENV);
    expect(envelopeMd5({ to: [...ENV.to].reverse(), bcc: [...ENV.bcc].reverse().map((x) => x.toUpperCase()) })).toBe(a);
    expect(envelopeMd5({ ...ENV, bcc: [...ENV.bcc, "p9@tnf.test"] })).not.toBe(a);
    expect(envelopeMd5({ to: ENV.bcc, bcc: ENV.to })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is the md5 of sorted To, a bar, then sorted Bcc, comma-joined: what the claim hashes", () => {
    // md5("a@x,b@x|c@x"), computed independently with md5sum. Postgres must
    // produce the same string: the claim sorts with collate "C" for this reason.
    expect(envelopeMd5({ to: ["b@x", "a@x"], bcc: ["c@x"] })).toBe("99bd6d5ad0e3b2d5928afb411d0a35e4");
  });
});
