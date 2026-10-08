// The sweep's nightly digest, to Anthony alone. Event key: digest_YYYY-MM-DD.
// Everything in it is read from the database by email_digest_facts(); the
// chase list is AVD only (CLAUDE.md, Anthony tracks his own money only).

import type { EmailContext, EmailSpec, QueueRow, Row } from "../types.ts";
import { amount, clock, hyphenate, localYmd, longDate } from "../format.ts";

const SUMMARY_KEYS = [
  "participant_name", "name", "block_numbers", "block_number", "amount_cents",
  "kind_note", "summary", "subject", "note", "reason",
];

/** One line for a queue row: the readable payload fields, never an address or a phone number. */
export function queueSummary(q: QueueRow): string {
  const p = q.payload ?? {};
  const bits: string[] = [];
  for (const k of SUMMARY_KEYS) {
    const v = p[k];
    if (v === null || v === undefined || v === "") continue;
    if (k === "amount_cents" && typeof v === "number") bits.push(amount(Math.round(v / 100) * 100));
    else if (Array.isArray(v)) bits.push(`block ${v.join(", ")}`);
    else if (k === "block_number") bits.push(`block ${String(v)}`);
    else bits.push(String(v));
  }
  const s = bits.join(", ").replace(/\$/g, "").replace(/\S+@\S+/g, "(address)");
  return hyphenate(s || "no summary in payload");
}

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function digest(ctx: EmailContext): EmailSpec {
  const d = ctx.digest;
  if (!d) throw new Error("digest: render from admin_email_context('digest_YYYY-MM-DD', ...)");
  const c = ctx.common;
  const rows: Row[] = [];

  // First, because it blocks a send: a broadcast's To must carry every owner.
  for (const o of d.owners_missing_email ?? []) {
    rows.push(["NEEDS ANTHONY", `${o.code} ${hyphenate(o.full_name)} has no address; the next broadcast refuses until it is set.`]);
  }

  for (const b of d.avd_reserved) {
    rows.push([`Block ${b.block_number}`, `Reserved, no payment recorded by the pool, ${hyphenate(b.name)}`]);
  }
  for (const q of d.open_queue) rows.push([`Queue ${q.kind}`, queueSummary(q)]);
  for (const w of d.writes_today) {
    rows.push([`Write ${clock(w.at, c.timezone)}`, `${w.action}${w.target_table ? ` on ${w.target_table}` : ""}`]);
  }

  const k = d.block_counts;
  const sum = k.available + k.reserved + k.assigned + k.held;
  rows.push([
    "Check 7a",
    k.total === 100 && sum === 100
      ? "Pass, 100 blocks"
      : `FAIL, ${k.total} rows, ${sum} by status`,
  ]);
  rows.push([
    "Check 7b",
    d.over_committed.length === 0
      ? "Pass"
      : `FAIL, ${d.over_committed.map((o) => `${hyphenate(o.name)} ${o.numbered} of ${o.requested}`).join(", ")}`,
  ]);
  const quiet =
    !d.last_sweep_activity ||
    new Date(`${c.as_of_et}T23:59:59Z`).getTime() - new Date(d.last_sweep_activity).getTime() > 48 * 3600e3;
  rows.push([
    "Check 7c",
    quiet
      ? "No sweep write or staged row in 48 hours"
      : `Pass, last activity ${longDate(localYmd(d.last_sweep_activity as string, c.timezone))}, ` +
        `${clock(d.last_sweep_activity as string, c.timezone)}`,
  ]);

  return {
    subject: `TNF DIGEST ${c.as_of_et}`,
    greeting: null,
    opening: `Here is the TNF sweep digest for ${longDate(c.as_of_et)}.`,
    rows,
    next: `Next digest: ${longDate(nextDay(c.as_of_et))}, 10:43 PM ET.`,
    deadline: null,
    signoff: null,
  };
}
