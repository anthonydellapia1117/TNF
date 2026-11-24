// The code-status report to Anthony alone. Its own standing format wins over
// the pool shape: no greeting, no opening, no sign-off, one KEY: value line per
// item. Anthony's rule (2026-11-23, Part O): subject "TNF CODE STATUS -
// <session name>", plain text, under ten lines, and exactly these fields in
// this order: SESSION, RAN, MERGED, APPLIED, BLOCKED, NEXT, WATCHING.
// Event key: status_<anything>. Args: session, the session's name; lines, the
// report lines joined by "\n".

import type { EmailContext, EmailSpec, EventArgs, Row } from "../types.ts";
import { hyphenate } from "../format.ts";
import { MAX_LINE } from "../wrap.ts";

export const STATUS_SUBJECT = "TNF CODE STATUS";
export const STATUS_FIELDS = ["SESSION", "RAN", "MERGED", "APPLIED", "BLOCKED", "NEXT", "WATCHING"] as const;
const MAX_LINES = 9;

export function status(_ctx: EmailContext, args: EventArgs): EmailSpec {
  const session = (args.session ?? "").trim();
  if (!session) throw new Error("status: --arg session=<the session's name> is required; the subject carries it");
  if (/[\r\n]/.test(session)) throw new Error("status: the session name is one line");
  const lines = (args.lines ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("status: --lines is required");
  if (lines.length > MAX_LINES) throw new Error(`status: ${lines.length} lines; the report is under ten`);
  const rows: Row[] = lines.map((l) => {
    const i = l.indexOf(": ");
    if (i <= 0) throw new Error(`status: "${l}" is not KEY: value`);
    return [l.slice(0, i), hyphenate(l.slice(i + 2))] as const;
  });
  // A longer line wraps in the plain text, and seven fields become sixteen
  // lines: each one has to fit on its own line.
  for (const [k, v] of rows) {
    const n = `${k}: ${v}`.length;
    if (n > MAX_LINE) throw new Error(`status: the ${k} line is ${n} characters; each line fits in ${MAX_LINE} so the report stays under ten lines`);
  }
  const keys = rows.map((r) => r[0]);
  if (keys.join(",") !== STATUS_FIELDS.join(",")) {
    throw new Error(`status: the fields are ${STATUS_FIELDS.join(", ")}, each once and in that order; got ${keys.join(", ")}`);
  }
  return {
    subject: `${STATUS_SUBJECT} - ${session}`,
    greeting: null,
    opening: null,
    rows,
    next: null,
    deadline: null,
    signoff: null,
  };
}
