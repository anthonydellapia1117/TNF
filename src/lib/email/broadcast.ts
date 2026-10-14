// Before a broadcast goes (Anthony, 2026-10-13, G4): print the arithmetic,
// and stop if Bcc is outside the range set for the send, if any Bcc address is
// an owner's, or if the plan the database derived (admin_email_broadcast_plan)
// and the envelope this command built are not the same people. The database
// re-checks at claim time (admin_email_claim_broadcast); the two agree on who
// was claimed through envelopeMd5, which both compute the same way.

import { createHash } from "node:crypto";
import type { OwnerAddress } from "./envelope.ts";

/** admin_email_broadcast_plan(event_key), exactly as it returns it. */
export interface BroadcastPlan {
  event_key: string;
  /** Active prospect addresses. */
  p: number;
  /** Holder addresses, primary and cc. */
  h: number;
  /** In both. */
  o: number;
  /** Of P and H together, already on To. */
  t: number;
  /** Of the rest, excluded: recruit-excluded, blocklisted, an owner's alt, Anthony's. */
  x: number;
  bcc_count: number;
  /** Every owner's primary address, any order. */
  to: string[];
  /** Sorted. */
  bcc: string[];
  /** Owners with no address on the owners table. */
  omitted_owners: string[];
}

export interface BccRange {
  min: number;
  max: number;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** "P 126 + H 35 - O 32 - T 1 - X 0 = Bcc 128" */
export function planArithmetic(p: BroadcastPlan): string {
  return `P ${p.p} + H ${p.h} - O ${p.o} - T ${p.t} - X ${p.x} = Bcc ${p.bcc_count}`;
}

/**
 * md5 of the sorted To list, a bar, then the sorted Bcc list, each
 * comma-joined and lowercased. admin_email_claim_broadcast hashes the same
 * string (sorted with collate "C", which is this byte order).
 */
export function envelopeMd5(env: { to: string[]; bcc: string[] }): string {
  const line = (xs: string[]) => [...new Set(xs.map(norm))].filter(Boolean).sort().join(",");
  return createHash("md5").update(`${line(env.to)}|${line(env.bcc)}`).digest("hex");
}

const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map(norm));
  const y = new Set(b.map(norm));
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Throws, naming every problem at once, unless the broadcast may go. */
export function checkBroadcast(
  plan: BroadcastPlan,
  env: { to: string[]; bcc: string[] },
  owners: OwnerAddress[],
  omit: string[],
  range: BccRange,
): void {
  const problems: string[] = [];
  const sum = plan.p + plan.h - plan.o - plan.t - plan.x;
  if (sum !== plan.bcc_count || plan.bcc.length !== plan.bcc_count) {
    problems.push(`the arithmetic does not add up: ${planArithmetic(plan)}, the sum is ${sum}, the Bcc list has ${plan.bcc.length}`);
  }
  if (!sameSet(env.bcc, plan.bcc)) problems.push("the envelope's Bcc differs from the plan's");
  if (!sameSet(env.to, plan.to)) problems.push("the envelope's To differs from the plan's");
  const n = new Set(env.bcc.map(norm)).size;
  if (n < range.min || n > range.max) problems.push(`Bcc is ${n}, outside ${range.min} to ${range.max}`);
  const ownerAddrs = new Set(owners.flatMap((o) => [norm(o.email), norm(o.alt_email)]).filter(Boolean));
  const ownerInBcc = env.bcc.map(norm).filter((a) => ownerAddrs.has(a));
  if (ownerInBcc.length) problems.push(`${ownerInBcc.length} owner address in Bcc`);
  const named = [...new Set(omit.map((c) => c.trim().toUpperCase()).filter(Boolean))].sort();
  const none = [...plan.omitted_owners].sort();
  if (named.join(",") !== none.join(",")) {
    problems.push(`the override names ${named.join(", ") || "none"}; owners with no address: ${none.join(", ") || "none"}`);
  }
  if (problems.length) throw new Error(`broadcast refused: ${problems.join("; ")}`);
}
