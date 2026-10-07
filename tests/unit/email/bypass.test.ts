// Every TNF email goes through src/lib/email. This test fails if a Gmail send
// or draft call, a subject the module writes, or a reply body exists anywhere
// else in src, in scripts, or in the routine prompts in docs. It reads the
// files, so a path that composes mail by hand cannot hide behind an import.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEvent } from "@/lib/email";
import { SUBJECT_STEMS } from "@/lib/email/registry";
import { ALL_EVENTS } from "./fixtures";

const ROOT = join(__dirname, "..", "..", "..");
const MODULE = join("src", "lib", "email");
const ROUTINE_PROMPTS = ["docs/SWEEP_PROMPT.md", "docs/ROUTINES.md"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mts|mjs|js|cjs|sh|sql|md)$/.test(name)) out.push(rel);
  }
  return out;
}

export function scannedFiles(): string[] {
  return [
    ...walk("src").filter((f) => !f.startsWith(MODULE + "/") && f !== MODULE),
    ...walk("scripts"),
    ...ROUTINE_PROMPTS,
  ];
}

/** A call or an instruction that sends or drafts Gmail by some other road. */
export const SEND_CALLS: RegExp[] = [
  /\bsend_message\b/,
  /\bcreate_draft\b/,
  /\bupdate_draft\b/,
  /\bsend_draft\b/,
  /mcp__Gmail__/,
  /gmail\.googleapis\.com/,
  /users\/me\/(?:messages\/send|drafts)/,
  /\bimap\.gmail\.com\b/i,
  /\bsmtp\.gmail\.com\b/i,
  /\bnodemailer\b/,
  /\bAPPEND\s+"?\[Gmail\]/,
  /\bOne Gmail draft\b/i,
  /\b(?:create|creates|write|writes|make|update|send|sends)\b[^.\n]{0,30}\bGmail (?:draft|message|email)\b(?! id)/i,
  /\b(?:send|reply|draft)\b[^.\n]{0,60}\b(?:through|with|via|using) the Gmail connector\b/i,
];

/** A subject typed out where the module should have written it. */
export const SUBJECT_LITERAL = /\bsubject\s*[:=]?\s*["`](?!<)[^"`\n]{2,}["`]/i;

/** Fixed wording of every event, split around its values, so a copy with
 *  "$500" in place of "500" is still recognised as the same sentence. */
export function bodyPhrases(): string[] {
  const out = new Set<string>();
  for (const [c, args] of ALL_EVENTS) {
    const { spec } = renderEvent(c, args);
    const lines = [
      ...(spec.prose ?? []),
      spec.opening,
      spec.next,
      spec.deadline,
      ...spec.rows.map(([k, v]) => `${k}: ${v}`),
    ].filter((x): x is string => !!x);
    for (const line of lines) {
      for (const seg of line.split(/\$?\d[\d,/]*|https?:\/\/\S+|ad-26-tnf\.vercel\.app\S*/)) {
        const s = seg.trim().replace(/\s+/g, " ");
        if (s.replace(/[^A-Za-z]/g, "").length >= 20) out.add(s);
      }
    }
  }
  return [...out];
}

export function findBypasses(files: string[], read: (f: string) => string): string[] {
  const phrases = bodyPhrases();
  const found: string[] = [];
  for (const f of files) {
    const text = read(f);
    text.split("\n").forEach((line, i) => {
      for (const re of SEND_CALLS) if (re.test(line)) found.push(`${f}:${i + 1} send or draft call ${re}`);
      if (SUBJECT_LITERAL.test(line)) found.push(`${f}:${i + 1} subject literal`);
      for (const stem of SUBJECT_STEMS) if (line.includes(stem)) found.push(`${f}:${i + 1} subject stem "${stem}"`);
    });
    const flat = text.replace(/\s+/g, " ");
    for (const p of phrases) if (flat.includes(p)) found.push(`${f} reply or body text "${p}"`);
  }
  return found;
}

const readRepo = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("no email bypasses src/lib/email", () => {
  it("scans src, scripts and the routine prompts", () => {
    const files = scannedFiles();
    expect(files).toContain("scripts/email.mts");
    expect(files).toContain("scripts/game-day-pack.mts");
    expect(files).toContain("docs/SWEEP_PROMPT.md");
    expect(files.some((f) => f.startsWith(MODULE))).toBe(false);
  });

  it("knows the wording it is looking for", () => {
    const p = bodyPhrases();
    expect(p).toContain("Got it, thanks. I'll confirm once I see it land.");
    expect(p).toContain("Venmo @AnthonyDellaPia, or cash or check works.");
    expect(p).toContain("Here is what I have on file for you for the TNF holiday games.");
  });

  it("finds none", () => {
    expect(findBypasses(scannedFiles(), readRepo)).toEqual([]);
  });

  it("would catch each kind, in code and in a prompt", () => {
    const planted: Record<string, string> = {
      "scripts/a.mts": 'await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")',
      "scripts/b.mts": 'const m = { subject: "TNF reminder" };',
      "docs/SWEEP_PROMPT.md": "10c. Body:\nGot it, thanks.  I'll confirm once\nI see it land.",
      "docs/ROUTINES.md": "A4. One Gmail DRAFT per game, subject TNF Holiday Pool 2026",
      "src/x.ts": "You're in on block 7. $500, Venmo @AnthonyDellaPia, or cash or check works.",
    };
    const hits = findBypasses(Object.keys(planted), (f) => planted[f]);
    for (const f of Object.keys(planted)) expect(hits.some((h) => h.startsWith(f))).toBe(true);
  });
});
