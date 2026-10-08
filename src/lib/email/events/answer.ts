// A reply to a question or an ask from a participant, prospect or owner, in
// Anthony's voice (CLAUDE.md, Replies): first name and a comma, one to three
// short sentences, signed Anthony. The words are the caller's, written after
// the task they answer is done; every value in them comes from the database.
//
// Event key: answer_<Gmail id of the message being answered>. One reply per
// inbound message (index email_sends_one_reply_per_message), shared with
// game_list. Args: lines (the sentences, "\n" between lines), subject (filled
// in by --reply-to).

import type { EmailContext, EmailSpec, EventArgs } from "../types.ts";
import { hyphenate } from "../format.ts";
import { greetingFor } from "../greeting.ts";
import { SIGNOFF } from "../copy.ts";
import { reSubject } from "./replies.ts";

export const ANSWER_KEY = /^answer_([0-9a-f]+)$/;
export const MAX_SENTENCES = 3;

/** Sentences in the body: a run of text ended by . ! or ?, or the last run. */
export function sentenceCount(lines: string[]): number {
  return lines
    .join(" ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s)).length;
}

export function answer(ctx: EmailContext, args: EventArgs): EmailSpec {
  const lines = (args.lines ?? "").split("\n").map((l) => hyphenate(l.trim())).filter(Boolean);
  if (lines.length === 0) throw new Error("answer: --lines is required");
  const n = sentenceCount(lines);
  if (n > MAX_SENTENCES) throw new Error(`answer: ${n} sentences; a reply is 1 to ${MAX_SENTENCES} short ones`);
  return {
    subject: reSubject(args.subject),
    greeting: greetingFor(ctx.people ?? []),
    opening: null,
    prose: lines,
    rows: [],
    next: null,
    deadline: null,
    signoff: SIGNOFF,
  };
}
