import { createHash } from "node:crypto";
import type { RenderedEmail } from "./types.ts";

/** What email_sends.rendered_sha records: the exact subject, text and html sent. */
export function renderedSha(e: RenderedEmail): string {
  return createHash("sha256")
    .update(JSON.stringify({ subject: e.subject, text: e.text, html: e.html }))
    .digest("hex");
}
