// RFC 5322 bytes for one message: multipart/alternative (plain text that
// stands alone, and the same words as HTML), wrapped in multipart/mixed only
// when files ride along. CRLF line endings, base64 parts.

import type { RenderedEmail } from "./types.ts";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

export interface MimeMessage {
  from: string;
  to: string[];
  bcc?: string[];
  email: RenderedEmail;
  attachments?: MimeAttachment[];
  inReplyTo?: string;
  references?: string;
  /** Extra headers, e.g. X-TNF-Event. */
  headers?: Record<string, string>;
  /** Deterministic in tests. */
  boundary?: string;
  date?: Date;
}

function b64(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

export function encodedWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function header(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`mime: header ${name} carries a line break`);
  return `${name}: ${value}`;
}

export function buildMime(m: MimeMessage): Buffer {
  if (m.to.length === 0) throw new Error("mime: no To address");
  const seed = m.boundary ?? `tnf${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const alt = `alt-${seed}`;
  const mixed = `mix-${seed}`;
  const date = (m.date ?? new Date()).toUTCString().replace("GMT", "+0000");

  const head = [
    header("From", m.from),
    header("To", m.to.join(", ")),
    ...(m.bcc?.length ? [header("Bcc", m.bcc.join(", "))] : []),
    header("Subject", encodedWord(m.email.subject)),
    header("Date", date),
    ...(m.inReplyTo ? [header("In-Reply-To", m.inReplyTo)] : []),
    ...(m.references ? [header("References", m.references)] : []),
    ...Object.entries(m.headers ?? {}).map(([k, v]) => header(k, v)),
    "MIME-Version: 1.0",
  ];

  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.email.text),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.email.html),
    `--${alt}--`,
  ];

  const files = m.attachments ?? [];
  const lines = files.length === 0
    ? [...head, ...alternative, ""]
    : [
        ...head,
        `Content-Type: multipart/mixed; boundary="${mixed}"`,
        "",
        `--${mixed}`,
        ...alternative,
        ...files.flatMap((a) => [
          `--${mixed}`,
          `Content-Type: ${a.mimeType}; name="${a.filename}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${a.filename}"`,
          "",
          b64(a.content),
        ]),
        `--${mixed}--`,
        "",
      ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}
