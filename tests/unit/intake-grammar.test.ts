import { describe, expect, it } from "vitest";
import { DISPATCH, STAGEABLE_KINDS, isStageableKind } from "@/lib/pending";
import {
  ACTIONS,
  ACTION_NAMES,
  MALFORMED_KIND,
  parseAmountCents,
  parseIntake,
  parsePrefix,
  stageableKindsUsed,
  type ActionName,
} from "@/lib/intake-grammar";

const TODAY = "2026-09-10";
const opts = { todayET: TODAY };

/**
 * One fixture per action from docs/INTAKE_GRAMMAR.md, plus one drift case each
 * that must be REJECTED and must name the rule it broke. Every drift case was
 * proved to fail before this suite was called green.
 */
interface Fixture {
  subject: string;
  lines: string[];
  drift: { subject?: string; lines?: string[]; because: RegExp };
}

const S = { u: "UPDATE TNF: roster", d: "DECISION TNF: call", n: "NOTE TNF: context" };

const FIXTURES: Record<ActionName, Fixture> = {
  participant: {
    subject: S.u,
    lines: ["ACTION: participant", "NAME: Tom Nataloni", "ALIAS: TNat", "OWNER: AVD", "COUNT: 1", "SOURCE: text"],
    // Rule 3: COUNT and BLOCKS never ride together. 62 is either block 62 or
    // $31,000 of commitment, and the grammar gave no conversion rule.
    drift: { lines: ["ACTION: participant", "NAME: Tom Nataloni", "COUNT: 1", "BLOCKS: 62"], because: /rule 3/ },
  },
  claim: {
    subject: S.u,
    lines: ["ACTION: claim", "NAME: Konnor McGrorty", "BLOCKS: 51", "METHOD: requested"],
    // Rule 7: a payments.method value on a claim fails the CHECK on Approve.
    drift: { lines: ["ACTION: claim", "NAME: Konnor McGrorty", "BLOCKS: 51", "METHOD: venmo"], because: /METHOD must be one of requested/ },
  },
  contact: {
    subject: S.u,
    lines: ["ACTION: contact", "NAME: Joe Longo", "EMAIL: someone@example.com"],
    drift: { lines: ["ACTION: contact", "NAME: Joe Longo", "EMAIL: not-an-address"], because: /rule 10/ },
  },
  block_name: {
    subject: S.u,
    lines: ["ACTION: block_name", "BLOCK: 83", "DISPLAY_NAME: ROBBIE G"],
    drift: { lines: ["ACTION: block_name", "BLOCK: 101", "DISPLAY_NAME: X"], because: /outside 1-100/ },
  },
  note: {
    subject: S.n,
    lines: ["ACTION: note", "BLOCK: 23", "NOTE: the $30 Venmo was unrelated, do not re-flag"],
    drift: { subject: S.u, because: /is a NOTE TNF: action, not UPDATE/ },
  },
  payment: {
    subject: S.d,
    lines: ["ACTION: payment", "NAME: Anthony Astorga", "AMOUNT: $1000", "METHOD: venmo", "PAID_ON: 2026-09-08", "TXN: 4681784574292679976"],
    // Rule 5: not a multiple of $500 is not a block payment at all.
    drift: {
      lines: ["ACTION: payment", "NAME: Anthony Astorga", "AMOUNT: 750", "METHOD: venmo", "PAID_ON: 2026-09-08"],
      because: /rule 5: AMOUNT is not a multiple of \$500/,
    },
  },
  owner: {
    subject: S.d,
    lines: ["ACTION: owner", "NAME: Eric Nardini", "OWNER: AVD", "REASON: paid Anthony directly"],
    // DIRECT was retired by migration 13 and is rejected on insert.
    drift: { lines: ["ACTION: owner", "NAME: Eric Nardini", "OWNER: DIRECT", "REASON: x"], because: /OWNER must be one of/ },
  },
  release: {
    subject: S.d,
    lines: ["ACTION: release", "BLOCK: 78", "REASON: F Chili asked out"],
    drift: { lines: ["ACTION: release", "BLOCK: 78"], because: /release needs REASON/ },
  },
  refund: {
    subject: S.d,
    lines: ["ACTION: refund", "NAME: Raychel Neil", "BLOCK: 1", "AMOUNT: 500", "TXN: 4678217450148051522", "REASON: released, payment on file"],
    drift: { lines: ["ACTION: refund", "NAME: Raychel Neil", "BLOCK: 1", "AMOUNT: 500.00", "TXN: 1", "REASON: x"], because: /no cents/ },
  },
  queue: {
    subject: S.d,
    lines: ["ACTION: queue", "ID: 806526bf-7d90-41a5-9119-8785ebc3ffa3", "VERDICT: dismiss"],
    drift: { lines: ["ACTION: queue", "ID: 806526bf-7d90-41a5-9119-8785ebc3ffa3", "VERDICT: Dismiss"], because: /VERDICT must be one of approve dismiss/ },
  },
  identity: {
    subject: S.d,
    lines: ["ACTION: identity", "KEEP: Raychel Neil", "OTHER: Ray Vassallo", "NOTE: confirmed by text"],
    drift: { subject: S.u, because: /is a DECISION TNF: action, not UPDATE/ },
  },
};

function ok(f: Fixture) {
  const r = parseIntake(f.subject, f.lines.join("\n"), opts);
  if (!r.ok) throw new Error(`fixture did not parse: ${r.errors.join(" | ")}`);
  return r.intake;
}

describe("the menu is covered", () => {
  it("has a fixture for every action and nothing else", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...ACTION_NAMES].sort());
  });
});

describe.each(ACTION_NAMES)("%s", (name) => {
  const f = FIXTURES[name];

  it("parses under its own prefix", () => {
    const a = ok(f);
    expect(a.action).toBe(name);
    expect(a.prefix).toBe(ACTIONS[name].prefix);
  });

  it("is rejected when the shape drifts, naming the reason", () => {
    const r = parseIntake(f.drift.subject ?? f.subject, (f.drift.lines ?? f.lines).join("\n"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" | ")).toMatch(f.drift.because);
  });

  it("is rejected when any required key is missing", () => {
    for (const key of ACTIONS[name].required) {
      const lines = f.lines.filter((l) => !l.startsWith(`${key}: `));
      const r = parseIntake(f.subject, lines.join("\n"), opts);
      expect(r.ok, `${name} parsed without ${key}`).toBe(false);
    }
  });

  it("is rejected under a prefix that is not its own", () => {
    for (const p of ["UPDATE", "DECISION", "NOTE"] as const) {
      if (p === ACTIONS[name].prefix) continue;
      const r = parseIntake(`${p} TNF: x`, f.lines.join("\n"), opts);
      expect(r.ok, `${name} parsed under ${p}`).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toMatch(/rule 14/);
    }
  });
});

describe("the subject prefix", () => {
  it.each([
    ["UPDATE TNF: anything", "UPDATE"],
    ["DECISION TNF:", "DECISION"],
    ["NOTE TNF: x", "NOTE"],
  ])("accepts %s", (s, want) => expect(parsePrefix(s)).toBe(want));

  it.each([
    ["no colon", "UPDATE TNF x"],
    ["lower case", "update TNF: x"],
    ["no TNF tag", "UPDATE: x"],
    ["another pool", "UPDATE SURVIVOR: x"],
    ["glued", "UPDATETNF: x"],
  ])("refuses %s", (_why, s) => expect(parsePrefix(s)).toBeNull());
});

describe("the body", () => {
  const good = ["ACTION: note", "BLOCK: 23", "NOTE: fine"];

  it("needs ACTION on the first line", () => {
    const r = parseIntake(S.n, ["BLOCK: 23", "ACTION: note", "NOTE: fine"].join("\n"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/FIRST line/);
  });

  it("refuses two ACTION lines as malformed, not as two actions", () => {
    const r = parseIntake(S.n, [...good, "ACTION: note"].join("\n"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/two ACTION lines is malformed/);
  });

  it("ends the block at a blank line, so a phone signature is harmless", () => {
    const r = parseIntake(S.n, [...good, "", "Sent from my iPhone"].join("\n"), opts);
    expect(r.ok).toBe(true);
  });

  it("takes keys case-insensitively and values verbatim", () => {
    const r = parseIntake(S.n, ["action: note", "block: 23", "note:   Mixed CASE kept  "].join("\n"), opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intake.fields.NOTE).toBe("Mixed CASE kept");
  });

  it("refuses an unknown key", () => {
    const r = parseIntake(S.n, [...good, "AMOUNT: 500"].join("\n"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/AMOUNT is not a key of note/);
  });

  it("refuses an empty value rather than reading silence as one", () => {
    expect(parseIntake(S.n, ["ACTION: note", "BLOCK: 23", "NOTE:"].join("\n"), opts).ok).toBe(false);
  });

  it("refuses prose", () => {
    expect(parseIntake(S.n, [...good, "thanks man"].join("\n"), opts).ok).toBe(false);
  });

  it("refuses an action name that is not on the menu", () => {
    // Without this the menu check is dead: every other rejection in this file
    // uses a real action name, so deleting the check changed nothing.
    const r = parseIntake(S.d, ["ACTION: mark_paid", "NAME: X"].join("\n"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/rule 14: `mark_paid` is not an action/);
  });

  it("refuses COUNT on an action that is not participant, even without BLOCKS", () => {
    // The COUNT-and-BLOCKS test alone left this dead: that pair is refused by
    // the other half of rule 3 whatever action carries it.
    const r = parseIntake(S.u, ["ACTION: contact", "NAME: Joe Longo", "EMAIL: a@b.co", "COUNT: 2"].join("\n"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/rule 3: COUNT belongs to the participant action only/);
  });
});

describe("rule 4, amounts", () => {
  it.each(["500", "$500", "1500", "$1500"])("accepts %s", (v) => {
    const e: string[] = [];
    expect(parseAmountCents(v, e)).toBeGreaterThan(0);
    expect(e).toEqual([]);
  });

  it.each(["500.00", "$1,500", "1,500", "-500", "0", "five hundred", "500 dollars"])(
    "refuses %s",
    (v) => {
      const e: string[] = [];
      expect(parseAmountCents(v, e)).toBeNull();
      expect(e.length).toBeGreaterThan(0);
    },
  );

  it("converts to cents, because money is stored in cents everywhere", () => {
    expect(parseAmountCents("$1500", [])).toBe(150000);
  });
});

describe("rule 6, PAID_ON", () => {
  const pay = (paidOn: string) =>
    parseIntake(
      S.d,
      ["ACTION: payment", "NAME: X", "AMOUNT: 500", "METHOD: venmo", `PAID_ON: ${paidOn}`].join("\n"),
      opts,
    );

  it("accepts today", () => expect(pay(TODAY).ok).toBe(true));
  it("refuses the future", () => expect(pay("2026-09-11").ok).toBe(false));
  it("refuses before the season floor", () => expect(pay("2026-07-31").ok).toBe(false));
  it("refuses a date that is not real", () => expect(pay("2026-02-30").ok).toBe(false));
});

describe("what the parser cannot know without the database", () => {
  it("defers rule 11, that WHO resolves to exactly one participant", () => {
    const a = ok(FIXTURES.contact);
    expect(a.deferred).toContainEqual({ rule: 11, check: "who_resolves_to_exactly_one", value: "Joe Longo" });
  });

  it("defers rule 5, that a payment equals that participant's due_cents", () => {
    const a = ok(FIXTURES.payment);
    expect(a.deferred).toContainEqual({ rule: 5, check: "amount_equals_due_cents", amountCents: 100000 });
  });

  it("defers rule 12, that a queue ID names an open row", () => {
    const a = ok(FIXTURES.queue);
    expect(a.deferred.some((d) => d.rule === 12)).toBe(true);
  });

  it("refuses NAME and PARTICIPANT_ID together rather than picking one", () => {
    const r = parseIntake(
      S.u,
      ["ACTION: contact", "NAME: Joe Longo", "PARTICIPANT_ID: 806526bf-7d90-41a5-9119-8785ebc3ffa3", "EMAIL: a@b.co"].join("\n"),
      opts,
    );
    expect(r.ok).toBe(false);
  });
});

describe("no action stages a kind the database would refuse", () => {
  // Migration 26 closed the list after the sweep staged $500 as
  // "payment_candidate": a kind that reads like it dispatches and that no
  // dispatcher handles. This is the assertion that keeps the two in step.
  it("every staged kind is on STAGEABLE_KINDS", () => {
    for (const name of ACTION_NAMES) {
      const k = ACTIONS[name].stages;
      if (k === null) continue;
      expect(isStageableKind(k), `${name} stages \`${k}\``).toBe(true);
    }
  });

  it("the malformed kind is on the list too", () => {
    expect(isStageableKind(MALFORMED_KIND)).toBe(true);
  });

  it("stageableKindsUsed names only real kinds", () => {
    const used = stageableKindsUsed();
    expect(used.length).toBeGreaterThan(0);
    for (const k of used) expect(STAGEABLE_KINDS).toContain(k);
  });

  it("refuses payment_candidate, the kind that cost two days", () => {
    expect(isStageableKind("payment_candidate")).toBe(false);
  });

  it("every dispatching kind names a real DISPATCH entry", () => {
    for (const name of ACTION_NAMES) {
      const k = ACTIONS[name].stages;
      if (k === null) continue;
      if (!(k in DISPATCH)) continue;
      expect(DISPATCH[k].rpc).not.toBeNull();
    }
  });
});

describe("UPDATE never does a DECISION's job", () => {
  it.each(["payment", "release", "refund", "identity", "owner"])(
    "%s is DECISION only",
    (n) => expect(ACTIONS[n as ActionName].prefix).toBe("DECISION"),
  );
});
