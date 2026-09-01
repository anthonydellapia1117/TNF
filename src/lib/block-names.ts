// Where a block wants its own name.
//
// blocks.display_name lets one block carry a name different from its owner's
// alias. Two shapes in the roster were workarounds for not having it, and
// both are worth surfacing now that it exists. Neither is auto-fixed —
// renaming someone is Anthony's call, never an inference.

import type { AdminBlock, Participant } from "@/lib/types";

export type BlockNameReason = "numbered_alias" | "shared_record";

export interface BlockNameCandidate {
  participantIds: string[];
  aliases: string[];
  blocks: number[];
  reason: BlockNameReason;
  detail: string;
}

/** "TEAM CUGINOS #1" — a numeric suffix doing a column's job. */
const NUMBERED = /#\s*\d+\s*$/;
/** "Jr/Diz", "Tim Flaherty & Mark Kap" — more than one person in one name. */
const JOINED = /[/&]/;

const nameOf = (p: Pick<Participant, "full_name" | "display_alias">) =>
  p.display_alias ?? p.full_name;

/**
 * Participants whose naming is working around the missing per-block name.
 *
 * Two rules, both deliberately narrow:
 *
 * 1. A numbered alias. The number is not part of anyone's name — it exists
 *    only to tell two rows apart, which is what a block name is for.
 * 2. A single record whose name joins two people AND holds more than one
 *    block. One block needs one name however many people are behind it; two
 *    blocks under two joined names is the case a block name solves.
 *
 * Someone holding several blocks under one ordinary name is NOT a candidate.
 * Astorga wants to read "Astorga" on both of his, and that is already right.
 */
export function blockNameCandidates(
  participants: Pick<Participant, "id" | "full_name" | "display_alias">[],
  blocks: Pick<AdminBlock, "block_number" | "participant_id" | "display_name">[],
): BlockNameCandidate[] {
  const held = new Map<string, number[]>();
  for (const b of blocks) {
    if (!b.participant_id) continue;
    const list = held.get(b.participant_id) ?? [];
    list.push(b.block_number);
    held.set(b.participant_id, list);
  }

  const out: BlockNameCandidate[] = [];

  // Rule 1: numbered aliases, grouped by the stem they share.
  const byStem = new Map<string, typeof participants>();
  for (const p of participants) {
    const name = nameOf(p);
    if (!NUMBERED.test(name)) continue;
    const stem = name.replace(NUMBERED, "").trim();
    byStem.set(stem, [...(byStem.get(stem) ?? []), p]);
  }
  for (const [stem, group] of byStem) {
    out.push({
      participantIds: group.map((p) => p.id),
      aliases: group.map(nameOf).sort(),
      blocks: group.flatMap((p) => held.get(p.id) ?? []).sort((a, b) => a - b),
      reason: "numbered_alias",
      detail:
        group.length > 1
          ? `${group.length} separate people numbered apart as "${stem} #N". Each could carry its own block name instead.`
          : `Alias numbered as "${stem} #N" with no second row to distinguish it from.`,
    });
  }

  // Rule 2: one record, joined names, more than one block.
  for (const p of participants) {
    const name = nameOf(p);
    const mine = held.get(p.id) ?? [];
    if (mine.length < 2) continue;
    if (!JOINED.test(name) && !JOINED.test(p.full_name)) continue;
    out.push({
      participantIds: [p.id],
      aliases: [name],
      blocks: [...mine].sort((a, b) => a - b),
      reason: "shared_record",
      detail: `One record named "${name}" holding ${mine.length} blocks — more than one person under a single name.`,
    });
  }

  return out.sort(
    (a, b) => a.reason.localeCompare(b.reason) || b.blocks.length - a.blocks.length,
  );
}

/** A block already carrying its own name, for the admin roster. */
export function namedBlocks(
  blocks: Pick<AdminBlock, "block_number" | "display_name">[],
): { block_number: number; display_name: string }[] {
  return blocks
    .filter((b) => (b.display_name ?? "").trim() !== "")
    .map((b) => ({ block_number: b.block_number, display_name: b.display_name! }))
    .sort((a, b) => a.block_number - b.block_number);
}
