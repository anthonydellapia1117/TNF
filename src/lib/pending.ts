// The NEEDS ANTHONY queue. The sweep stages what it is not allowed to
// decide; Anthony resolves each item at /admin/queue. Approve applies an item
// only by calling an existing admin_* RPC, and DISPATCH below is the whole
// list of what Approve can do. It mirrors the CASE in admin_approve_pending
// (migration 23): change both together.

import { fmtUsd } from "@/lib/format";

export interface PendingDispatch {
  /** The existing admin_* RPC admin_approve_pending calls, or null. */
  rpc: "admin_record_payment" | "admin_reserve_blocks" | null;
  /** One line for the Approve button: what pressing it does. */
  onApprove: string;
}

export const DISPATCH: Record<string, PendingDispatch> = {
  payment: {
    rpc: "admin_record_payment",
    onApprove:
      "Approve records the payment in the ledger and promotes the block if that settles it.",
  },
  reserve_blocks: {
    rpc: "admin_reserve_blocks",
    onApprove: "Approve reserves the listed blocks for the participant.",
  },
};

/**
 * Every kind the sweep may stage, and the whole list. `admin_stage_pending`
 * enforces the same list (migration 26); change both together, exactly as
 * DISPATCH mirrors the CASE in admin_approve_pending.
 *
 * The list is closed because an open one already cost money. On 2026-09-08 the
 * sweep staged Tom Nataloni's $500 under the kind "payment_candidate": it
 * reads like a dispatching kind, no dispatcher handles it, so Approve would
 * have marked the row green and written nothing. The row sat open for two days
 * while the money was already in Anthony's Venmo and block 23 stayed reserved.
 * A kind that is merely plausible must be refused at the door, not accepted
 * and then silently ignored.
 *
 * Two of these dispatch (see DISPATCH above). The rest deliberately do not:
 * each needs Anthony on the right admin page, and that is the point of them.
 * "owner_owes_refund" is NOT here: owner-held cash left the pool's scope on
 * 2026-09-10, so there is nothing left to stage about it.
 */
export const STAGEABLE_KINDS = [
  "payment",
  "reserve_blocks",
  "refund_needed",
  "identity_conflict",
  "non_matching_multiple",
  "unparsed_intake",
  "unclassified_mail",
] as const;

export type StageableKind = (typeof STAGEABLE_KINDS)[number];

/** Exact match, case-sensitive. "PAYMENT" is not "payment". */
export function isStageableKind(kind: string): kind is StageableKind {
  return (STAGEABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * What actually happened to a resolved row, for the screen.
 *
 * An approved row that applied nothing must never read like one that worked.
 * Before `applied` was persisted (migration 26) the only signal was a toast
 * on the click, and the row then vanished from the open list, so a green
 * no-op and a green success looked identical five seconds later.
 *
 * `applied === null` on an approved row means the row predates that column.
 * It is reported as unknown, never as applied: guessing "applied" here would
 * be the exact lie the column exists to prevent.
 */
export function outcomeLabel(row: {
  resolution: "approved" | "dismissed" | null;
  applied: boolean | null;
}): string | null {
  if (row.resolution === null) return null;
  if (row.resolution === "dismissed") return "Dismissed";
  if (row.applied === true) return "Approved and applied";
  if (row.applied === false) return "Approved, nothing applied";
  return "Approved, applied unknown";
}

const NO_DISPATCH: PendingDispatch = {
  rpc: null,
  onApprove:
    "Approve records your decision only. Apply it by hand from the admin pages.",
};

export function dispatchFor(kind: string): PendingDispatch {
  return DISPATCH[kind] ?? NO_DISPATCH;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** How many key: value pairs a free-form payload shows before "+N more". */
const MAX_PAIRS = 6;

/**
 * One line for the queue row. Known kinds get a sentence; anything else
 * lists its scalar fields. Never throws on a malformed payload, since the
 * row has to render for Anthony to dismiss it.
 */
export function summarizePayload(kind: string, payload: unknown): string {
  if (!isObj(payload)) return "(no details)";
  const who =
    str(payload.participant_name) ??
    str(payload.participant_id) ??
    "unknown participant";
  switch (kind) {
    case "payment": {
      const cents = int(payload.amount_cents);
      const amount = cents === null ? "amount ?" : fmtUsd(cents);
      const method = str(payload.method) ?? "method ?";
      const on = str(payload.paid_on) ?? "date ?";
      const txn = str(payload.venmo_txn_id);
      return `${amount} ${method} from ${who} on ${on}${txn ? ` (txn ${txn})` : ""}`;
    }
    case "reserve_blocks": {
      const nums = Array.isArray(payload.block_numbers)
        ? payload.block_numbers.filter((n) => int(n) !== null)
        : [];
      const list = nums.length > 0 ? nums.join(", ") : "?";
      const method = str(payload.method) ?? "requested";
      return `Blocks ${list} for ${who} (${method})`;
    }
    default:
      return genericSummary(payload);
  }
}

function genericSummary(payload: Obj): string {
  const pairs = Object.entries(payload)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => `${k}: ${String(v)}`);
  if (pairs.length === 0) return "(no details)";
  const shown = pairs.slice(0, MAX_PAIRS);
  const more = pairs.length - shown.length;
  return shown.join(" · ") + (more > 0 ? ` · +${more} more` : "");
}
