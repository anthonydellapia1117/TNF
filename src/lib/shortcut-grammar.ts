// The shortcut grammar. Anthony writes one message, the sweep parses it into
// exactly one staged queue item — no prose, no inference, no guessing.
//
// Subject: `<PREFIX> TNF: <action> - <target>`
// Body:    one `KEY: VALUE` per line, no blank lines, one action per message.
//
// Three things this file exists to stop, each of which has already cost a
// round trip or nearly cost money:
//
// 1. A message the sweep half-understands. Anything that does not match the
//    shape exactly is REJECTED with a reason. There is no partial parse and
//    no best guess: an unparsed message is a message Anthony rewrites, which
//    is cheap. A misparsed message is a wrong row in the ledger.
// 2. A kind that stages fine and then does nothing. pending_actions.kind has
//    no enum, only length 1-64, so a typo inserts happily and Approve silently
//    applies nothing. Every action here declares its `dispatch`, and
//    `tests/unit/shortcut-grammar.test.ts` asserts each non-null one is a real
//    key of DISPATCH in src/lib/pending.ts.
// 3. A body carrying something that must not be written down. Email, phone,
//    passwords, pool totals, margin, undrawn digits and anything Survivor are
//    rejected by the parser, not merely discouraged by the doc.
//
// UPDATE states a fact. It never marks paid, never resolves an identity and
// never releases a block — those are DECISION only, and the prefix is checked
// against the action, so `UPDATE TNF: payment - ...` is refused.
import { DISPATCH } from "@/lib/pending";

export const PREFIXES = ["UPDATE", "DECISION", "NOTE"] as const;
export type Prefix = (typeof PREFIXES)[number];

/** participants.source — the channel the person came in on. */
export const SOURCES = ["email", "text", "in_person", "import"] as const;
/** blocks.assignment_method — how the block came to be theirs. */
export const ASSIGN_METHODS = ["requested", "carryover", "random", "admin"] as const;
/** blocks.status — the four the check constraint allows. */
export const BLOCK_STATUSES = ["available", "reserved", "assigned", "held"] as const;
/** participants.owner_group — who collects and holds that $500. */
export const OWNER_GROUPS = ["AVD", "MAP", "RM", "JPOD", "EJD", "NL", "GD", "BG"] as const;
/** payments.method, less `correction` and `comp`, which never arrive by note. */
export const PAY_METHODS = ["venmo", "cash", "check"] as const;

export const PRICE_PER_BLOCK_DOLLARS = 500;
export const MAX_BLOCK = 100;

export type ActionName =
  | "block-request"
  | "new-participant"
  | "owner-move"
  | "contact"
  | "payment"
  | "release-block"
  | "hold-block"
  | "comp"
  | "identity"
  | "note";

export interface ActionSpec {
  prefix: Prefix;
  /** pending_actions.kind this action stages. */
  kind: string;
  /** The admin_* RPC admin_approve_pending runs, or null for decision-only. */
  dispatch: "admin_record_payment" | "admin_reserve_blocks" | null;
  required: readonly string[];
  optional: readonly string[];
  /** One line for the doc and for the queue row. */
  what: string;
}

/**
 * The menu. Adding a row here without adding a fixture in
 * tests/unit/shortcut-grammar.test.ts fails the suite on purpose.
 */
export const ACTIONS: Record<ActionName, ActionSpec> = {
  "block-request": {
    prefix: "UPDATE",
    kind: "reserve_blocks",
    dispatch: "admin_reserve_blocks",
    required: ["PARTICIPANT", "BLOCKS", "ASSIGN"],
    optional: ["OWNER", "REF", "NOTE"],
    what: "Reserve the listed blocks for someone who asked for those numbers.",
  },
  "new-participant": {
    prefix: "UPDATE",
    kind: "new_participant",
    dispatch: null,
    required: ["FULL_NAME", "ALIAS", "OWNER", "COUNT", "SOURCE", "SOURCE_DATE"],
    optional: ["SOURCE_REF", "NOTE"],
    what: "A new person is in. Records who, whose book, how many, how they came.",
  },
  "owner-move": {
    prefix: "UPDATE",
    kind: "owner_move",
    dispatch: null,
    required: ["PARTICIPANT", "FROM_OWNER", "TO_OWNER", "REASON"],
    optional: ["NOTE"],
    what: "A participant moves to another owner's book.",
  },
  contact: {
    prefix: "UPDATE",
    kind: "contact_change",
    dispatch: null,
    required: ["PARTICIPANT", "CONTACT_FIELD", "SOURCE_MSG"],
    optional: ["NOTE"],
    what: "Contact details changed. The value is never in the body - read the message.",
  },
  payment: {
    prefix: "DECISION",
    kind: "payment",
    dispatch: "admin_record_payment",
    required: ["PARTICIPANT", "AMOUNT", "BLOCKS_COVERED", "PAY_METHOD", "PAID_ON"],
    optional: ["VENMO_TXN", "OWNER_HOLDING", "SOURCE_MSG", "NOTE"],
    what: "Money in. The only action that marks anything paid.",
  },
  "release-block": {
    prefix: "DECISION",
    kind: "release_block",
    dispatch: null,
    required: ["BLOCKS", "TO_STATUS", "REASON"],
    optional: ["PARTICIPANT", "NOTE"],
    what: "Release a block back to the board. The prior holder stays in its notes.",
  },
  "hold-block": {
    prefix: "DECISION",
    kind: "hold_block",
    dispatch: null,
    required: ["BLOCKS", "TO_STATUS", "REASON"],
    optional: ["NOTE"],
    what: "Take a block off the board without giving it to anyone.",
  },
  comp: {
    prefix: "DECISION",
    kind: "set_comped",
    dispatch: null,
    required: ["PARTICIPANT", "BLOCKS", "COMPED", "REASON"],
    optional: ["NOTE"],
    what: "Comp a block, or take the comp off. Admin-only, never public.",
  },
  identity: {
    prefix: "DECISION",
    kind: "identity",
    dispatch: null,
    required: ["PARTICIPANT", "OTHER", "SAME_PERSON", "REASON"],
    optional: ["NOTE"],
    what: "Two names are one person, or are not. The only action that settles identity.",
  },
  note: {
    prefix: "NOTE",
    kind: "note",
    dispatch: null,
    required: ["SUBJECT_TYPE", "SUBJECT", "NOTE"],
    optional: ["SOURCE_MSG"],
    what: "Context for the record. Changes nothing, ever.",
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export interface ParsedAction {
  prefix: Prefix;
  action: ActionName;
  target: string;
  kind: string;
  dispatch: ActionSpec["dispatch"];
  fields: Record<string, string>;
  payload: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; action: ParsedAction }
  | { ok: false; errors: string[] };

// --- the redaction guard ----------------------------------------------------
// Anything below is refused outright. The body is a permanent audit payload,
// so this is the last place to stop a phone number or a pool total from
// becoming a row nobody can delete.

const BANNED_KEYS = new Set([
  "EMAIL", "CC_EMAIL", "E_MAIL", "ADDRESS", "PHONE", "MOBILE", "CELL",
  "PASSWORD", "PASSCODE", "PIN", "SECRET", "TOKEN",
  "TOTAL", "TOTALS", "COLLECTED", "OWED", "POT", "MARGIN", "HOUSE", "PROFIT",
  "BREAK_EVEN", "PAYOUT_TOTAL", "LIABILITY",
  "DIGITS", "ROW_DIGITS", "COL_DIGITS", "REVEAL",
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// A phone is 10 or 11 digits. A Venmo transaction id is 19, so it is not
// caught here - that was checked against a real id, not assumed.
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{10,11}\b/;
const SURVIVOR_RE = /survivor/i;

function redactionErrors(key: string, value: string): string[] {
  const out: string[] = [];
  if (BANNED_KEYS.has(key)) {
    out.push(`${key} is not allowed in a body: no contact details, no totals, no digits, no secrets`);
  }
  if (EMAIL_RE.test(value)) out.push(`${key} looks like an email address, which never goes in a body`);
  if (PHONE_RE.test(value)) out.push(`${key} looks like a phone number, which never goes in a body`);
  if (SURVIVOR_RE.test(value)) out.push(`${key} mentions the other pool; this repo never touches it`);
  return out;
}

// --- subject ----------------------------------------------------------------

const SUBJECT_RE = /^(UPDATE|DECISION|NOTE) TNF: ([a-z][a-z-]*) - (.+)$/;
const MAX_TARGET = 80;

interface SubjectParts {
  prefix: Prefix;
  action: ActionName;
  target: string;
}

function parseSubject(subject: string, errors: string[]): SubjectParts | null {
  const m = SUBJECT_RE.exec(subject.trim());
  if (!m) {
    errors.push(
      "subject must be `<UPDATE|DECISION|NOTE> TNF: <action> - <target>`, exactly one space after the colon and ` - ` around the dash",
    );
    return null;
  }
  const [, prefix, action, rawTarget] = m;
  const target = rawTarget.trim();
  if (!ACTION_NAMES.includes(action as ActionName)) {
    errors.push(`unknown action \`${action}\`; the menu is ${ACTION_NAMES.join(", ")}`);
    return null;
  }
  const name = action as ActionName;
  const spec = ACTIONS[name];
  if (spec.prefix !== prefix) {
    errors.push(
      `\`${action}\` is a ${spec.prefix} action, not ${prefix}` +
        (spec.prefix === "DECISION"
          ? " - UPDATE never marks paid, resolves an identity or releases a block"
          : ""),
    );
    return null;
  }
  if (target.length === 0 || target.length > MAX_TARGET) {
    errors.push(`target must be 1-${MAX_TARGET} characters`);
    return null;
  }
  return { prefix: prefix as Prefix, action: name, target };
}

// --- body -------------------------------------------------------------------

const LINE_RE = /^([A-Z][A-Z0-9_]*): (.+)$/;

function parseBody(body: string, errors: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  // \r\n and a trailing newline are the mail client's, not the author's.
  const lines = body.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines.length === 1 && lines[0].trim() === "") {
    errors.push("body is empty; every action carries at least one KEY: VALUE line");
    return fields;
  }
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.trim() === "") {
      errors.push(`line ${n}: blank line; a body is KEY: VALUE lines and nothing else`);
      return;
    }
    if (line !== line.trim()) {
      errors.push(`line ${n}: leading or trailing whitespace`);
      return;
    }
    const m = LINE_RE.exec(line);
    if (!m) {
      errors.push(`line ${n}: not \`KEY: VALUE\` (uppercase key, one space after the colon, no prose)`);
      return;
    }
    const [, key, rawValue] = m;
    const value = rawValue.trim();
    if (value === "") {
      errors.push(`line ${n}: ${key} has no value`);
      return;
    }
    if (key in fields) {
      errors.push(`line ${n}: ${key} appears twice; one action per message, one value per key`);
      return;
    }
    const bad = redactionErrors(key, value);
    if (bad.length > 0) {
      errors.push(...bad.map((b) => `line ${n}: ${b}`));
      return;
    }
    fields[key] = value;
  });
  return fields;
}

// --- value validators --------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(key: string, v: string, errors: string[]): void {
  if (!DATE_RE.test(v)) {
    errors.push(`${key} must be YYYY-MM-DD`);
    return;
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    errors.push(`${key} is not a real date`);
  }
}

function checkEnum(key: string, v: string, allowed: readonly string[], errors: string[]): void {
  if (!allowed.includes(v)) errors.push(`${key} must be one of ${allowed.join(", ")}`);
}

function checkBool(key: string, v: string, errors: string[]): void {
  if (v !== "yes" && v !== "no") errors.push(`${key} must be yes or no`);
}

/** Whole dollars. No `$`, no cents, no sign, no thousands separator. */
function parseDollars(key: string, v: string, errors: string[]): number | null {
  if (!/^\d+$/.test(v)) {
    errors.push(`${key} must be whole dollars with no $, no cents, no sign (e.g. 500)`);
    return null;
  }
  const n = Number(v);
  if (n <= 0) {
    errors.push(`${key} must be more than zero`);
    return null;
  }
  return n;
}

function parseBlocks(key: string, v: string, errors: string[]): number[] | null {
  const parts = v.split(",").map((p) => p.trim());
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      errors.push(`${key} must be block numbers separated by commas (e.g. 23 or 7, 51)`);
      return null;
    }
    const n = Number(p);
    if (n < 1 || n > MAX_BLOCK) {
      errors.push(`${key}: block ${n} is outside 1-${MAX_BLOCK}`);
      return null;
    }
    if (out.includes(n)) {
      errors.push(`${key}: block ${n} listed twice`);
      return null;
    }
    out.push(n);
  }
  return out.length > 0 ? out : null;
}

function parseCount(key: string, v: string, errors: string[]): number | null {
  if (!/^\d+$/.test(v)) {
    errors.push(`${key} must be a whole number`);
    return null;
  }
  const n = Number(v);
  if (n < 1 || n > MAX_BLOCK) {
    errors.push(`${key} must be 1-${MAX_BLOCK}`);
    return null;
  }
  return n;
}

// --- per-action payloads ------------------------------------------------------

function buildPayload(
  name: ActionName,
  target: string,
  f: Record<string, string>,
  errors: string[],
): Record<string, unknown> {
  const p: Record<string, unknown> = { target };
  const put = (k: string, v: unknown) => {
    if (v !== null && v !== undefined) p[k] = v;
  };

  if ("OWNER" in f) checkEnum("OWNER", f.OWNER, OWNER_GROUPS, errors);
  if ("SOURCE" in f) checkEnum("SOURCE", f.SOURCE, SOURCES, errors);
  if ("SOURCE_DATE" in f) checkDate("SOURCE_DATE", f.SOURCE_DATE, errors);
  if ("ASSIGN" in f) checkEnum("ASSIGN", f.ASSIGN, ASSIGN_METHODS, errors);

  switch (name) {
    case "block-request": {
      const blocks = parseBlocks("BLOCKS", f.BLOCKS, errors);
      put("participant_name", f.PARTICIPANT);
      put("block_numbers", blocks);
      put("method", f.ASSIGN);
      put("ref", f.REF);
      break;
    }
    case "new-participant": {
      put("full_name", f.FULL_NAME);
      put("display_alias", f.ALIAS);
      put("owner_group", f.OWNER);
      put("blocks_requested", parseCount("COUNT", f.COUNT, errors));
      put("source", f.SOURCE);
      put("source_date", f.SOURCE_DATE);
      put("source_ref", f.SOURCE_REF);
      break;
    }
    case "owner-move": {
      checkEnum("FROM_OWNER", f.FROM_OWNER, OWNER_GROUPS, errors);
      checkEnum("TO_OWNER", f.TO_OWNER, OWNER_GROUPS, errors);
      if (f.FROM_OWNER === f.TO_OWNER) errors.push("FROM_OWNER and TO_OWNER are the same");
      put("participant_name", f.PARTICIPANT);
      put("from_owner", f.FROM_OWNER);
      put("to_owner", f.TO_OWNER);
      put("reason", f.REASON);
      break;
    }
    case "contact": {
      checkEnum("CONTACT_FIELD", f.CONTACT_FIELD, ["email", "phone"], errors);
      put("participant_name", f.PARTICIPANT);
      put("contact_field", f.CONTACT_FIELD);
      put("source_message_id", f.SOURCE_MSG);
      break;
    }
    case "payment": {
      const dollars = parseDollars("AMOUNT", f.AMOUNT, errors);
      const covered = parseCount("BLOCKS_COVERED", f.BLOCKS_COVERED, errors);
      checkEnum("PAY_METHOD", f.PAY_METHOD, PAY_METHODS, errors);
      checkDate("PAID_ON", f.PAID_ON, errors);
      if (dollars !== null && covered !== null) {
        const expected = covered * PRICE_PER_BLOCK_DOLLARS;
        if (dollars !== expected) {
          errors.push(
            `AMOUNT ${dollars} does not equal $${PRICE_PER_BLOCK_DOLLARS} x ${covered} blocks (${expected}); a part payment is a question for Anthony, not a row`,
          );
        }
      }
      if (f.OWNER_HOLDING !== undefined) checkEnum("OWNER_HOLDING", f.OWNER_HOLDING, OWNER_GROUPS, errors);
      put("participant_name", f.PARTICIPANT);
      // Money is stored in CENTS everywhere. The body is whole dollars because
      // that is what a person types; the conversion happens exactly here.
      put("amount_cents", dollars === null ? null : dollars * 100);
      put("blocks_covered", covered);
      put("method", f.PAY_METHOD);
      put("paid_on", f.PAID_ON);
      put("venmo_txn_id", f.VENMO_TXN);
      put("source_ref", f.OWNER_HOLDING ? `held by ${f.OWNER_HOLDING}` : undefined);
      break;
    }
    case "release-block":
    case "hold-block": {
      const want = name === "release-block" ? "available" : "held";
      checkEnum("TO_STATUS", f.TO_STATUS, BLOCK_STATUSES, errors);
      if (f.TO_STATUS !== want) {
        errors.push(`${name} must end at TO_STATUS: ${want}`);
      }
      put("block_numbers", parseBlocks("BLOCKS", f.BLOCKS, errors));
      put("to_status", f.TO_STATUS);
      put("reason", f.REASON);
      put("participant_name", f.PARTICIPANT);
      break;
    }
    case "comp": {
      checkBool("COMPED", f.COMPED, errors);
      put("participant_name", f.PARTICIPANT);
      put("block_numbers", parseBlocks("BLOCKS", f.BLOCKS, errors));
      put("comped", f.COMPED === "yes");
      put("reason", f.REASON);
      break;
    }
    case "identity": {
      checkBool("SAME_PERSON", f.SAME_PERSON, errors);
      put("participant_name", f.PARTICIPANT);
      put("other", f.OTHER);
      put("same_person", f.SAME_PERSON === "yes");
      put("reason", f.REASON);
      break;
    }
    case "note": {
      checkEnum("SUBJECT_TYPE", f.SUBJECT_TYPE, ["participant", "block", "game", "pool"], errors);
      put("subject_type", f.SUBJECT_TYPE);
      put("subject", f.SUBJECT);
      put("source_message_id", f.SOURCE_MSG);
      break;
    }
  }
  if (f.NOTE !== undefined) put("note", f.NOTE);
  return p;
}

/**
 * Parse one message. Either a complete action or a list of reasons, never a
 * partial result: the sweep stages what comes back ok and replies with the
 * errors when it does not.
 */
export function parseShortcut(subject: string, body: string): ParseResult {
  const errors: string[] = [];
  const head = parseSubject(subject, errors);
  const fields = parseBody(body, errors);
  if (head === null) return { ok: false, errors };

  const spec = ACTIONS[head.action];
  for (const key of spec.required) {
    if (!(key in fields)) errors.push(`${head.action} needs ${key}`);
  }
  const allowed = new Set<string>([...spec.required, ...spec.optional]);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) {
      errors.push(
        `${key} is not a key of ${head.action}; it takes ${[...allowed].sort().join(", ")}`,
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const payload = buildPayload(head.action, head.target, fields, errors);
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    action: {
      prefix: head.prefix,
      action: head.action,
      target: head.target,
      kind: spec.kind,
      dispatch: spec.dispatch,
      fields,
      payload,
    },
  };
}

/**
 * True when approving this action actually applies something. Everything else
 * records the decision and waits for Anthony on the right admin page - which
 * is correct, but only when it is said out loud rather than discovered.
 */
export function appliesOnApprove(action: ParsedAction): boolean {
  return action.dispatch !== null && action.kind in DISPATCH;
}
