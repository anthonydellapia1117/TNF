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
//            migration 45); see blocksNamed for the few shapes that are not
//            a block (a date, a time, an amount, a game code, a URL). Any
//            other number is written in words.
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
/** Words that continue a list of numbers: an amount right after one is not exempt ("3 and 24,250"). */
const LIST_WORD = /^(?:and|or|&|plus|also|blocks?|spots?|box(?:es)?|squares?|no\.?|number|#)$/i;

/**
 * Every number a note says that could be a block: each run of digits from 1
 * to 100 in the subject and the lines, whatever is around it ("block 24",
 * "#24", "Mark 24", "Block 24:", "block24", "No.24", "24th", "3/24"), and the
 * number in a link to a block page (".../block/24"). Not one, and nothing
 * else: a game code G01 to G10, a clock time ("1:00", "4:30PM"), an amount
 * with a thousands comma after an ordinary word ("pays 1,500", but not "3
 * and 24,250"), a URL or the site's address, or a day after a whole month
 * name and a space ("Nov 26"). Digits are read after Unicode compatibility
 * folding, so a fullwidth or circled digit counts; any other non-ASCII digit
 * refuses the note.
 *
 * Known limits, accepted: a month name used as a person's name ("Jan 24")
 * reads as a date, and a game number in a link's query ("?g=24") is part of
 * the link. The guard is a backstop for a slip; the note is still read
 * against the database before it goes.
 */
export function blocksNamed(texts: readonly string[]): number[] {
  const out: number[] = [];
  for (const raw of texts) {
    const folded = raw.normalize("NFKC");
    if (/[^\x00-\x7F]/.test(folded.replace(/[^\p{Nd}]/gu, "")))
      throw new Error("note: a digit that is not 0 to 9; write block numbers in plain digits");
    const pages: number[] = [];
    let text = folded
      // A URL ends where the layout's link ends: at a space or a comma
      // (layout.ts URL_RE), so ",24" after a link is read as the text it is.
      .replace(/(?:https?:\/\/)?ad-26-tnf\.vercel\.app[^\s,]*|https?:\/\/[^\s,]+/gi, (url) => {
        for (const m of url.matchAll(/\/blocks?\/(\d+)/gi)) pages.push(Number(m[1]));
        return " ";
      })
      .replace(/\bG(?:0[1-9]|10)\b/g, " ")
      .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[ap]\.?m\.?)?/gi, " ");
    text = text.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (amount, at: number) => {
      const before = text.slice(0, at);
      if (!/\s$/.test(before)) return amount;
      const word = before.trimEnd().split(/\s+/).pop() ?? "";
      return word === "" || /[\d,]$/.test(word) || LIST_WORD.test(word) ? amount : " ";
    });
    for (const m of text.matchAll(/\d+/g)) {
      const n = Number(m[0]);
      if (n < 1 || n > 100) continue;
      const before = text.slice(0, m.index ?? 0);
      if (/\s$/.test(before) && MONTH.test(before.trimEnd().split(/\s+/).pop() ?? "")) continue;
      out.push(n);
    }
    for (const n of pages) if (n >= 1 && n <= 100) out.push(n);
  }
  return out;
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
  // There is no way to declare a number "not a block": a score or a count is
  // written in words. A slip fails safe, and the refusal says which number.
  const holder = ctx.holder;
  if (!holder) throw new Error(`note: the context has no holder facts; fetch admin_email_context('${ctx.event_key}', ...)`);
  if (args.not_blocks !== undefined) throw new Error("note: there is no not_blocks; write a number that is not a block in words");
  const held = new Set(holder.blocks.map((b) => b.block_number));
  for (const b of blocksNamed([what, ...lines])) {
    if (!held.has(b)) throw new Error(`note: block ${b} is named but the recipient does not hold it (write a number that is not a block in words)`);
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
