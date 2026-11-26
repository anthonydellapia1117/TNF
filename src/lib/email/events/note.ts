// A note from Anthony to one holder, in his words (Anthony, 2026-11-26 12:41 PM
// ET, Part S). The first was to Mark/Santos, put on the board that day on
// blocks 3 and 23 after paying Ron in September and never being added: it says
// so and carries that date's grid pictures. Not a reply: nothing came in to
// answer, so answer_<id> does not fit.
//
// Event key: note_<YYYY-MM-DD>_<name>, the ET date it goes out and a short
// lower-case name for the recipient (letters, digits, hyphens; never an
// address). Dated: it renders only on its own date. Per recipient, claimed in
// email_sends, to a holder's own address only (migration 45: never a cc, never
// Anthony's own).
//
// Args:
//   lines    Anthony's sentences, his greeting included ("Mark, ..."), "\n"
//            between lines. The sign-off is added. Every block number named
//            must be one the recipient holds; the context says which.
//   subject  what follows "TNF Holiday Pool <year> | " in the subject.
//   grids    optional, comma-separated game numbers ("2,3,4"): a grid picture
//            each, Comfortable view, fetched at send time like Part R's. Each
//            must be a game on the key's date with published digits that
//            match their draw row.

import type { EmailContext, EmailSpec, EventArgs, ImageRef } from "../types.ts";
import { hyphenate, teamShort } from "../format.ts";
import { seasonYear } from "../facts.ts";
import { POOL_SUBJECT, SIGNOFF } from "../copy.ts";
import { sentenceCount } from "./answer.ts";

export const NOTE_KEY = /^note_(\d{4}-\d{2}-\d{2})_([a-z0-9]+(?:-[a-z0-9]+)*)$/;
/** A note is short: one paragraph of Anthony's. */
export const MAX_NOTE_SENTENCES = 8;

const code = (n: number) => `G${String(n).padStart(2, "0")}`;
const gridCid = (n: number) => `grid-${code(n).toLowerCase()}@tnf`;

/** Every block number the lines name after "block" or "blocks": "blocks 3 and 23" is [3, 23]. */
export function blocksNamed(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (const m of lines.join(" ").matchAll(/\bblocks?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)/gi)) {
    for (const n of m[1].split(/\s*(?:,|and|&)\s*/i)) out.push(Number(n));
  }
  return out;
}

export function note(ctx: EmailContext, args: EventArgs = {}): EmailSpec {
  const m = NOTE_KEY.exec(ctx.event_key);
  if (!m) throw new Error(`note: "${ctx.event_key}" is not note_<YYYY-MM-DD>_<name>`);
  const date = m[1];

  const lines = (args.lines ?? "").split("\n").map((l) => hyphenate(l.trim())).filter(Boolean);
  if (lines.length === 0) throw new Error("note: --lines is required");
  const n = sentenceCount(lines);
  if (n > MAX_NOTE_SENTENCES) throw new Error(`note: ${n} sentences; a note is at most ${MAX_NOTE_SENTENCES}`);
  const what = hyphenate((args.subject ?? "").trim());
  if (!what) throw new Error("note: --subject is required");

  // A block number in Anthony's words must be one the database says this
  // recipient holds: the note states it as theirs.
  const holder = ctx.holder;
  if (!holder) throw new Error(`note: the context has no holder facts; fetch admin_email_context('${ctx.event_key}', ...)`);
  const held = new Set(holder.blocks.map((b) => b.block_number));
  for (const b of blocksNamed(lines)) {
    if (!held.has(b)) throw new Error(`note: block ${b} is named but the recipient does not hold it`);
  }

  const wanted = (args.grids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let images: ImageRef[] | undefined;
  if (wanted.length) {
    const day = ctx.day;
    if (!day) throw new Error(`note: grid pictures need the day facts; fetch admin_email_context('${ctx.event_key}', ...)`);
    if (day.date !== date) throw new Error(`note: the day facts are for ${day.date}, not ${date}`);
    const seen = new Set<number>();
    images = wanted.map((w) => {
      if (!/^\d+$/.test(w)) throw new Error(`note: grids wants game numbers, got "${w}"`);
      const no = Number(w);
      if (seen.has(no)) throw new Error(`note: ${code(no)} is named twice in grids`);
      seen.add(no);
      const g = day.games.find((x) => x.game_no === no);
      if (!g) throw new Error(`note: ${code(no)} is not a game on ${date}`);
      if (!g.published || !g.row_digits || !g.col_digits) throw new Error(`note: ${code(no)} digits are not published; no picture`);
      if (g.digits_ok !== true) throw new Error(`note: ${code(no)} digits do not match their draw row; send nothing`);
      return { cid: gridCid(no), gameNo: no, alt: `${code(no)} grid, ${teamShort(g.away_team)} at ${teamShort(g.home_team)}` };
    });
  }

  return {
    subject: `${POOL_SUBJECT} ${seasonYear(ctx.common)} | ${what}`,
    // Anthony's own words open the note, his greeting included.
    greeting: null,
    opening: null,
    prose: lines,
    rows: [],
    ...(images ? { images } : {}),
    next: null,
    deadline: null,
    signoff: SIGNOFF,
  };
}
