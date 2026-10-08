// src/lib/email: every TNF email goes through here. One place to change the
// look (layout.ts), one place that talks to Gmail (transport.ts), and every
// value read from the database at render time (migration 33's
// admin_email_context / admin_email_batch). The command is scripts/email.mts.

export type * from "./types.ts";
export { renderEvent, familyOf, envelopeFor, FAMILIES, SUBJECT_STEMS } from "./registry.ts";
export { broadcastEnvelope, broadcastTo, perRecipientEnvelope, OWNER_ORDER, type Envelope, type OwnerAddress } from "./envelope.ts";
export { render, renderText, renderHtml } from "./layout.ts";
export { lintEmail, lintVoice } from "./lint.ts";
export { renderedSha } from "./sha.ts";
export { buildMime, type MimeAttachment, type MimeMessage } from "./mime.ts";
export { attachmentBase, gameCode } from "./events/game-day.ts";
