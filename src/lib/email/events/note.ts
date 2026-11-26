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
//            between lines. The sign-off is added. Every run of digits from 1
//            to 100 in them or in the subject must be a block the recipient
//            holds at their own address (the context's holder facts,
//            migration 45). A day after a month ("Nov 26"), a time ("1:00"),
//            an amount with a thousands comma ("1,500"), a game code ("G02")
//            or a URL is not a block.
//   not_blocks  optional, comma-separated numbers the note says that are not
//            blocks (a score, a count). Each must appear in the note, must
//            not be one of the recipient's blocks, and must not appear in a
//            sentence about blocks (a block word, a "#", or one of the
//            recipient's block numbers in it).
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
/** A word for a block, or "#": a sentence with one in it is about blocks. */
const BLOCK_WORD = /\b(?:blocks?|spots?|box(?:es)?|squares?)\b|#/i;

/** One number a note says that could be a block, and the sentence it is in. */
export interface NumberMention { n: number; sentence: string }

/**
 * Every number a note says that could be a block, with its sentence: each run
 * of digits from 1 to 100, in the subject and in the lines, whatever is
 * around it ("block 24", "#24", "Mark 24", "Block 24:", "block24", "No.24",
 * "24th", "3/24"). Not one: a game code ("G02"), a clock time ("1:00",
 * "4:30PM"), an amount with a thousands comma ("1,500"), a URL or the site's
 * address, or a day after a whole month name ("Nov 26"). Digits are read
 * after Unicode compatibility folding, so a fullwidth or circled digit is a
 * digit; any other non-ASCII digit refuses the note.
 */
export function numberMentions(texts: readonly string[]): NumberMention[] {
  const out: NumberMention[] = [];
  for (const raw of texts) {
    const folded = raw.normalize("NFKC");
    if (/[^\x00-\x7F]/.test(folded.replace(/[^\p{Nd}]/gu, "")))
      throw new Error("note: a digit that is not 0 to 9; write block numbers in plain digits");
    const text = folded
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bad-26-tnf\.vercel\.app\S*/gi, " ")
      .replace(/\bG\d{2}\b/g, " ")
      .replace(/\b\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?/gi, " ")
      .replace(/\b\d{1,3}(?:,\d{3})+\b/g, " ");
    for (const sentence of text.split(/(?<=[.!?])\s+(?=\S)/)) {
      for (const m of sentence.matchAll(/\d+/g)) {
        const n = Number(m[0]);
        if (n < 1 || n > 100) continue;
        const word = sentence.slice(0, m.index ?? 0).trimEnd().split(/\s+/).pop() ?? "";
        if (MONTH.test(word)) continue;
        out.push({ n, sentence });
      }
    }
  }
  return out;
}

/** The numbers a note's lines say that could be blocks, in order (see numberMentions). */
export function blocksNamed(lines: readonly string[]): number[] {
  return numberMentions(lines).map((x) => x.n);
}

/**
 * The guard: every number the subject and the lines say that could be a
 * block is one the recipient holds, or is declared not a block. A declared
 * number may not appear in any sentence that is about blocks: one with a
 * block word, a "#", or one of the recipient's own block numbers in it.
 */
export function checkBlocks(texts: readonly string[], held: ReadonlySet<number>, notBlocks: readonly number[]): void {
  const mentions = numberMentions(texts);
  const declared = new Set<number>();
  for (const n of notBlocks) {
    const where = mentions.filter((x) => x.n === n);
    if (where.length === 0) throw new Error(`note: not_blocks names ${n}, which the note does not say`);
    if (held.has(n)) throw new Error(`note: ${n} is one of the recipient's blocks, so it cannot be declared not a block`);
    for (const x of where) {
      const aboutBlocks = BLOCK_WORD.test(x.sentence) || numberMentions([x.sentence]).some((y) => held.has(y.n));
      if (aboutBlocks) throw new Error(`note: ${n} is in a sentence about blocks ("${x.sentence.trim()}"), so it cannot be declared not a block; reword it`);
    }
    declared.add(n);
  }
  for (const x of mentions) {
    if (held.has(x.n) || declared.has(x.n)) continue;
    throw new Error(`note: block ${x.n} is named but the recipient does not hold it (a number that is not a block, in a sentence that is not about blocks, goes in --arg not_blocks)`);
  }
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

  // Every number in the subject and Anthony's words that could be a block
  // must be one the database says this recipient holds at their own address.
  // A number that is not a block (a score, a count) passes only when declared
  // in not_blocks, and only in a sentence that is not about blocks.
  const holder = ctx.holder;
  if (!holder) throw new Error(`note: the context has no holder facts; fetch admin_email_context('${ctx.event_key}', ...)`);
  const held = new Set(holder.blocks.map((b) => b.block_number));
  const notBlocks = (args.not_blocks ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((w) => {
    if (!/^\d+$/.test(w)) throw new Error(`note: not_blocks wants whole numbers, got "${w}"`);
    return Number(w);
  });
  checkBlocks([what, ...lines], held, notBlocks);

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
