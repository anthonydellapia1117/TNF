// The rules every rendered TNF email must pass, checked on the output, not on
// the intentions. The render-lint test runs this over every event; the CLI runs
// it before anything is sent and refuses on any finding.

import type { RenderedEmail } from "./types.ts";
import { MAX_LINE } from "./wrap.ts";

const DASH = /[–—]/;
const EMOJI = /\p{Extended_Pictographic}/u;
const RELATIVE = /\b(today|tonight|tomorrow|yesterday|this week|next week|soon)\b/i;
/** Anthony's reply voice (2026-10-08): no filler. Replies only: the digest quotes third-party text. */
const FILLER = /\b(let me know if|hope this helps|feel free to|don't hesitate)\b/i;

export function lintEmail(e: RenderedEmail): string[] {
  const problems: string[] = [];
  for (const [part, s] of [
    ["subject", e.subject],
    ["text", e.text],
    ["html", e.html],
  ] as const) {
    if (DASH.test(s)) problems.push(`${part}: an em or en dash`);
    if (EMOJI.test(s)) problems.push(`${part}: an emoji`);
    if (s.includes("$")) problems.push(`${part}: a dollar sign`);
  }
  if (/[\r\n]/.test(e.subject)) problems.push("subject: a line break");
  e.text.split("\n").forEach((line, i) => {
    if (line.length > MAX_LINE) problems.push(`text line ${i + 1}: ${line.length} characters (limit ${MAX_LINE})`);
  });
  if (RELATIVE.test(e.text)) problems.push(`text: a relative date ("${RELATIVE.exec(e.text)?.[0]}")`);
  if (/<img\b/i.test(e.html)) problems.push("html: an image");
  if (/unsubscribe/i.test(e.text + e.html)) problems.push("unsubscribe furniture");
  if (!e.text.trim()) problems.push("text: empty plain-text part");
  return problems;
}

/**
 * The reply voice, checked on every email written in Anthony's voice to one
 * person (a T-template reply, a game list, an answer). Not on the digest or a
 * status report, which quote text Anthony did not write.
 */
export function lintVoice(e: RenderedEmail): string[] {
  return FILLER.test(e.text) ? [`text: filler ("${FILLER.exec(e.text)?.[0]}")`] : [];
}
