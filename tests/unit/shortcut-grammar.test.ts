import { describe, expect, it } from "vitest";
import { DISPATCH } from "@/lib/pending";
import {
  ACTIONS,
  ACTION_NAMES,
  appliesOnApprove,
  parseShortcut,
  type ActionName,
  type ParsedAction,
} from "@/lib/shortcut-grammar";

/**
 * One fixture per menu action. Each carries the exact message Anthony would
 * send and the exact payload the sweep must stage, asserted with toEqual so
 * an added, renamed or dropped payload key fails rather than passing quietly.
 *
 * `drift` is the same message with one thing wrong. Every fixture is proved to
 * fail before it is called green: the drift case must be REJECTED, and the
 * reason must name the thing that drifted.
 */
interface Fixture {
  subject: string;
  body: string;
  kind: string;
  dispatch: ParsedAction["dispatch"];
  payload: Record<string, unknown>;
  drift: { subject?: string; body?: string; because: RegExp };
}

const FIXTURES: Record<ActionName, Fixture> = {
  "block-request": {
    subject: "UPDATE TNF: block-request - Konnor McGrorty",
    body: ["PARTICIPANT: Konnor McGrorty", "BLOCKS: 51", "ASSIGN: requested", "REF: text 2026-11-02"].join("\n"),
    kind: "reserve_blocks",
    dispatch: "admin_reserve_blocks",
    payload: {
      target: "Konnor McGrorty",
      participant_name: "Konnor McGrorty",
      block_numbers: [51],
      method: "requested",
      ref: "text 2026-11-02",
    },
    // 101 is off the board. A block number outside 1-100 must never reach the RPC.
    drift: { body: ["PARTICIPANT: Konnor McGrorty", "BLOCKS: 101", "ASSIGN: requested"].join("\n"), because: /outside 1-100/ },
  },
  "new-participant": {
    subject: "UPDATE TNF: new-participant - TNat",
    body: [
      "FULL_NAME: Tom Nataloni",
      "ALIAS: TNat",
      "OWNER: AVD",
      "COUNT: 1",
      "SOURCE: text",
      "SOURCE_DATE: 2026-11-03",
    ].join("\n"),
    kind: "new_participant",
    dispatch: null,
    payload: {
      target: "TNat",
      full_name: "Tom Nataloni",
      display_alias: "TNat",
      owner_group: "AVD",
      blocks_requested: 1,
      source: "text",
      source_date: "2026-11-03",
    },
    // DIRECT was retired by migration 13 and is rejected on insert.
    drift: {
      body: [
        "FULL_NAME: Tom Nataloni",
        "ALIAS: TNat",
        "OWNER: DIRECT",
        "COUNT: 1",
        "SOURCE: text",
        "SOURCE_DATE: 2026-11-03",
      ].join("\n"),
      because: /OWNER must be one of/,
    },
  },
  "owner-move": {
    subject: "UPDATE TNF: owner-move - Eric Nardini",
    body: [
      "PARTICIPANT: Eric Nardini",
      "FROM_OWNER: RM",
      "TO_OWNER: AVD",
      "REASON: paid Anthony directly",
    ].join("\n"),
    kind: "owner_move",
    dispatch: null,
    payload: {
      target: "Eric Nardini",
      participant_name: "Eric Nardini",
      from_owner: "RM",
      to_owner: "AVD",
      reason: "paid Anthony directly",
    },
    drift: {
      body: ["PARTICIPANT: Eric Nardini", "FROM_OWNER: AVD", "TO_OWNER: AVD", "REASON: none"].join("\n"),
      because: /FROM_OWNER and TO_OWNER are the same/,
    },
  },
  contact: {
    subject: "UPDATE TNF: contact - Joe Longo",
    body: ["PARTICIPANT: Joe Longo", "CONTACT_FIELD: email", "SOURCE_MSG: 1a08191d7a73907a"].join("\n"),
    kind: "contact_change",
    dispatch: null,
    payload: {
      target: "Joe Longo",
      participant_name: "Joe Longo",
      contact_field: "email",
      source_message_id: "1a08191d7a73907a",
    },
    // The whole point of this action: the address stays in the message.
    drift: {
      body: ["PARTICIPANT: Joe Longo", "CONTACT_FIELD: email", "SOURCE_MSG: joe.longo@example.com"].join("\n"),
      because: /looks like an email address/,
    },
  },
  payment: {
    subject: "DECISION TNF: payment - Anthony Astorga",
    body: [
      "PARTICIPANT: Anthony Astorga",
      "AMOUNT: 1000",
      "BLOCKS_COVERED: 2",
      "PAY_METHOD: venmo",
      "PAID_ON: 2026-11-03",
      "VENMO_TXN: 4681784574292679976",
    ].join("\n"),
    kind: "payment",
    dispatch: "admin_record_payment",
    payload: {
      target: "Anthony Astorga",
      participant_name: "Anthony Astorga",
      amount_cents: 100000,
      blocks_covered: 2,
      method: "venmo",
      paid_on: "2026-11-03",
      venmo_txn_id: "4681784574292679976",
    },
    // $500 for a two-block holder is a part payment: a question, not a row.
    drift: {
      body: [
        "PARTICIPANT: Anthony Astorga",
        "AMOUNT: 500",
        "BLOCKS_COVERED: 2",
        "PAY_METHOD: venmo",
        "PAID_ON: 2026-11-03",
      ].join("\n"),
      because: /does not equal \$500 x 2 blocks/,
    },
  },
  "release-block": {
    subject: "DECISION TNF: release-block - block 78",
    body: ["BLOCKS: 78", "TO_STATUS: available", "REASON: F Chili asked out", "PARTICIPANT: F Chili"].join("\n"),
    kind: "release_block",
    dispatch: null,
    payload: {
      target: "block 78",
      block_numbers: [78],
      to_status: "available",
      reason: "F Chili asked out",
      participant_name: "F Chili",
    },
    // A release that lands anywhere but available is not a release.
    drift: {
      body: ["BLOCKS: 78", "TO_STATUS: held", "REASON: F Chili asked out"].join("\n"),
      because: /release-block must end at TO_STATUS: available/,
    },
  },
  "hold-block": {
    subject: "DECISION TNF: hold-block - block 42",
    body: ["BLOCKS: 42", "TO_STATUS: held", "REASON: disputed between two askers"].join("\n"),
    kind: "hold_block",
    dispatch: null,
    payload: {
      target: "block 42",
      block_numbers: [42],
      to_status: "held",
      reason: "disputed between two askers",
    },
    drift: {
      body: ["BLOCKS: 42", "TO_STATUS: pending", "REASON: disputed"].join("\n"),
      because: /TO_STATUS must be one of available, reserved, assigned, held/,
    },
  },
  comp: {
    subject: "DECISION TNF: comp - Ed D",
    body: ["PARTICIPANT: Ed D", "BLOCKS: 12", "COMPED: yes", "REASON: ran the grid in 2025"].join("\n"),
    kind: "set_comped",
    dispatch: null,
    payload: {
      target: "Ed D",
      participant_name: "Ed D",
      block_numbers: [12],
      comped: true,
      reason: "ran the grid in 2025",
    },
    drift: {
      body: ["PARTICIPANT: Ed D", "BLOCKS: 12", "COMPED: true", "REASON: ran the grid"].join("\n"),
      because: /COMPED must be yes or no/,
    },
  },
  identity: {
    subject: "DECISION TNF: identity - Raychel Neil",
    body: [
      "PARTICIPANT: Raychel Neil",
      "OTHER: Ray Vassallo",
      "SAME_PERSON: yes",
      "REASON: confirmed by text",
    ].join("\n"),
    kind: "identity",
    dispatch: null,
    payload: {
      target: "Raychel Neil",
      participant_name: "Raychel Neil",
      other: "Ray Vassallo",
      same_person: true,
      reason: "confirmed by text",
    },
    // Identity is DECISION only. UPDATE never resolves one.
    drift: { subject: "UPDATE TNF: identity - Raychel Neil", because: /is a DECISION action, not UPDATE/ },
  },
  note: {
    subject: "NOTE TNF: note - block 23",
    body: ["SUBJECT_TYPE: block", "SUBJECT: 23", "NOTE: $30 Venmo was a Survivor entry, do not re-flag"].join("\n"),
    kind: "note",
    dispatch: null,
    payload: { target: "block 23", subject_type: "block", subject: "23", note: "" },
    drift: { body: ["SUBJECT_TYPE: player", "SUBJECT: 23", "NOTE: context"].join("\n"), because: /SUBJECT_TYPE must be one of/ },
  },
};

// The note fixture above deliberately names the other pool, which the parser
// refuses. Fix it here so the fixture reads as the real rule it demonstrates.
FIXTURES.note.body = ["SUBJECT_TYPE: block", "SUBJECT: 23", "NOTE: the $30 Venmo was unrelated, do not re-flag"].join("\n");
FIXTURES.note.payload = {
  target: "block 23",
  subject_type: "block",
  subject: "23",
  note: "the $30 Venmo was unrelated, do not re-flag",
};

function parseOk(f: Fixture): ParsedAction {
  const r = parseShortcut(f.subject, f.body);
  if (!r.ok) throw new Error(`fixture did not parse: ${r.errors.join(" | ")}`);
  return r.action;
}

describe("the menu is covered", () => {
  it("has a fixture for every action and no fixture for anything else", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...ACTION_NAMES].sort());
  });
});

describe.each(ACTION_NAMES)("%s", (name) => {
  const f = FIXTURES[name];

  it("parses to exactly the expected payload", () => {
    const a = parseOk(f);
    expect(a.action).toBe(name);
    expect(a.kind).toBe(f.kind);
    expect(a.dispatch).toBe(f.dispatch);
    expect(a.payload).toEqual(f.payload);
  });

  it("carries the prefix its action declares", () => {
    expect(parseOk(f).prefix).toBe(ACTIONS[name].prefix);
  });

  it("is rejected when the shape drifts, for the stated reason", () => {
    const r = parseShortcut(f.drift.subject ?? f.subject, f.drift.body ?? f.body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" | ")).toMatch(f.drift.because);
  });

  it("is rejected when any required key is missing", () => {
    for (const key of ACTIONS[name].required) {
      const body = f.body
        .split("\n")
        .filter((l) => !l.startsWith(`${key}: `))
        .join("\n");
      const r = parseShortcut(f.subject, body);
      expect(r.ok, `${name} parsed without ${key}`).toBe(false);
      if (!r.ok) expect(r.errors.join(" | ")).toContain(`needs ${key}`);
    }
  });
});

describe("the subject line", () => {
  const good = "DECISION TNF: payment - Anthony Astorga";
  it.each([
    ["no prefix", "TNF: payment - Anthony Astorga"],
    ["lowercase prefix", "decision TNF: payment - Anthony Astorga"],
    ["no TNF tag", "DECISION: payment - Anthony Astorga"],
    ["another pool's tag", "DECISION SURVIVOR: payment - Anthony Astorga"],
    ["em dash instead of ` - `", "DECISION TNF: payment — Anthony Astorga"],
    ["no target", "DECISION TNF: payment - "],
    ["two spaces after the colon", "DECISION TNF:  payment - Anthony Astorga"],
  ])("refuses %s", (_why, subject) => {
    expect(parseShortcut(subject, FIXTURES.payment.body).ok).toBe(false);
  });

  it("accepts the good one", () => {
    expect(parseShortcut(good, FIXTURES.payment.body).ok).toBe(true);
  });

  it("refuses an action that is not on the menu", () => {
    const r = parseShortcut("DECISION TNF: mark-paid - Anthony Astorga", "PARTICIPANT: x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown action `mark-paid`/);
  });
});

describe("the body is KEY: VALUE and nothing else", () => {
  const subject = "NOTE TNF: note - block 23";
  const base = ["SUBJECT_TYPE: block", "SUBJECT: 23", "NOTE: fine"];

  it("refuses a blank line", () => {
    const r = parseShortcut(subject, ["SUBJECT_TYPE: block", "", "SUBJECT: 23", "NOTE: fine"].join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/blank line/);
  });

  it("refuses prose", () => {
    const r = parseShortcut(subject, [...base, "Hey Anthony, one more thing."].join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/not `KEY: VALUE`/);
  });

  it("refuses a lowercase key", () => {
    expect(parseShortcut(subject, ["subject_type: block", "SUBJECT: 23", "NOTE: fine"].join("\n")).ok).toBe(false);
  });

  it("refuses an empty value", () => {
    expect(parseShortcut(subject, ["SUBJECT_TYPE: block", "SUBJECT: 23", "NOTE: "].join("\n")).ok).toBe(false);
  });

  it("refuses the same key twice", () => {
    const r = parseShortcut(subject, [...base, "NOTE: and again"].join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/appears twice/);
  });

  it("refuses a key the action does not take", () => {
    const r = parseShortcut(subject, [...base, "AMOUNT: 500"].join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/AMOUNT is not a key of note/);
  });

  it("refuses an empty body", () => {
    expect(parseShortcut(subject, "").ok).toBe(false);
  });

  it("tolerates CRLF and a trailing newline from the mail client", () => {
    expect(parseShortcut(subject, base.join("\r\n") + "\r\n").ok).toBe(true);
  });
});

describe("what a body may never carry", () => {
  const subject = "NOTE TNF: note - pool";
  const line = (note: string) => ["SUBJECT_TYPE: pool", "SUBJECT: 2026", `NOTE: ${note}`].join("\n");

  it.each([
    ["an email address", "reach him at ron.malandro@example.com"],
    ["a dashed phone number", "his cell is 215-555-0134"],
    ["a bare ten-digit phone number", "call 2155550134"],
    ["the other pool", "same as the Survivor sheet"],
  ])("refuses %s", (_why, note) => {
    expect(parseShortcut(subject, line(note)).ok).toBe(false);
  });

  it.each(["EMAIL", "PHONE", "PASSWORD", "TOTAL", "MARGIN", "DIGITS", "COL_DIGITS"])(
    "refuses the key %s as a redaction, not merely as an unknown key",
    (key) => {
      // Asserting the REASON matters. A banned key is also not a key of `note`,
      // so `ok === false` alone stays true with the redaction guard deleted -
      // the unknown-key check would carry it, and this assertion would be dead.
      const r = parseShortcut(subject, ["SUBJECT_TYPE: pool", "SUBJECT: 2026", `${key}: whatever`].join("\n"));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" | ")).toMatch(/is not allowed in a body/);
    },
  );

  it("still accepts a 19-digit Venmo transaction id", () => {
    // The phone check is 10 or 11 digits. A real txn id is 19, checked against
    // one that actually landed in Anthony's Venmo.
    expect(parseShortcut(FIXTURES.payment.subject, FIXTURES.payment.body).ok).toBe(true);
  });
});

describe("amounts are whole dollars and $500 a block", () => {
  const subject = "DECISION TNF: payment - Someone";
  const body = (amount: string, covered = "1") =>
    [
      "PARTICIPANT: Someone",
      `AMOUNT: ${amount}`,
      `BLOCKS_COVERED: ${covered}`,
      "PAY_METHOD: venmo",
      "PAID_ON: 2026-11-03",
    ].join("\n");

  it.each(["$500", "500.00", "-500", "500 dollars", "1,000", "0"])("refuses %s", (amount) => {
    expect(parseShortcut(subject, body(amount)).ok).toBe(false);
  });

  it("refuses an amount that is not $500 a block", () => {
    expect(parseShortcut(subject, body("750")).ok).toBe(false);
    expect(parseShortcut(subject, body("1500", "2")).ok).toBe(false);
  });

  it("accepts Ed D's three blocks at $1,500 and stores cents", () => {
    const r = parseShortcut(subject, body("1500", "3"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.payload.amount_cents).toBe(150000);
  });

  it("refuses a date that is not real", () => {
    const bad = body("500").replace("2026-11-03", "2026-02-30");
    expect(parseShortcut(subject, bad).ok).toBe(false);
  });
});

describe("UPDATE never does a DECISION's job", () => {
  it.each(["payment", "release-block", "identity", "comp", "hold-block"])(
    "refuses UPDATE TNF: %s",
    (action) => {
      const f = FIXTURES[action as ActionName];
      const r = parseShortcut(f.subject.replace("DECISION", "UPDATE"), f.body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toMatch(/is a DECISION action, not UPDATE/);
    },
  );

  it("every action that marks paid, releases or settles identity is DECISION", () => {
    for (const name of ["payment", "release-block", "identity"] as ActionName[]) {
      expect(ACTIONS[name].prefix).toBe("DECISION");
    }
  });
});

describe("no action stages a kind that Approve would silently ignore", () => {
  // pending_actions.kind has no enum, only length 1-64. A kind the CASE in
  // admin_approve_pending does not know inserts fine and applies nothing, so
  // this is the assertion that keeps the grammar and the dispatch together.
  it("every non-null dispatch names a real DISPATCH entry", () => {
    for (const name of ACTION_NAMES) {
      const spec = ACTIONS[name];
      if (spec.dispatch === null) continue;
      expect(DISPATCH[spec.kind], `${name} stages kind \`${spec.kind}\``).toBeDefined();
      expect(DISPATCH[spec.kind].rpc).toBe(spec.dispatch);
    }
  });

  it("appliesOnApprove is true only for the two dispatchable kinds", () => {
    const applied = ACTION_NAMES.filter((n) => appliesOnApprove(parseOk(FIXTURES[n])));
    expect(applied.sort()).toEqual(["block-request", "payment"]);
  });

  it("every decision-only action is honest about applying nothing", () => {
    for (const name of ACTION_NAMES) {
      if (ACTIONS[name].dispatch !== null) continue;
      expect(appliesOnApprove(parseOk(FIXTURES[name]))).toBe(false);
    }
  });
});
