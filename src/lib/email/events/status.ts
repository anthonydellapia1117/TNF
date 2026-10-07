// The code-status report to Anthony alone. Its own standing format wins over
// the pool shape: no greeting, no opening, no sign-off, one KEY: value line per
// item, in the order given. Subject fixed by Anthony.
// Event key: status_<anything>. Args: lines, the report lines joined by "\n".

import type { EmailContext, EmailSpec, EventArgs, Row } from "../types.ts";
import { hyphenate } from "../format.ts";

export const STATUS_SUBJECT = "TNF CODE STATUS - V2";

export function status(_ctx: EmailContext, args: EventArgs): EmailSpec {
  const lines = (args.lines ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("status: --lines is required");
  const rows: Row[] = lines.map((l) => {
    const i = l.indexOf(": ");
    if (i <= 0) throw new Error(`status: "${l}" is not KEY: value`);
    return [l.slice(0, i), hyphenate(l.slice(i + 2))] as const;
  });
  return {
    subject: STATUS_SUBJECT,
    greeting: null,
    opening: null,
    rows,
    next: null,
    deadline: null,
    signoff: null,
  };
}
