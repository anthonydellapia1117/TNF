// The intake parser. `docs/INTAKE_GRAMMAR.md` is the contract; this file is
// the machine-checkable half of it, and that file wins if the two disagree.
//
// Why this exists as code rather than as more prompt text: a prompt describing
// a grammar drifts from the grammar silently, and the sweep is the only thing
// in this pool that writes. A message the sweep half-understood is a wrong row
// in an append-only ledger. Here a shape error is a returned reason, and the
// unit tests fail when the shape drifts.
//
// What this CANNOT check, by construction, because it has no database:
//
//   - Rule 11, that WHO resolves to exactly one live participant.
//   - Rule 5, that a payment AMOUNT equals that participant's live due_cents.
//   - Rule 12, that a queue ID names an OPEN pending_actions row.
//
// Those three are returned in `deferred` so the sweep runs them against live
// data. A caller that ignores `deferred` has not validated the message, and
// `parseIntake` returning ok is not permission to apply anything.
import { STAGEABLE_KINDS, isStageableKind } from "@/lib/pending";

export const PREFIXES = ["UPDATE", "DECISION", "NOTE"] as const;
export type Prefix = (typeof PREFIXES)[number];

/** participants.owner_group. DIRECT was retired 2026-08-28 and is rejected. */
export const OWNER_GROUPS = ["AVD", "RM", "MAP", "JPOD", "EJD", "NL", "GD", "BG"] as const;
/** participants.source. */
export const SOURCES = ["email", "text", "in_person", "import"] as const;
/**
 * Rule 7. METHOD is two different columns and the lists do not overlap.
 * payments.method, less `correction` (needs the id of what it corrects) and
 * `comp` (an admin action, never something a text asks for).
 */
export const PAY_METHODS = ["venmo", "cash", "check"] as const;
/** blocks.assignment_method. How the block was CHOSEN, never how it is paid. */
export const CLAIM_METHODS = ["requested", "carryover", "random", "admin"] as const;
export const VERDICTS = ["approve", "dismiss"] as const;

export const MAX_BLOCK = 100;
/** Rule 6. The season floor; nothing was collected before this. */
export const SEASON_FLOOR = "2026-08-01";

export type ActionName =
  | "participant" | "claim" | "contact" | "block_name" | "note"
  | "payment" | "owner" | "release" | "refund" | "queue" | "identity";

/** A check this parser cannot make without live data. Rules 5, 11 and 12. */
export type DeferredCheck =
  | { rule: 11; check: "who_resolves_to_exactly_one"; value: string }
  | { rule: 5; check: "amount_equals_due_cents"; amountCents: number }
  | { rule: 12; check: "queue_row_is_open"; id: string };

export interface ActionSpec {
  prefix: Prefix;
  required: readonly string[];
  optional: readonly string[];
  /** Needs at least one of these, when the action says so. */
  oneOf?: readonly string[];
  /** The admin_* RPC the sweep applies, or the kind it stages instead. */
  applies: string | null;
  stages: (typeof STAGEABLE_KINDS)[number] | null;
  what: string;
}

/**
 * The menu, from docs/INTAKE_GRAMMAR.md. Rule 14: an action not here is
 * malformed, and an action under the wrong prefix is rejected by name rather
 * than silently downgraded.
 */
export const ACTIONS: Record<ActionName, ActionSpec> = {
  participant: {
    prefix: "UPDATE",
    required: [],
    oneOf: ["NAME", "PARTICIPANT_ID"],
    optional: ["ALIAS", "EMAIL", "CC_EMAIL", "PHONE", "OWNER", "SOURCE", "COUNT", "NOTE"],
    applies: "admin_upsert_participant",
    stages: null,
    what: "A roster fact. COUNT is the commitment count, never block numbers.",
  },
  claim: {
    prefix: "UPDATE",
    required: ["BLOCKS"],
    oneOf: ["NAME", "PARTICIPANT_ID"],
    optional: ["METHOD", "NOTE"],
    applies: null,
    stages: "reserve_blocks",
    what: "Reserve named blocks. COUNT is not an alternative: an empty array raises.",
  },
  contact: {
    prefix: "UPDATE",
    required: [],
    oneOf: ["NAME", "PARTICIPANT_ID"],
    optional: ["EMAIL", "CC_EMAIL", "PHONE", "NOTE"],
    applies: "admin_upsert_participant",
    stages: null,
    what: "Contact fields only.",
  },
  block_name: {
    prefix: "UPDATE",
    required: ["BLOCK", "DISPLAY_NAME"],
    optional: [],
    applies: "admin_set_block_name",
    stages: null,
    what: "The name shown on the public grid cell.",
  },
  note: {
    prefix: "NOTE",
    required: ["NOTE"],
    oneOf: ["NAME", "PARTICIPANT_ID", "BLOCK"],
    optional: [],
    applies: "note_append",
    stages: null,
    what: "A dated note. Never touches a state field, whatever else the body says.",
  },
  payment: {
    prefix: "DECISION",
    required: ["AMOUNT", "METHOD", "PAID_ON"],
    oneOf: ["NAME", "PARTICIPANT_ID"],
    optional: ["TXN", "SOURCE_REF", "NOTE"],
    applies: "admin_record_payment",
    stages: null,
    what: "Money in, then promote, and move the book to AVD when it reached Anthony.",
  },
  owner: {
    prefix: "DECISION",
    required: ["OWNER", "REASON"],
    oneOf: ["NAME", "PARTICIPANT_ID"],
    optional: ["NOTE"],
    applies: "admin_upsert_participant",
    stages: null,
    what: "Owner code only.",
  },
  release: {
    prefix: "DECISION",
    required: ["BLOCK", "REASON"],
    optional: ["NOTE"],
    applies: "admin_release_block",
    stages: null,
    what: "Prior holder kept in the block's notes. blocks_requested goes to what he still holds.",
  },
  refund: {
    prefix: "DECISION",
    required: ["BLOCK", "AMOUNT", "TXN", "REASON"],
    oneOf: ["NAME", "PARTICIPANT_ID"],
    optional: ["NOTE"],
    applies: null,
    stages: "refund_needed",
    what: "The app never moves money. The Venmo is Anthony's, later.",
  },
  queue: {
    prefix: "DECISION",
    required: ["ID", "VERDICT"],
    optional: ["NOTE"],
    applies: "admin_approve_pending",
    stages: null,
    what: "Clear a queue row from a phone.",
  },
  identity: {
    prefix: "DECISION",
    required: ["KEEP", "OTHER", "NOTE"],
    optional: [],
    applies: "note_append",
    stages: null,
    what: "Records the call on both participants. Never merges or deletes a row.",
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export interface ParsedIntake {
  prefix: Prefix;
  action: ActionName;
  /** Keys upper-cased; values verbatim per rule 9. */
  fields: Record<string, string>;
  applies: string | null;
  stages: ActionSpec["stages"];
  deferred: DeferredCheck[];
}

export type IntakeResult =
  | { ok: true; intake: ParsedIntake }
  | { ok: false; errors: string[] };

// --- subject -----------------------------------------------------------------
// The colon is part of the prefix. Anything after it is a human-readable
// summary and carries no meaning: the action lives in the body.
const SUBJECT_RE = /^(UPDATE|DECISION|NOTE) TNF:(?:\s|$)/;

export function parsePrefix(subject: string): Prefix | null {
  const m = SUBJECT_RE.exec(subject.trim());
  return m ? (m[1] as Prefix) : null;
}

// --- body --------------------------------------------------------------------
const LINE_RE = /^([A-Za-z][A-Za-z0-9_]*):[ \t]*(.*)$/;

interface BodyResult {
  fields: Record<string, string>;
  errors: string[];
}

function parseBody(body: string): BodyResult {
  const errors: string[] = [];
  const fields: Record<string, string> = {};
  const all = body.replace(/\r\n/g, "\n").split("\n");
  // A blank line ends the block, so a phone signature is harmless.
  const end = all.findIndex((l, i) => i > 0 && l.trim() === "");
  const lines = (end === -1 ? all : all.slice(0, end)).filter(
    (l, i) => !(i === 0 && l.trim() === ""),
  );
  if (lines.length === 0) {
    errors.push("body is empty; the first line must be `ACTION: <name>`");
    return { fields, errors };
  }
  lines.forEach((line, i) => {
    const n = i + 1;
    const m = LINE_RE.exec(line.trim());
    if (!m) {
      errors.push(`line ${n}: not \`KEY: VALUE\``);
      return;
    }
    // Keys are case-insensitive, values are not (rule 9: verbatim).
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    if (value === "") {
      errors.push(`line ${n}: ${key} has no value; silence is not a value, omit the line`);
      return;
    }
    if (key in fields) {
      errors.push(
        key === "ACTION"
          ? "two ACTION lines is malformed, not two actions; send two messages"
          : `line ${n}: ${key} appears twice`,
      );
      return;
    }
    fields[key] = value;
  });
  if (!("ACTION" in fields)) {
    errors.push("the first line must be `ACTION: <name>`");
  } else if (Object.keys(fields)[0] !== "ACTION") {
    errors.push("`ACTION:` must be the FIRST line of the body");
  }
  return { fields, errors };
}

// --- value rules -------------------------------------------------------------

function checkEnum(key: string, v: string, allowed: readonly string[], errors: string[]): void {
  if (!allowed.includes(v)) errors.push(`${key} must be one of ${allowed.join(" ")} (exact)`);
}

/** Rule 2. */
function parseBlockList(key: string, v: string, errors: string[]): number[] | null {
  const out: number[] = [];
  for (const raw of v.split(",")) {
    const p = raw.trim();
    if (!/^\d+$/.test(p)) {
      errors.push(`${key} must be block numbers 1-${MAX_BLOCK} separated by commas`);
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

/**
 * Rule 4. Whole dollars, digits only, an optional leading `$`. No cents and no
 * thousands separator: `$1,500` is malformed, and the grammar itself carried
 * that as a worked example until 2026-09-10, which would have rejected a
 * message written exactly as the sender was told to write it.
 */
export function parseAmountCents(v: string, errors: string[]): number | null {
  if (!/^\$?\d+$/.test(v)) {
    errors.push(
      "AMOUNT is whole dollars, digits with an optional leading $: no cents, no decimal point, no thousands separator",
    );
    return null;
  }
  const dollars = Number(v.replace("$", ""));
  if (dollars <= 0) {
    errors.push("AMOUNT must be more than zero");
    return null;
  }
  return dollars * 100;
}

/** Rule 6. Not in the future in ET, not before the season floor. */
function checkPaidOn(v: string, todayET: string, errors: string[]): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    errors.push("PAID_ON is YYYY-MM-DD");
    return;
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    errors.push("PAID_ON is not a real date");
    return;
  }
  if (v > todayET) errors.push(`PAID_ON ${v} is in the future`);
  if (v < SEASON_FLOOR) errors.push(`PAID_ON ${v} is before the season floor ${SEASON_FLOOR}`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- the parse ---------------------------------------------------------------

export interface ParseOptions {
  /** Today in America/New_York as YYYY-MM-DD. Rule 6 needs a clock. */
  todayET: string;
}

export function parseIntake(
  subject: string,
  body: string,
  opts: ParseOptions,
): IntakeResult {
  const errors: string[] = [];
  const prefix = parsePrefix(subject);
  if (prefix === null) {
    errors.push("subject must begin `UPDATE TNF:`, `DECISION TNF:` or `NOTE TNF:`; the colon is part of the prefix");
  }
  const { fields, errors: bodyErrors } = parseBody(body);
  errors.push(...bodyErrors);
  if (prefix === null || errors.length > 0) return { ok: false, errors };

  const name = fields.ACTION as ActionName;
  if (!ACTION_NAMES.includes(name)) {
    return { ok: false, errors: [`rule 14: \`${fields.ACTION}\` is not an action; the menu is ${ACTION_NAMES.join(", ")}`] };
  }
  const spec = ACTIONS[name];
  if (spec.prefix !== prefix) {
    return {
      ok: false,
      errors: [`rule 14: \`${name}\` is a ${spec.prefix} TNF: action, not ${prefix} TNF:; it is rejected, not downgraded`],
    };
  }

  // Required, one-of, and unknown keys.
  for (const key of spec.required) {
    if (!(key in fields)) errors.push(`${name} needs ${key}`);
  }
  if (spec.oneOf && !spec.oneOf.some((k) => k in fields)) {
    errors.push(`${name} needs one of ${spec.oneOf.join(" or ")}`);
  }
  const allowed = new Set<string>(["ACTION", ...spec.required, ...spec.optional, ...(spec.oneOf ?? [])]);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) errors.push(`${key} is not a key of ${name}`);
  }
  // Rule 3. COUNT belongs to `participant` only and never rides with BLOCKS.
  if ("COUNT" in fields && name !== "participant") {
    errors.push("rule 3: COUNT belongs to the participant action only; a claim names its numbers in BLOCKS");
  }
  if ("COUNT" in fields && "BLOCKS" in fields) {
    errors.push("rule 3: COUNT and BLOCKS never appear in the same message");
  }
  if (errors.length > 0) return { ok: false, errors };

  const deferred: DeferredCheck[] = [];

  if ("OWNER" in fields) checkEnum("OWNER", fields.OWNER, OWNER_GROUPS, errors);
  if ("SOURCE" in fields) checkEnum("SOURCE", fields.SOURCE, SOURCES, errors);
  if ("BLOCKS" in fields) parseBlockList("BLOCKS", fields.BLOCKS, errors);
  if ("BLOCK" in fields) {
    const one = parseBlockList("BLOCK", fields.BLOCK, errors);
    if (one !== null && one.length !== 1) errors.push("BLOCK is a single block number");
  }
  if ("COUNT" in fields) {
    if (!/^\d+$/.test(fields.COUNT) || Number(fields.COUNT) > MAX_BLOCK) {
      errors.push(`rule 3: COUNT is a whole number 0-${MAX_BLOCK}`);
    }
  }
  for (const k of ["EMAIL", "CC_EMAIL"] as const) {
    if (k in fields && !EMAIL_RE.test(fields[k])) errors.push(`rule 10: ${k} is one address`);
  }
  if ("NAME" in fields && "PARTICIPANT_ID" in fields) {
    errors.push("rule 11: give NAME or PARTICIPANT_ID, never both");
  }
  if ("PARTICIPANT_ID" in fields && !UUID_RE.test(fields.PARTICIPANT_ID)) {
    errors.push("PARTICIPANT_ID is a uuid");
  }
  if ("NAME" in fields) {
    deferred.push({ rule: 11, check: "who_resolves_to_exactly_one", value: fields.NAME });
  }

  // Rule 7. METHOD is two different columns; which one depends on the action.
  if ("METHOD" in fields) {
    if (name === "payment") checkEnum("METHOD", fields.METHOD, PAY_METHODS, errors);
    else if (name === "claim") checkEnum("METHOD", fields.METHOD, CLAIM_METHODS, errors);
  }

  if (name === "payment") {
    const cents = parseAmountCents(fields.AMOUNT, errors);
    checkPaidOn(fields.PAID_ON, opts.todayET, errors);
    if (cents !== null) {
      // Rule 5, first half: anything not a multiple of $500 is not a block
      // payment at all and is invisible, so it never becomes a row.
      if (cents % 50000 !== 0) {
        errors.push("rule 5: AMOUNT is not a multiple of $500, so it is not a block payment");
      } else {
        // Second half needs the ledger: equal to that participant's due_cents,
        // or it is a non-matching multiple and a question for Anthony.
        deferred.push({ rule: 5, check: "amount_equals_due_cents", amountCents: cents });
      }
    }
  } else if ("AMOUNT" in fields) {
    parseAmountCents(fields.AMOUNT, errors);
  }

  if (name === "queue") {
    if (!UUID_RE.test(fields.ID)) errors.push("rule 12: ID is a uuid");
    else deferred.push({ rule: 12, check: "queue_row_is_open", id: fields.ID });
    checkEnum("VERDICT", fields.VERDICT, VERDICTS, errors);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    intake: { prefix, action: name, fields, applies: spec.applies, stages: spec.stages, deferred },
  };
}

/**
 * The kind to stage when a message does not parse. Rule: reject and do not
 * guess, one row, never a partial apply.
 */
export const MALFORMED_KIND = "unparsed_intake" as const;

/** Every kind this parser can stage is on the closed list migration 26 enforces. */
export function stageableKindsUsed(): string[] {
  const used = new Set<string>([MALFORMED_KIND]);
  for (const n of ACTION_NAMES) {
    const k = ACTIONS[n].stages;
    if (k !== null) used.add(k);
  }
  return [...used].filter(isStageableKind);
}
