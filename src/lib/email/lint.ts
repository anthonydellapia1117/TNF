// The rules every rendered TNF email must pass, checked on the output, not on
// the intentions. The render-lint test runs this over every event; the CLI runs
// it before anything is sent and refuses on any finding.

import type { RenderedEmail } from "./types.ts";
import { MAX_LINE } from "./wrap.ts";

const DASH = /[–—]/;
const EMOJI = /\p{Extended_Pictographic}/u;
const RELATIVE = /\b(today|tonight|tomorrow|yesterday|this week|next week|soon)\b/i;

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
