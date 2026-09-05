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
