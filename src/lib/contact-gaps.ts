// Who the pool cannot reach.
//
// A participant with neither an email nor a phone is invisible if their
// block hits: there is no way to tell them they won. Nearly all of these
// came in through a relaying owner, so the fix is to hand each owner the
// list of people they vouched for and get real contact details back.
//
// Admin-only by construction — it reads participant contact fields, which
// no public projection carries.

import type { OwnerGroup, Participant } from "@/lib/types";

export interface ContactGapPerson {
  id: string;
  name: string;
  blocks: number[];
}

export interface ContactGapGroup {
  group: OwnerGroup;
  people: ContactGapPerson[];
  /** Blocks at stake across the group — what cannot be paid out by message. */
  blockCount: number;
}

const blank = (s: string | null | undefined) => (s ?? "").trim() === "";

/**
 * No email, no cc_email AND no phone. One channel is enough to reach a
 * winner, and on a shared block the cc is often the reachable half — Ray
 * Vassallo answers for block 1 whether or not Raychel does. Ignoring it here
 * would put a reachable participant on the chase list.
 */
export function hasNoContact(
  p: Pick<Participant, "email" | "cc_email" | "phone">,
): boolean {
  return blank(p.email) && blank(p.cc_email) && blank(p.phone);
}

/**
 * Unreachable participants, grouped by the owner who relays for them.
 * Groups are ordered by how many blocks are at stake, then by name, so the
 * owner with the biggest gap to close reads first.
 */
export function contactGaps(
  participants: Pick<
    Participant,
    | "id"
    | "full_name"
    | "display_alias"
    | "email"
    | "cc_email"
    | "phone"
    | "owner_group"
  >[],
  blocks: { block_number: number; participant_id: string | null }[],
): ContactGapGroup[] {
  const blocksByParticipant = new Map<string, number[]>();
  for (const b of blocks) {
    if (!b.participant_id) continue;
    const list = blocksByParticipant.get(b.participant_id) ?? [];
    list.push(b.block_number);
    blocksByParticipant.set(b.participant_id, list);
  }

  const byGroup = new Map<OwnerGroup, ContactGapPerson[]>();
  for (const p of participants) {
    if (!hasNoContact(p)) continue;
    const people = byGroup.get(p.owner_group) ?? [];
    people.push({
      id: p.id,
      name: p.display_alias ?? p.full_name,
      blocks: (blocksByParticipant.get(p.id) ?? []).sort((a, b) => a - b),
    });
    byGroup.set(p.owner_group, people);
  }

  return [...byGroup.entries()]
    .map(([group, people]) => ({
      group,
      people: people.sort((a, b) => a.name.localeCompare(b.name)),
      blockCount: people.reduce((n, p) => n + p.blocks.length, 0),
    }))
    .sort((a, b) => b.blockCount - a.blockCount || a.group.localeCompare(b.group));
}

/** The plain-text ask, ready to send to one relaying owner. */
export function contactGapMessage(g: ContactGapGroup): string {
  return [
    `1622 TNF — need contact info for ${g.people.length} ${g.people.length === 1 ? "person" : "people"} you brought in:`,
    "",
    ...g.people.map(
      (p) =>
        `${p.name}${p.blocks.length ? ` - #${p.blocks.join(", #")}` : ""}`,
    ),
    "",
    "Cell or email is fine, either one. If their block hits I need a way to reach them.",
  ].join("\n");
}
