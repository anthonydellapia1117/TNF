// The one place the look lives. Every TNF email is laid out here from an
// EmailSpec: greeting, opening, one table, the next line, the deadline line,
// the closing line, the sign-off. Plain text that stands on its own, and HTML that is the same
// words in a single two-column table. No logo, no image, no footer, nothing
// that competes with the table.

import type { EmailSpec, RenderedEmail } from "./types.ts";
import { wrap, wrapRow } from "./wrap.ts";

export function renderText(spec: EmailSpec): string {
  const blocks: string[] = [];
  if (spec.greeting) blocks.push(`${spec.greeting},`);
  if (spec.opening) blocks.push(wrap(spec.opening).join("\n"));
  if (spec.prose?.length) blocks.push(spec.prose.flatMap((l) => wrap(l)).join("\n"));
  if (spec.rows.length) blocks.push(spec.rows.flatMap(([k, v]) => wrapRow(k, v)).join("\n"));
  if (spec.next) blocks.push(wrap(spec.next).join("\n"));
  if (spec.deadline) blocks.push(wrap(spec.deadline).join("\n"));
  if (spec.closing) blocks.push(wrap(spec.closing).join("\n"));
  if (spec.signoff) blocks.push(spec.signoff);
  return `${blocks.join("\n\n")}\n`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A link is the bare URL and nothing else: the visible text is exactly what
// the plain part says, and the href is that same address.
const URL_RE = /\b((?:https:\/\/)?ad-26-tnf\.vercel\.app(?:\/[^\s,]*)?|https:\/\/[^\s,]+)/g;

function inline(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const url = m[1].replace(/[.)]+$/, "");
    const at = m.index ?? 0;
    out += esc(s.slice(last, at));
    const href = url.startsWith("https://") ? url : `https://${url}`;
    out += `<a href="${esc(href)}" style="color:#1a4fa0;">${esc(url)}</a>`;
    last = at + url.length;
  }
  return out + esc(s.slice(last));
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const P = "margin:0 0 14px 0;";
const NUMERIC = /^[0-9][0-9,]*$/;

export function renderHtml(spec: EmailSpec): string {
  const body: string[] = [];
  if (spec.greeting) body.push(`<p style="${P}">${esc(spec.greeting)},</p>`);
  if (spec.opening) body.push(`<p style="${P}">${inline(spec.opening)}</p>`);
  if (spec.prose?.length) {
    body.push(`<p style="${P}">${spec.prose.map(inline).join("<br>")}</p>`);
  }
  if (spec.rows.length) {
    const cell = "padding:7px 0;border-bottom:1px solid #e6e6e6;vertical-align:top;";
    const rows = spec.rows
      .map(([k, v]) => {
        const align = NUMERIC.test(v) ? "right" : "left";
        return (
          `<tr><td style="${cell}padding-right:16px;color:#555555;white-space:nowrap;">${esc(k)}</td>` +
          `<td style="${cell}text-align:${align};">${inline(v)}</td></tr>`
        );
      })
      .join("");
    body.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="width:100%;max-width:560px;border-collapse:collapse;margin:0 0 14px 0;` +
        `font-family:${FONT};font-size:15px;line-height:1.45;color:#1a1a1a;">${rows}</table>`,
    );
  }
  if (spec.next) body.push(`<p style="${P}">${inline(spec.next)}</p>`);
  if (spec.deadline) body.push(`<p style="${P}">${inline(spec.deadline)}</p>`);
  if (spec.closing) body.push(`<p style="${P}">${inline(spec.closing)}</p>`);
  if (spec.signoff) body.push(`<p style="${P}">${esc(spec.signoff)}</p>`);
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:16px;background:#ffffff;">` +
    `<div style="max-width:560px;font-family:${FONT};font-size:15px;line-height:1.45;color:#1a1a1a;">` +
    `${body.join("")}</div></body></html>`
  );
}

export function render(spec: EmailSpec): RenderedEmail {
  return { subject: spec.subject, text: renderText(spec), html: renderHtml(spec) };
}
