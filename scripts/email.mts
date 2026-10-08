// npm run email -- --event <key> [--to <addr>] [--dry-run] ...
//
// The one way a TNF email is rendered, sent or drafted. Routines and sessions
// compose nothing by hand: they fetch the facts from the database, hand them
// to this command, and this command renders through src/lib/email, lints the
// result, and talks to Gmail through src/lib/email/transport.ts.
//
// The facts come in as a file because this command holds no admin database
// credential (there is no service-role key anywhere, by design). Fetch them
// with the Supabase connector as Anthony:
//
//   select admin_email_context('<key>', '<recipient>')::text   -> --context
//   select admin_email_batch('<key>')::text                    -> --batch
//
// Modes:
//   --dry-run                 render, lint and print; nothing is sent
//   --plan --batch f          render every batch item, print recipient + sha
//   --to a --batch f --claim id
//                             send the batch item for a, after its
//                             admin_email_claim; prints the Gmail message id
//                             for admin_email_record_sent
//   --to a --context f --claim id [--thread t --in-reply-to m]
//                             send one context (a sweep reply) after its claim
//   --to-admin (or --sample)  send the rendered email to ADMIN_EMAIL only:
//                             the digest, the status report, a sample
//   --draft --batch f --owners o
//                             a broadcast as a Gmail draft: To Anthony and
//                             every owner from the owners table export, Bcc
//                             every batch item not already on To
//   --read-back <message id>  fetch a sent message and check it
//   --subjects                print the subject stems the module writes
//
// Replies to an inbound message (CLAUDE.md, Replies; Anthony 2026-10-08):
//   --to a --context f --reply-to <message id> [--dry-run | --claim id --expect-sha s]
//                             answer that message in its own thread, as
//                             game_list_<id>, answer_<id> or reply_t<n>_<thread>.
//                             Refuses unless the message came from the
//                             recipient, and refuses if Anthony already wrote
//                             in the thread after it. Subject is theirs, "Re:".
//                             Deletes every unsent draft in the thread first,
//                             then sends with In-Reply-To and References, then
//                             marks the message read and labels it
//                             Pool-TNF-Done. --dry-run reports all of it and
//                             changes nothing.
//   --no-reply <message id>   an acknowledgement: mark it read and label it
//                             Pool-TNF-Done, and send nothing
//
// Event arguments: --subject, --block, --lines, --grid, --png-url, --pdf-url,
// or --arg key=value. Refusals: any lint finding; a send to anyone but
// ADMIN_EMAIL without --claim (a uuid) and a matching --expect-sha; a message
// already in Sent to that address with the same X-TNF-Event; a recipient not
// in the batch; a dated event rendered on another day; --not-before in the
// future.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { envelopeFor, familyOf, renderEvent, REPLY_TO_MESSAGE, SUBJECT_STEMS } from "../src/lib/email/registry.ts";
import { REPLY_KEY } from "../src/lib/email/events/replies.ts";
import { buildMime, type MimeAttachment } from "../src/lib/email/mime.ts";
import { lintEmail } from "../src/lib/email/lint.ts";
import { attachmentBase } from "../src/lib/email/events/game-day.ts";
import { Gmail, gmailEnvFromProcess, type InboundMeta } from "../src/lib/email/transport.ts";
import type { EmailBatch, EmailContext, EventArgs } from "../src/lib/email/types.ts";
import type { OwnerAddress } from "../src/lib/email/envelope.ts";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "anthonydellapia@gmail.com").toLowerCase();
const FROM = `Anthony DellaPia <${ADMIN_EMAIL}>`;
const GAP_MS = 3000;
/** Applied only after a reply is sent or the message is classed no-reply. */
const DONE_LABEL = "Pool-TNF-Done";

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) die(`--${name} needs a value`);
  return v;
}
function opts(name: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  });
  return out;
}
const flag = (name: string) => argv.includes(`--${name}`);

function die(msg: string): never {
  console.error(`email: ${msg}`);
  process.exit(1);
}

function eventArgs(): EventArgs {
  const a: EventArgs = {
    subject: opt("subject"),
    block: opt("block"),
    lines: opt("lines"),
    grid: opt("grid"),
    png_url: opt("png-url"),
    pdf_url: opt("pdf-url"),
  };
  for (const kv of opts("arg")) {
    const i = kv.indexOf("=");
    if (i <= 0) die(`--arg wants key=value, got "${kv}"`);
    a[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return a;
}

function readJson<T>(path: string): { value: T; md5: string } {
  const raw = readFileSync(path, "utf8").replace(/\n$/, "");
  return { value: JSON.parse(raw) as T, md5: createHash("md5").update(raw).digest("hex") };
}

function contextFor(batch: EmailBatch, recipient: string): EmailContext {
  const item = batch.items.find((i) => i.recipient === recipient);
  if (!item) die(`${recipient} is not a derived recipient in this batch`);
  return { event_key: batch.event_key, recipient, common: batch.common, ...(item.holder ? { holder: item.holder } : {}) };
}

function renderOrDie(ctx: EmailContext, args: EventArgs) {
  const r = renderEvent(ctx, args);
  if (r.problems.length) die(`lint refused ${ctx.event_key} for ${ctx.recipient}: ${r.problems.join("; ")}`);
  return r;
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function notBefore() {
  const nb = opt("not-before");
  if (nb && Date.now() < new Date(nb).getTime()) die(`not before ${nb}; it is ${new Date().toISOString()}`);
}

function decodeParts(raw: string): { text: string | null; html: string | null; subject: string } {
  const subject = /^Subject: (.*)$/m.exec(raw)?.[1] ?? "";
  const part = (type: string) => {
    const re = new RegExp(`Content-Type: ${type};[^\\r\\n]*\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n([\\s\\S]*?)\\r?\\n--`, "i");
    const m = re.exec(raw);
    if (!m) return null;
    const head = raw.slice(Math.max(0, (m.index ?? 0)), (m.index ?? 0) + 200);
    return /base64/i.test(head) ? Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8") : m[1];
  };
  return { text: part("text/plain"), html: part("text/html"), subject };
}

/** What a reply to one inbound message has to know before it renders. */
interface ReplyPlan {
  inbound: InboundMeta;
  laterFromAnthony: string[];
  drafts: string[];
}

async function planReply(gmail: Gmail, eventKey: string, replyTo: string, to: string): Promise<ReplyPlan> {
  const inbound = await gmail.inbound(replyTo);
  const own = REPLY_TO_MESSAGE.exec(eventKey);
  if (own && own[1] !== replyTo) die(`${eventKey} answers message ${own[1]}, not ${replyTo}`);
  const t = REPLY_KEY.exec(eventKey);
  if (t && t[2] !== inbound.threadId) die(`${eventKey} is for thread ${t[2]}; message ${replyTo} is in ${inbound.threadId}`);
  if (!own && !t) die(`${eventKey} is not a reply to a message (game_list_<id>, answer_<id>, reply_t<n>_<thread>)`);
  if (inbound.from !== to) die(`message ${replyTo} is not from ${to}; a reply goes to the sender`);
  const thread = await gmail.threadMessages(inbound.threadId);
  const laterFromAnthony = thread
    .filter((m) => m.internalDate > inbound.internalDate && m.labelIds.includes("SENT") && !m.labelIds.includes("DRAFT"))
    .map((m) => m.id);
  const drafts = await gmail.draftsInThread(inbound.threadId);
  return { inbound, laterFromAnthony, drafts };
}

async function markDone(gmail: Gmail, messageId: string): Promise<void> {
  const done = await gmail.labelId(DONE_LABEL);
  await gmail.modifyLabels(messageId, [done], ["UNREAD"]);
}

async function main() {
  if (flag("subjects")) {
    for (const s of SUBJECT_STEMS) console.log(s);
    return;
  }

  const readBack = opt("read-back");
  if (readBack) {
    const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    const raw = (await gmail.getRaw(readBack)).toString("utf8");
    const p = decodeParts(raw);
    const checks = {
      multipart_alternative: /multipart\/alternative/i.test(raw),
      text_part: p.text !== null,
      html_part: p.html !== null,
      lint: p.text !== null && p.html !== null ? lintEmail({ subject: p.subject, text: p.text.replace(/\r\n/g, "\n"), html: p.html }) : ["missing part"],
    };
    console.log(JSON.stringify({ message_id: readBack, subject: p.subject, ...checks }, null, 2));
    if (!checks.multipart_alternative || !checks.text_part || !checks.html_part || checks.lint.length) process.exit(1);
    return;
  }

  const noReply = opt("no-reply");
  if (noReply) {
    const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    const m = await gmail.inbound(noReply);
    if (m.from === ADMIN_EMAIL) die(`message ${noReply} is Anthony's own; nothing to acknowledge`);
    await markDone(gmail, noReply);
    console.log(JSON.stringify({ message_id: noReply, thread_id: m.threadId, read: true, label: DONE_LABEL }));
    return;
  }

  const eventKey = opt("event") ?? die("--event <key> is required");
  const args = eventArgs();
  const batchPath = opt("batch");
  const contextPath = opt("context");
  const batch = batchPath ? readJson<EmailBatch>(batchPath) : null;
  const single = contextPath ? readJson<EmailContext>(contextPath) : null;
  if (batch && batch.value.event_key !== eventKey) die(`the batch is for ${batch.value.event_key}, not ${eventKey}`);
  if (single && single.value.event_key !== eventKey) die(`the context is for ${single.value.event_key}, not ${eventKey}`);

  // --plan: every item, no send.
  if (flag("plan")) {
    if (!batch) die("--plan needs --batch");
    const rows = batch.value.items.map((i) => {
      const r = renderOrDie(contextFor(batch.value, i.recipient), args);
      return { recipient: i.recipient, sha: r.sha, subject: r.email.subject, rows: r.spec.rows.length };
    });
    console.log(JSON.stringify({ event_key: eventKey, batch_md5: batch.md5, count: rows.length, items: rows }, null, 2));
    return;
  }

  // --draft: a broadcast, To Anthony and every owner, Bcc the batch minus To.
  if (flag("draft")) {
    if (!familyOf(eventKey).broadcast) die(`${eventKey} is per-recipient; --draft is for a broadcast`);
    if (!batch) die("--draft needs --batch (the holders it Bccs)");
    const ownersPath = opt("owners") ?? die("--draft needs --owners, the owners table export");
    const ctx: EmailContext = { event_key: eventKey, recipient: ADMIN_EMAIL, common: batch.value.common };
    const r = renderOrDie(ctx, args);
    const owners = readJson<OwnerAddress[]>(ownersPath).value;
    const { to, bcc } = envelopeFor(eventKey, {
      adminEmail: ADMIN_EMAIL,
      owners,
      derived: batch.value.items.map((i) => i.recipient),
    });
    const base = attachmentBase(r.email.subject);
    const attachments: MimeAttachment[] = opts("attach").map((path) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : die(`--attach: ${basename(path)} is not png or pdf`);
      return { filename: `${base}.${ext}`, mimeType, content: readFileSync(path) };
    });
    const mime = buildMime({ from: FROM, to, bcc, email: r.email, attachments, headers: { "X-TNF-Event": eventKey } });
    if (flag("dry-run")) {
      console.log(JSON.stringify({ subject: r.email.subject, to: to.length, bcc: bcc.length, attachments: attachments.map((a) => a.filename), sha: r.sha }, null, 2));
      console.log(r.email.text);
      return;
    }
    const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    const d = await gmail.createDraft(mime);
    console.log(JSON.stringify({ draft_id: d.draftId, message_id: d.messageId, subject: r.email.subject, to: to.length, bcc: bcc.length, sha: r.sha }));
    return;
  }

  // One email: from a batch item, or from a single context.
  if (familyOf(eventKey).broadcast) die(`${eventKey} is a broadcast; it goes out as a --draft with every owner on To`);
  const sample = flag("sample") || flag("to-admin");
  const to = (sample ? ADMIN_EMAIL : (opt("to") ?? single?.value.recipient ?? die("--to <addr> is required"))).toLowerCase();
  let ctx: EmailContext;
  if (sample) {
    const src = single?.value ?? die("--sample needs --context");
    ctx = src;
  } else if (batch) {
    ctx = contextFor(batch.value, to);
  } else if (single) {
    if (single.value.recipient !== to) die(`the context was built for ${single.value.recipient}, not ${to}`);
    ctx = single.value;
  } else {
    return die("--batch or --context is required");
  }

  // A reply to one inbound message: read it first, so the subject, the thread
  // and the refusals all come from the message itself.
  const replyTo = opt("reply-to");
  const needsReplyTo = REPLY_TO_MESSAGE.test(eventKey);
  if (needsReplyTo && !replyTo) die(`${eventKey} answers one message: --reply-to <its Gmail id> is required`);
  let gmail: Gmail | null = null;
  let plan: ReplyPlan | null = null;
  if (replyTo) {
    if (sample) die("--reply-to goes to the sender; it cannot be a sample");
    gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    plan = await planReply(gmail, eventKey, replyTo, to);
    if (args.subject === undefined) args.subject = plan.inbound.subject;
    if (plan.laterFromAnthony.length) {
      die(`Anthony already wrote in this thread after message ${replyTo} (${plan.laterFromAnthony.join(", ")}); no second reply`);
    }
  }
  const r = renderOrDie(ctx, args);

  if (flag("dry-run")) {
    console.log(JSON.stringify({
      to, subject: r.email.subject, sha: r.sha, batch_md5: batch?.md5 ?? single?.md5,
      ...(plan ? { reply_to: replyTo, thread_id: plan.inbound.threadId, drafts_to_delete: plan.drafts.length, already_replied: false } : {}),
    }, null, 2));
    console.log(r.email.text);
    return;
  }

  const claim = opt("claim");
  const expect = opt("expect-sha");
  if (to !== ADMIN_EMAIL) {
    if (!claim) die(`a send to anyone but ADMIN_EMAIL needs --claim (admin_email_claim first)`);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claim)) {
      die(`--claim must be the uuid admin_email_claim returned, got "${claim}"`);
    }
    if (!expect) die("--claim needs --expect-sha, the sha that was claimed");
  }
  if (expect && expect !== r.sha) die(`rendered sha ${r.sha} is not the claimed ${expect}; refusing`);
  notBefore();

  const envelope = envelopeFor(eventKey, { adminEmail: ADMIN_EMAIL, recipient: to });
  const inReplyTo = plan ? plan.inbound.messageId : opt("in-reply-to");
  const references = plan ? [plan.inbound.references, plan.inbound.messageId].filter(Boolean).join(" ") : opt("in-reply-to");
  const mime = buildMime({
    from: FROM,
    to: envelope.to,
    email: r.email,
    inReplyTo,
    references,
    headers: { "X-TNF-Event": eventKey, ...(claim ? { "X-TNF-Claim": claim } : {}) },
  });
  gmail ??= await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
  if (to !== ADMIN_EMAIL) {
    const prior = await gmail.sentWithEvent(to, eventKey);
    if (prior) die(`${eventKey} already went to ${to} (Gmail message ${prior}); refusing a second copy`);
  }
  if (plan) for (const d of plan.drafts) await gmail.deleteDraft(d);
  const sent = await gmail.send(mime, plan ? plan.inbound.threadId : opt("thread"));
  // The message id is printed whatever happens next: it is what
  // admin_email_record_sent needs, and losing it would leave a claim unconfirmed.
  let labeled: true | string = true;
  if (plan) {
    try {
      await markDone(gmail, plan.inbound.id);
    } catch (e) {
      labeled = e instanceof Error ? e.message : String(e);
    }
  }
  console.log(JSON.stringify({
    event_key: eventKey, recipient: to, message_id: sent.id, thread_id: sent.threadId, sha: r.sha,
    ...(plan ? { replied_to: plan.inbound.id, drafts_deleted: plan.drafts.length, done_label: labeled } : {}),
  }));
  await sleep(GAP_MS);
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
