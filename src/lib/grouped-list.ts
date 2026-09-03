// The roster grouped by owner code — the chase list for the seven owners.
//
// Owner codes are collection responsibility, so this is the view that says
// who owes what: each header carries that owner's block count and the money
// he is responsible for collecting. Admin only.
//
// Comped blocks are the one place count and money disagree. A comped block
// is committed and in play — it counts — but it owes $0. The header shows
// both numbers rather than quietly picking one, because an owner reconciling
// his book needs to know his count is one higher than his cash.
//
// Pure logic, unit-tested.

export interface GroupedEntry {
  /** null when the participant has a committed slot with no number yet. */
  blockNumber: number | null;
  /** The name on the block if it carries its own, else the participant. */
  name: string;
  comped: boolean;
}

export interface GroupedOwner {
  code: string;
  /** Blocks in this book, comped and unnumbered included. */
  blocks: number;
  comped: number;
  /** What this owner is responsible for collecting, in cents. */
  dueCents: number;
  entries: GroupedEntry[];
}

export interface GroupedRoster {
  owners: GroupedOwner[];
  committed: number;
  open: number;
  dueCents: number;
  comped: number;
}

interface ParticipantRow {
  id: string;
  display_alias: string | null;
  full_name: string;
  owner_group: string | null;
  blocks_requested: number;
}

interface BlockRow {
  block_number: number;
  participant_id: string | null;
  display_name: string | null;
  comped: boolean;
  status: string;
}

function personName(p: ParticipantRow): string {
  const alias = p.display_alias?.trim();
  return alias && alias.length > 0 ? alias : p.full_name;
}

/**
 * Group the roster by owner code. Owners are ordered by block count
 * descending (code ascending to break a tie); blocks inside an owner by
 * number ascending, with any unnumbered slots last. A code holding no
 * blocks is omitted entirely — EJD, NL and GD are unused and an empty
 * header is noise in a chat message.
 */
export function groupedRoster(
  participants: ParticipantRow[],
  blocks: BlockRow[],
  pricePerBlockCents: number,
  blocksTotal: number,
): GroupedRoster {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const owners = new Map<string, GroupedOwner>();

  const owner = (code: string): GroupedOwner => {
    let g = owners.get(code);
    if (!g) {
      g = { code, blocks: 0, comped: 0, dueCents: 0, entries: [] };
      owners.set(code, g);
    }
    return g;
  };

  const numberedByParticipant = new Map<string, number>();

  for (const b of blocks) {
    if (b.status !== "reserved" && b.status !== "assigned") continue;
    if (!b.participant_id) continue;
    const p = byId.get(b.participant_id);
    if (!p) continue;
    const code = p.owner_group?.trim() || "—";
    const name = b.display_name?.trim() || personName(p);
    owner(code).entries.push({
      blockNumber: b.block_number,
      name,
      comped: b.comped,
    });
    numberedByParticipant.set(
      b.participant_id,
      (numberedByParticipant.get(b.participant_id) ?? 0) + 1,
    );
  }

  // A committed block with no number yet is still this owner's to collect.
  for (const p of participants) {
    const numbered = numberedByParticipant.get(p.id) ?? 0;
    const missing = Math.max(0, p.blocks_requested - numbered);
    if (missing === 0) continue;
    const code = p.owner_group?.trim() || "—";
    for (let i = 0; i < missing; i++) {
      owner(code).entries.push({
        blockNumber: null,
        name: personName(p),
        comped: false,
      });
    }
  }

  const list = [...owners.values()];
  for (const g of list) {
    g.entries.sort(
      (a, b) =>
        (a.blockNumber === null ? 1 : 0) - (b.blockNumber === null ? 1 : 0) ||
        (a.blockNumber ?? 0) - (b.blockNumber ?? 0) ||
        a.name.localeCompare(b.name),
    );
    g.blocks = g.entries.length;
    g.comped = g.entries.filter((e) => e.comped).length;
    g.dueCents = (g.blocks - g.comped) * pricePerBlockCents;
  }
  list.sort((a, b) => b.blocks - a.blocks || a.code.localeCompare(b.code));

  const committed = list.reduce((s, g) => s + g.blocks, 0);
  return {
    owners: list,
    committed,
    open: Math.max(0, blocksTotal - committed),
    dueCents: list.reduce((s, g) => s + g.dueCents, 0),
    comped: list.reduce((s, g) => s + g.comped, 0),
  };
}

/** Whole dollars, comma-grouped: 7500 cents -> "$75". */
function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** "1 comped at $0" / "2 comped at $0" — only when there are any. */
function compedNote(n: number): string {
  return n === 0 ? "" : ` — ${n} comped at $0`;
}

/**
 * The pasteable text. Plain, no markdown: this goes into a group chat where
 * asterisks and backticks render as literal characters.
 */
export function buildGroupedList(year: number, roster: GroupedRoster): string {
  const lines: string[] = [`1622 ${year} TNF Block Pool — by owner`, ""];

  for (const g of roster.owners) {
    lines.push(`${g.code} (${g.blocks}; ${usd(g.dueCents)}${compedNote(g.comped)})`);
    g.entries.forEach((e, i) => {
      const num = e.blockNumber === null ? "no number yet" : `#${e.blockNumber}`;
      lines.push(`${i + 1}. ${e.name}; ${num}${e.comped ? " (comped)" : ""}`);
    });
    lines.push("");
  }

  lines.push(
    `TOTAL: ${roster.committed} committed, ${roster.open} open, ` +
      `${usd(roster.dueCents)}${compedNote(roster.comped)}`,
  );
  return lines.join("\n");
}
