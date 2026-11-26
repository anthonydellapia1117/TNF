// A note from Anthony to one holder, in his words (Anthony, 2026-11-26 12:41 PM
// ET, Part S). The first was to Mark/Santos, who had paid Ron and were never
// put on the board until that day, on blocks 3 and 23: it says so and carries
// that date's grid pictures. Not a reply: nothing came in to answer, so
// answer_<id> does not fit.
//
// Event key: note_<YYYY-MM-DD>_<name>, the ET date it goes out and a short
// lower-case name for the recipient (letters, digits, hyphens; never an
// address). Dated: it renders only on its own date. Per recipient, claimed in
// email_sends, to a holder's own address only (migration 45: never a cc, never
// Anthony's own).
//
// Args:
//   lines    Anthony's sentences, his greeting included ("Mark, ..."), "\n"
//            between lines. The sign-off is added. Every whole number from 1
//            to 100 anywhere in them must be a block the recipient holds at
//            their own address (the context's holder facts, migration 45). A
//            day after a month ("Nov 26"), a time ("1:00"), an amount with a
//            thousands comma ("1,500"), a code ("G02") or a URL is not a block.
//   not_blocks  optional, comma-separated numbers the note says that are not
//            blocks (a score, a count). Each must appear in the lines and
//            must not be written as a block ("block 24", "#24").
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
/** email_sends.event_key is at most 80 characters (migration 33). */
export const MAX_NOTE_KEY = 80;
/** A note is short: one paragraph of Anthony's. */
export const MAX_NOTE_SENTENCES = 8;

const code = (n: number) => `G${String(n).padStart(2, "0")}`;
const gridCid = (n: number) => `grid-${code(n).toLowerCase()}@tnf`;

/** A whole month name or its abbreviation: "Nov 26" is a date, "Mark 24" is not. */
const MONTH = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?$/i;
/** A word that marks the number after it as a block: "block 24", "spots 3 and 24". */
const BLOCK_WORD = /\b(?:blocks?|spots?|box(?:es)?|squares?)\s*[:#]?\s*$/i;

interface NamedNumber { n: number; marked: boolean }

/**
 * Every number in a note that could be a block: each whole number from 1 to
 * 100 anywhere in it, in any sentence, however it is written ("block 24",
 * "#24", "Mark 24", "3 or 24"). Not one: a day after a month name ("Nov 26"),
 * a clock time ("1:00"), an amount with a thousands comma ("1,500"), a number
 * inside a word or code ("G02") or a URL. "marked" when a block word or "#"
 * comes right before it, or it continues a list that one began ("blocks 3,
 * 23, and 24").
 */
function namedNumbers(lines: readonly string[]): NamedNumber[] {
  const text = lines
    .join(" ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, " ");
  const out: NamedNumber[] = [];
  let listMarked = false;
  let lastEnd = 0;
  for (const m of text.matchAll(/(?<![\w.])(#?)(\d+)(?![\w:])/g)) {
    const at = m.index ?? 0;
    const before = text.slice(0, at);
    const between = text.slice(lastEnd, at);
    lastEnd = at + m[0].length;
    const n = Number(m[2]);
    const continues = /^\s*(?:,\s*(?:and|or|&)?|\(?\s*(?:and|or|&)(?:\s+also)?)\s*$/i.test(between);
    const marked: boolean = m[1] === "#" || BLOCK_WORD.test(before) || (listMarked && continues);
    listMarked = marked;
    if (n < 1 || n > 100) continue;
    if (MONTH.test(before.trimEnd().split(/\s+/).pop() ?? "")) continue;
    out.push({ n, marked });
  }
  return out;
}

/** The numbers a note names that could be blocks, in order (see namedNumbers). */
export function blocksNamed(lines: readonly string[]): number[] {
  return namedNumbers(lines).map((x) => x.n);
}

/** Of those, the ones written as a block: after a block word or "#", or in a list one began. */
export function markedBlocks(lines: readonly string[]): number[] {
  return namedNumbers(lines).filter((x) => x.marked).map((x) => x.n);
}

export function note(ctx: EmailContext, args: EventArgs = {}): EmailSpec {
  const m = NOTE_KEY.exec(ctx.event_key);
  if (!m) throw new Error(`note: "${ctx.event_key}" is not note_<YYYY-MM-DD>_<name>`);
  if (ctx.event_key.length > MAX_NOTE_KEY) throw new Error(`note: the key is ${ctx.event_key.length} characters; the ledger takes ${MAX_NOTE_KEY}`);
  const date = m[1];

  const lines = (args.lines ?? "").split("\n").map((l) => hyphenate(l.trim())).filter(Boolean);
  if (lines.length === 0) throw new Error("note: --lines is required");
  const n = sentenceCount(lines);
  if (n > MAX_NOTE_SENTENCES) throw new Error(`note: ${n} sentences; a note is at most ${MAX_NOTE_SENTENCES}`);
  const what = hyphenate((args.subject ?? "").trim());
  if (!what) throw new Error("note: --subject is required");

  // Every number in Anthony's words that could be a block must be one the
  // database says this recipient holds at their own address. A number that is
  // not a block (a score, a count) passes only when the caller declares it in
  // not_blocks, and never one written as a block ("block 24", "#24").
  const holder = ctx.holder;
  if (!holder) throw new Error(`note: the context has no holder facts; fetch admin_email_context('${ctx.event_key}', ...)`);
  const held = new Set(holder.blocks.map((b) => b.block_number));
  const named = blocksNamed(lines);
  const marked = new Set(markedBlocks(lines));
  const notBlocks = new Set<number>();
  for (const w of (args.not_blocks ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!/^\d+$/.test(w)) throw new Error(`note: not_blocks wants whole numbers, got "${w}"`);
    const n = Number(w);
    if (!named.includes(n)) throw new Error(`note: not_blocks names ${n}, which the note does not say`);
    if (marked.has(n)) throw new Error(`note: ${n} is written as a block, so it cannot be declared not a block`);
    notBlocks.add(n);
  }
  for (const b of named) {
    if (held.has(b) || notBlocks.has(b)) continue;
    throw new Error(`note: block ${b} is named but the recipient does not hold it (a number that is not a block goes in --arg not_blocks)`);
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
