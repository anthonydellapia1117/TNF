// Who a message is addressed to. Two shapes, and only two.
//
// Broadcast (one body, many recipients in Bcc): To is Anthony and then every
// other owner, one address each, read at send time from the admin-only owners
// table (handed to the command as an export of that table, never from an
// environment variable or a repo file). Bcc is the derived recipient list
// minus every address already on To, so an owner who also holds a block
// appears once, on To. Anthony's rule, 2026-10-07.
//
// Per-recipient (holder check-in, recruit, T1-T7 replies, the digest, status):
// To is the one recipient. No owner is ever added, no Cc, no Bcc.
//
// An owner's alt_email (Anthony's work address is the only one on file) is
// never a recipient of either shape.

export interface OwnerAddress {
  code: string;
  email: string | null;
  alt_email: string | null;
}

export interface Envelope {
  to: string[];
  cc: string[];
  bcc: string[];
}

/** To order: Anthony first, then the order Anthony named them on 2026-10-07; any later code after, by code. */
export const OWNER_ORDER = ["AVD", "RM", "MAP", "JPOD", "GD", "EJD", "NL", "BG"] as const;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Every owner's alt address: never on To, never in Bcc. */
export function neverAddressed(owners: OwnerAddress[]): Set<string> {
  return new Set(owners.map((o) => norm(o.alt_email)).filter(Boolean));
}

/**
 * Anthony, then each other owner's primary address. Refuses rather than
 * sending short: an owner with no address, Anthony's row not carrying
 * ADMIN_EMAIL, two owners sharing an address, or a primary that is someone's
 * alt address.
 */
export function broadcastTo(owners: OwnerAddress[], adminEmail: string): string[] {
  const admin = norm(adminEmail);
  if (!admin) throw new Error("broadcast: ADMIN_EMAIL is blank");
  const rank = (code: string) => {
    const i = (OWNER_ORDER as readonly string[]).indexOf(code);
    return i < 0 ? OWNER_ORDER.length : i;
  };
  const rows = [...owners].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
  const avd = rows.find((o) => o.code === "AVD");
  if (!avd) throw new Error("broadcast: the owners export has no AVD row");
  if (norm(avd.email) !== admin) throw new Error("broadcast: AVD's address on the owners table is not ADMIN_EMAIL");
  const never = neverAddressed(owners);
  const to: string[] = [];
  for (const o of rows) {
    const a = norm(o.email);
    if (!a) throw new Error(`broadcast: owner ${o.code} has no address on the owners table`);
    if (never.has(a)) throw new Error(`broadcast: owner ${o.code}'s address is an alt address`);
    if (to.includes(a)) throw new Error(`broadcast: owner ${o.code} shares an address with another owner`);
    to.push(a);
  }
  return to;
}

export function broadcastEnvelope(owners: OwnerAddress[], adminEmail: string, derived: string[]): Envelope {
  const to = broadcastTo(owners, adminEmail);
  const onTo = new Set(to);
  const never = neverAddressed(owners);
  const bcc = [...new Set(derived.map(norm))]
    .filter((a) => a && !onTo.has(a) && !never.has(a))
    .sort();
  return { to, cc: [], bcc };
}

export function perRecipientEnvelope(recipient: string): Envelope {
  const r = norm(recipient);
  if (!r) throw new Error("per-recipient email with no recipient");
  return { to: [r], cc: [], bcc: [] };
}
