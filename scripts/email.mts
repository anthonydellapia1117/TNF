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
//   --draft --batch f --owners o [--omit-owner CODE]
//                             a broadcast as a Gmail draft: To Anthony and
//                             every owner from the owners table export, Bcc
//                             every batch item not already on To. A draft is
//                             not a send and is never claimed: Anthony sends
//                             it himself. --omit-owner is the same one-time
//                             override as a broadcast send, for an owner with
//                             no address; the draft's dry run names who is off
//
// A broadcast that goes out as one message (G4, Anthony 2026-10-13):
//   --context f --sample      the rendered broadcast to ADMIN_EMAIL alone
//   --context f --owners o --broadcast-plan p --min-bcc n --max-bcc n
//     [--omit-owner CODE] --dry-run
//                             prints the arithmetic (P + H - O - T - X = Bcc),
//                             the counts, the sha and the envelope md5, and
//                             refuses if the plan and the envelope are not the
//                             same people, Bcc is outside the range, or a Bcc
//                             address is an owner's. p is the export of
//                             admin_email_broadcast_plan(key). --omit-owner is
//                             the one-time override for an owner with no
//                             address; the claim writes its audit row.
//   ... --send-broadcast --claim id --expect-sha s --expect-envelope m
//                             sends it, after admin_email_claim_broadcast
//                             returned that claim_id and that envelope md5 for
//                             that sha (the dry run prints neither claim_id nor
//                             any value only the claim makes); prints the Gmail
//                             message id for admin_email_record_sent_broadcast
//   --context f --sample-draft [--dry-run]
//                             the game-day emails (Part N): the live context
//                             marked SAMPLE, with made-up digits and scores,
//                             as a Gmail draft To ADMIN_EMAIL alone. Never
//                             claimed, never sent.
//   --read-back <message id>  fetch a sent message and check it
//   --subjects                print the subject stems the module writes
//
// Replies to an inbound message (CLAUDE.md, Replies; Anthony 2026-10-08):
//   --to a --context f --reply-to <message id> [--dry-run | --claim id --expect-sha s]
//                             answer that message in its own thread, as
//                             game_list_<id>, answer_<id> or reply_t<n>_<thread>.
//                             Refuses unless the message came from the
//                             recipient, and refuses if Anthony already wrote
//                             to that sender in the thread after it. Subject
//                             is theirs, "Re:".
//                             Deletes every unsent draft in the thread first,
//                             then sends with In-Reply-To and References, then
//                             marks the message read and labels it
//                             Pool-TNF-Done. --dry-run reports all of it and
//                             changes nothing.
//   --no-reply <message id> [--dry-run]
//                             an acknowledgement: mark it read and label it
//                             Pool-TNF-Done, and send nothing. Refuses
//                             Anthony's own mail.
//
// Event arguments: --subject, --block, --lines, --grid, --png-url, --pdf-url,
// or --arg key=value. Refusals: any lint finding; a send to anyone but
// ADMIN_EMAIL without --claim (a uuid) and a matching --expect-sha; a message
// already in Sent to that address with the same X-TNF-Event; a recipient not
// in the batch; a dated event rendered on another day; --not-before in the
// future.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { envelopeFor, familyOf, renderEvent, REPLY_TO_MESSAGE, SUBJECT_STEMS } from "../src/lib/email/registry.ts";
import { REPLY_KEY } from "../src/lib/email/events/replies.ts";
import { buildMime, type MimeAttachment, type MimeInline } from "../src/lib/email/mime.ts";
import { SITE_URL } from "../src/lib/email/copy.ts";
import { lintEmail } from "../src/lib/email/lint.ts";
import { attachmentBase } from "../src/lib/email/events/game-day.ts";
import { Gmail, gmailEnvFromProcess, type InboundMeta } from "../src/lib/email/transport.ts";
import type { BlockListEntry, EmailBatch, EmailContext, EventArgs, ImageRef } from "../src/lib/email/types.ts";
import type { OwnerAddress } from "../src/lib/email/envelope.ts";
import { checkBroadcast, envelopeMd5, planArithmetic, type BroadcastPlan } from "../src/lib/email/broadcast.ts";
import { sampleDay } from "../src/lib/email/sample.ts";

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
  // Anthony already replied when a message he sent after M went to M's sender.
  // A later message to someone else in the same thread is not an answer to M.
  const thread = await gmail.threadMessages(inbound.threadId);
  const laterFromAnthony: string[] = [];
  for (const m of thread) {
    if (m.internalDate <= inbound.internalDate || !m.labelIds.includes("SENT") || m.labelIds.includes("DRAFT")) continue;
    if ((await gmail.recipientsOf(m.id)).includes(inbound.from)) laterFromAnthony.push(m.id);
  }
  const drafts = await gmail.draftsInThread(inbound.threadId);
  return { inbound, laterFromAnthony, drafts };
}

async function markDone(gmail: Gmail, messageId: string): Promise<void> {
  const done = await gmail.labelId(DONE_LABEL);
  await gmail.modifyLabels(messageId, [done], ["UNREAD"]);
}

/** Whole number from --name, or die. */
function intOpt(name: string): number {
  const v = opt(name) ?? die(`--${name} is required for a broadcast send`);
  if (!/^\d+$/.test(v)) die(`--${name} wants a whole number, got "${v}"`);
  return Number(v);
}

/**
 * A broadcast as one message: a sample to Anthony alone, or the real thing to
 * every owner with an address on To and the plan's Bcc, after the claim.
 */
/** Every address masked: the block list is the one body with addresses in it, and a log is not a place for them. */
const redact = (s: string) => s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");

interface PictureCheck { game: number; bytes: number; width: number; height: number; source: "cache" | "site" }

/**
 * A real send, as opposed to a dry run: a broadcast with --send-broadcast, or
 * a per-recipient email with its --claim (a note, Part S). The dry run writes
 * each picture to --picture-cache and the send reads it back.
 */
const sending = () => flag("send-broadcast") || (opt("claim") !== undefined && !flag("dry-run"));

/**
 * Fetch each grid picture the email names (Part R) from the site, at send
 * time, and check it is a real PNG of a size that can hold 100 names. A failed
 * fetch is retried once; a second failure throws, and the routine falls back
 * to --arg images=off, which it reports.
 */
async function fetchPictures(refs: readonly ImageRef[], eventKey: string): Promise<{ inline: MimeInline[]; checks: PictureCheck[] }> {
  const base = (process.env.TNF_SITE_URL ?? SITE_URL).replace(/\/$/, "");
  // --picture-cache <dir>: the dry run writes each picture there and the send
  // reads it back, so the email that goes out is the one that was dry-run and
  // claimed, and a site that fails between the two cannot strand the claim.
  const cache = opt("picture-cache");
  if (cache) mkdirSync(cache, { recursive: true });
  const inline: MimeInline[] = [];
  const checks: PictureCheck[] = [];
  for (const ref of refs) {
    let lastErr = "";
    let buf: Buffer | null = null;
    // One file per email and game (Part S review): a note never reads the
    // game-day run's picture of the same game, taken before a block moved.
    const cached = cache ? `${cache}/${eventKey}_g${String(ref.gameNo).padStart(2, "0")}.png` : null;
    let source: PictureCheck["source"] = "site";
    for (let attempt = 0; attempt < 3 && !buf; attempt++) {
      try {
        const useCache = cached !== null && sending() && existsSync(cached);
        source = useCache ? "cache" : "site";
        const res = useCache
          ? new Response(readFileSync(cached as string))
          : await fetch(`${base}/api/grid-image?g=${ref.gameNo}`, { cache: "no-store" });
        if (!res.ok) {
          lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 120)}`;
          await sleep(2000);
          continue;
        }
        const b = Buffer.from(await res.arrayBuffer());
        const png = b.length > 20_000 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        if (!png) {
          lastErr = `not a PNG of a usable size (${b.length} bytes)`;
          continue;
        }
        const width = b.readUInt32BE(16);
        const height = b.readUInt32BE(20);
        if (width < 1200 || height < 800) {
          lastErr = `picture is ${width}x${height}; the names would not read`;
          continue;
        }
        buf = b;
        if (cached && !sending()) writeFileSync(cached, b);
        checks.push({ game: ref.gameNo, bytes: b.length, width, height, source });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (!buf) throw new Error(`grid picture for G${String(ref.gameNo).padStart(2, "0")}: ${lastErr}`);
    inline.push({ cid: ref.cid, filename: `${ref.cid.split("@")[0]}.png`, mimeType: "image/png", content: buf });
  }
  return { inline, checks };
}

async function broadcastSend(eventKey: string, ctx: EmailContext, args: EventArgs): Promise<void> {
  if (ctx.recipient !== ADMIN_EMAIL) die(`a broadcast context is fetched for ADMIN_EMAIL, not ${ctx.recipient}`);
  if (ctx.sample && !flag("sample-draft")) die(`${eventKey}: this context is a SAMPLE; it is only ever drafted To Anthony (--sample-draft)`);
  // A review copy (Part N): the live context, marked SAMPLE, with made-up
  // digits and scores for the game-day and winners emails.
  if (flag("sample-draft")) {
    if (!familyOf(eventKey).day) die("--sample-draft is for the game-day emails: kickoff_, gameday_ and winners_<date>");
    ctx = { ...ctx, sample: true };
    const day = /_(\d{4}-\d{2}-\d{2})$/.exec(eventKey)?.[1] ?? die(`${eventKey} has no date`);
    if (!eventKey.startsWith("kickoff_")) ctx.day = sampleDay(ctx.common, day, eventKey.startsWith("winners_"));
  }
  // Part R: the block list (names and emails, all 100 blocks), read from the
  // file the routine exported. Only the game-day email carries it.
  const blockListPath = opt("block-list");
  if (blockListPath) {
    if (familyOf(eventKey).name !== "gameday") die(`--block-list is for gameday_<date> only, not ${eventKey}`);
    try {
      ctx = { ...ctx, block_list: readJson<BlockListEntry[]>(blockListPath).value };
    } catch (e) {
      // A parse error quotes the file: mask anything that looks like an address.
      return die(`block list: could not read the file (${redact(e instanceof Error ? e.message : String(e)).slice(0, 80)})`);
    }
  }
  let r;
  try {
    r = renderOrDie(ctx, args);
  } catch (e) {
    return die(redact(e instanceof Error ? e.message : String(e)));
  }

  // The review copy goes out as a Gmail draft To Anthony alone, nothing else
  // on the envelope, never claimed and never sent.
  if (flag("sample-draft")) {
    const mime = buildMime({ from: FROM, to: [ADMIN_EMAIL], email: r.email, headers: { "X-TNF-Event": `${eventKey}_sample` } });
    if (flag("dry-run")) {
      console.log(JSON.stringify({ to: [ADMIN_EMAIL], cc: [], bcc: [], subject: r.email.subject, sha: r.sha, sample: true }, null, 2));
      console.log(r.email.text);
      return;
    }
    const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    const d = await gmail.createDraft(mime);
    console.log(JSON.stringify({ event_key: eventKey, sample: true, draft_id: d.draftId, message_id: d.messageId, to: 1, cc: 0, bcc: 0, subject: r.email.subject, sha: r.sha }));
    return;
  }

  if (flag("sample") || flag("to-admin")) {
    const mime = buildMime({ from: FROM, to: [ADMIN_EMAIL], email: r.email, headers: { "X-TNF-Event": `${eventKey}_sample` } });
    if (flag("dry-run")) {
      console.log(JSON.stringify({ to: ADMIN_EMAIL, subject: r.email.subject, sha: r.sha, sample: true }, null, 2));
      console.log(r.email.text);
      return;
    }
    const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    const sent = await gmail.send(mime);
    console.log(JSON.stringify({ event_key: eventKey, sample: true, recipient: ADMIN_EMAIL, message_id: sent.id, sha: r.sha }));
    return;
  }

  const owners = readJson<OwnerAddress[]>(opt("owners") ?? die("--owners, the owners table export, is required")).value;
  const plan = readJson<BroadcastPlan>(opt("broadcast-plan") ?? die("--broadcast-plan, the export of admin_email_broadcast_plan, is required")).value;
  if (plan.event_key !== eventKey) die(`the plan is for ${plan.event_key}, not ${eventKey}`);
  const omit = opts("omit-owner");
  const range = { min: intOpt("min-bcc"), max: intOpt("max-bcc") };
  const envelope = envelopeFor(eventKey, { adminEmail: ADMIN_EMAIL, owners, derived: plan.bcc, omit });
  checkBroadcast(plan, envelope, owners, omit, range, { ownersAsHolders: familyOf(eventKey).day === true });
  const md5 = envelopeMd5(envelope);
  // Part R: the pictures are fetched in the dry run too, so a dry run proves
  // they can be fetched, and again at the send, so the email carries what the
  // grid shows at that moment.
  let pictures: { inline: MimeInline[]; checks: PictureCheck[] } = { inline: [], checks: [] };
  if (r.spec.images?.length) {
    try {
      pictures = await fetchPictures(r.spec.images, eventKey);
    } catch (e) {
      return die(`${e instanceof Error ? e.message : String(e)}. Send with --arg images=off to leave the pictures out.`);
    }
  }
  console.log(JSON.stringify({
    event_key: eventKey, subject: r.email.subject, sha: r.sha,
    arithmetic: planArithmetic(plan), to: envelope.to.length, cc: envelope.cc.length, bcc: envelope.bcc.length,
    omitted: omit.map((c) => c.trim().toUpperCase()), envelope_md5: md5,
    ...(r.spec.list ? { block_list_lines: r.spec.list.length, pictures: pictures.checks } : {}),
  }, null, 2));
  if (flag("dry-run")) {
    console.log(redact(r.email.text));
    return;
  }
  if (!flag("send-broadcast")) die("a broadcast goes out with --send-broadcast, after its claim; --dry-run shows it");
  // The one value the dry run never prints: minted by the claim, so a send
  // cannot go out with no claim behind it (review of PR 25).
  const claim = opt("claim") ?? die("--send-broadcast needs --claim, the claim_id admin_email_claim_broadcast returned");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claim)) {
    die(`--claim must be the claim_id admin_email_claim_broadcast returned, got "${claim}"`);
  }
  const expect = opt("expect-sha") ?? die("--send-broadcast needs --expect-sha, the sha that was claimed");
  if (expect !== r.sha) die(`rendered sha ${r.sha} is not the claimed ${expect}; refusing`);
  const expectEnv = opt("expect-envelope") ?? die("--send-broadcast needs --expect-envelope, the md5 admin_email_claim_broadcast returned");
  if (expectEnv !== md5) die(`envelope md5 ${md5} is not the claimed ${expectEnv}; refusing`);
  notBefore();

  const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
  const prior = await gmail.sentWithEvent(ADMIN_EMAIL, eventKey);
  if (prior) die(`${eventKey} already went out (Gmail message ${prior}); refusing a second copy`);
  const mime = buildMime({
    from: FROM, to: envelope.to, cc: envelope.cc, bcc: envelope.bcc, email: r.email,
    ...(pictures.inline.length ? { inline: pictures.inline } : {}),
    headers: { "X-TNF-Event": eventKey, "X-TNF-Claim": claim, "X-TNF-Envelope": md5 },
  });
  const sent = await gmail.send(mime);
  console.log(JSON.stringify({
    event_key: eventKey, message_id: sent.id, thread_id: sent.threadId, sha: r.sha,
    to: envelope.to.length, cc: envelope.cc.length, bcc: envelope.bcc.length, envelope_md5: md5,
    ...(pictures.checks.length ? { pictures: pictures.checks.map((c) => `G${String(c.game).padStart(2, "0")} from ${c.source}`) } : {}),
  }));
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
    if (m.from === ADMIN_EMAIL || m.labelIds.includes("SENT")) die(`message ${noReply} is Anthony's own; nothing to acknowledge`);
    if (flag("dry-run")) {
      console.log(JSON.stringify({ message_id: noReply, thread_id: m.threadId, would_mark_read: true, would_label: DONE_LABEL }));
      return;
    }
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
    const { to, cc, bcc } = envelopeFor(eventKey, {
      adminEmail: ADMIN_EMAIL,
      owners,
      derived: batch.value.items.map((i) => i.recipient),
      omit: opts("omit-owner"),
    });
    const base = attachmentBase(r.email.subject);
    const attachments: MimeAttachment[] = opts("attach").map((path) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : die(`--attach: ${basename(path)} is not png or pdf`);
      return { filename: `${base}.${ext}`, mimeType, content: readFileSync(path) };
    });
    const mime = buildMime({ from: FROM, to, cc, bcc, email: r.email, attachments, headers: { "X-TNF-Event": eventKey } });
    if (flag("dry-run")) {
      console.log(JSON.stringify({ subject: r.email.subject, to: to.length, cc: cc.length, bcc: bcc.length, omitted_owners: opts("omit-owner"), attachments: attachments.map((a) => a.filename), sha: r.sha }, null, 2));
      console.log(r.email.text);
      return;
    }
    const gmail = await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL));
    const d = await gmail.createDraft(mime);
    console.log(JSON.stringify({ draft_id: d.draftId, message_id: d.messageId, subject: r.email.subject, to: to.length, cc: cc.length, bcc: bcc.length, sha: r.sha }));
    return;
  }

  if (familyOf(eventKey).broadcast) {
    if (!single) die(`${eventKey} is a broadcast: --draft --batch, or --context for a sample or a send`);
    return broadcastSend(eventKey, single.value, args);
  }

  // One email: from a batch item, or from a single context.
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
  // Part S: a note can carry grid pictures, fetched in the dry run and again
  // (from --picture-cache) at the send, exactly as the game-day email does.
  let pictures: { inline: MimeInline[]; checks: PictureCheck[] } = { inline: [], checks: [] };
  if (r.spec.images?.length) {
    try {
      pictures = await fetchPictures(r.spec.images, eventKey);
    } catch (e) {
      return die(e instanceof Error ? e.message : String(e));
    }
  }

  if (flag("dry-run")) {
    console.log(JSON.stringify({
      to, subject: r.email.subject, sha: r.sha, batch_md5: batch?.md5 ?? single?.md5,
      ...(plan ? { reply_to: replyTo, thread_id: plan.inbound.threadId, drafts_to_delete: plan.drafts.length, already_replied: false } : {}),
      ...(pictures.checks.length ? { pictures: pictures.checks } : {}),
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
    ...(pictures.inline.length ? { inline: pictures.inline } : {}),
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
    ...(pictures.checks.length ? { pictures: pictures.checks.map((c) => `G${String(c.game).padStart(2, "0")} from ${c.source}`) } : {}),
    ...(plan ? { replied_to: plan.inbound.id, drafts_deleted: plan.drafts.length, done_label: labeled } : {}),
  }));
  await sleep(GAP_MS);
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
