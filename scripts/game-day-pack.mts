// Admin command: the game-day pack for one game.
//
//   npm run game-day -- --game 1 --context ctx.json --participants p.json --upload --draft
//
// Renders /grid?g=N as a PNG and a one-page PDF, uploads both to the PUBLIC
// storage bucket game-day (--upload), computes the To and Bcc lists, renders
// the email through src/lib/email (event game_day_g<NN>) and writes the
// message next to a manifest. --draft puts it in Gmail Drafts through
// src/lib/email/transport.ts. This command never sends mail and never writes
// to the database. It writes no subject or body of its own: those, the layout
// and the MIME all come from src/lib/email, and the file names come from the
// subject (attachmentBase), so the attachment and the subject always match.
//
// To is Anthony plus the owners (Anthony's rule, 2026-09-09): ADMIN_EMAIL
// first, then every address in TNF_OWNER_EMAILS (comma separated, set on the
// routine, never committed). Bcc is every holder's email and cc_email from
// the participant export, minus anyone already on the To line.
//
// Inputs
//   --game N              game number (required)
//   --context FILE        the output of
//                         select admin_email_context('game_day_g<NN>', '<ADMIN_EMAIL>')::text
//                         run through the Supabase connector as Anthony. Every
//                         value the email states comes from it.
//   --participants FILE   JSON array of { full_name, display_alias, email,
//                         cc_email, blocks:number[] } for every participant
//                         holding a block. Admin-only data: keep it out of
//                         the repo. The SQL that produces it is in
//                         docs/ROUTINES.md under TNF Game Day Pack.
//   --upload              upload the PNG and the PDF to the game-day bucket
//                         over the Storage REST API and put both public URLs
//                         in the email; the message then carries no
//                         attachment. Signs in as the admin through Supabase
//                         Auth (password grant) with ADMIN_EMAIL (default in
//                         src/lib/env.ts) and ADMIN_PASSWORD. The anon key is
//                         the only key involved; there is no service-role
//                         key anywhere in this repo. Exit 4 when the sign-in
//                         or an upload fails.
//   --link-only           no files on the message and no upload: the email
//                         points to the live grid alone.
//   --base URL            the app (default https://ad-26-tnf.vercel.app)
//   --out DIR             output directory (default out/game-day, gitignored)
//   --scale N             device scale factor for the PNG (default 2)
//   --allow-undrawn       render even if the digits are not live yet
//   --draft               also write the draft into Gmail Drafts through the
//                         Gmail API (GMAIL_OAUTH_TOKEN_JSON and friends, see
//                         src/lib/email/transport.ts). A draft: nothing is
//                         sent, ever.
//
// Without --upload and --link-only the message carries both files as
// attachments. The command always writes <name>.eml next to the manifest, the
// same message, for inspection.
//
// Needs Node 22.18 or newer (type stripping is on by default) and a Chromium:
// TNF_CHROMIUM=/path/to/chrome, else /opt/pw-browsers/chromium, else the
// installed Google Chrome.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type LaunchOptions } from "playwright-core";
import { ADMIN_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL } from "../src/lib/env.ts";
import {
  buildGameDayPack,
  draftAttachments,
  dropFromBcc,
  ownerRecipients,
  gridObjectNames,
  publicObjectUrl,
  STORAGE_BUCKET,
  type GridDelivery,
  type PackGame,
  type PackParticipant,
} from "../src/lib/game-day-pack.ts";
import { renderEvent } from "../src/lib/email/registry.ts";
import { buildMime } from "../src/lib/email/mime.ts";
import { attachmentBase } from "../src/lib/email/events/game-day.ts";
import { Gmail, gmailEnvFromProcess } from "../src/lib/email/transport.ts";
import type { EmailContext } from "../src/lib/email/types.ts";

const DEFAULT_BASE = "https://ad-26-tnf.vercel.app";
const VIEWPORT_WIDTH = 1000;

// The grid, the game header and the winner panel. Not the site nav, not the
// week tabs, not the fit/comfortable toggle: those are navigation, and an
// attachment has nowhere to navigate to.
const HIDE_CHROME_CSS = `
  header { display: none !important; }
  [role="tablist"] { display: none !important; }
  main div:has(> button[aria-pressed]) { display: none !important; }
  main { padding-top: 16px !important; padding-bottom: 16px !important; }
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(msg: string, code = 1): never {
  console.error(`game-day-pack: ${msg}`);
  process.exit(code);
}

async function fetchGame(gameNo: number): Promise<PackGame> {
  const select =
    "game_no,week,kickoff_at,away_team,home_team,network,holiday_label,game_type,row_digits,col_digits";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/v_public_games?game_no=eq.${gameNo}&select=${select}`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) fail(`v_public_games ${res.status}`);
  const rows = (await res.json()) as PackGame[];
  if (rows.length !== 1) fail(`game ${gameNo} not found`);
  return rows[0];
}

function readParticipants(path: string): PackParticipant[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) fail("participants file must be a JSON array");
  return raw.map((r, i) => {
    const p = r as Partial<PackParticipant>;
    if (typeof p.full_name !== "string" || !Array.isArray(p.blocks)) {
      fail(`participants[${i}] needs full_name and blocks`);
    }
    return {
      full_name: p.full_name,
      display_alias: p.display_alias ?? null,
      email: p.email ?? null,
      cc_email: p.cc_email ?? null,
      blocks: p.blocks.map(Number),
    };
  });
}

function launchOptions(): LaunchOptions {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const args = asRoot ? ["--no-sandbox"] : [];
  // Chromium ignores HTTPS_PROXY on its own; a sandbox that routes egress
  // through a proxy (the Claude Code container does) needs it passed in.
  // Such a proxy re-terminates TLS and, in practice, drops Chromium's
  // TLS 1.3 handshake, so cap it at 1.2 there and nowhere else.
  const server = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const proxy = server
    ? { server, bypass: process.env.NO_PROXY ?? process.env.no_proxy }
    : undefined;
  if (proxy) {
    args.push(
      "--ssl-version-max=tls1.2",
      "--disable-features=UseMLKEM,PostQuantumKyber,EncryptedClientHello",
    );
  }
  const exe = process.env.TNF_CHROMIUM;
  if (exe) return { executablePath: exe, args, proxy };
  if (existsSync("/opt/pw-browsers/chromium")) {
    return { executablePath: "/opt/pw-browsers/chromium", args, proxy };
  }
  return { channel: "chrome", args, proxy };
}

async function render(url: string, pngPath: string, pdfPath: string, scale: number) {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({
      viewport: { width: VIEWPORT_WIDTH, height: 1200 },
      deviceScaleFactor: scale,
      colorScheme: "dark",
    });
    await page.emulateMedia({ media: "screen", colorScheme: "dark" });
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!res || !res.ok()) fail(`${url} returned ${res?.status() ?? "no response"}`);
    await page.addStyleTag({ content: HIDE_CHROME_CSS });
    await page.waitForSelector("main");
    await page.waitForTimeout(750); // fonts and the reveal animation settle

    await page.locator("main").screenshot({ path: pngPath, type: "png" });

    // One page, exactly: the PDF page is the size of the document.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: `${VIEWPORT_WIDTH}px`,
      height: `${height + 8}px`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: "1",
    });
  } finally {
    await browser.close();
  }
}


// ---------------------------------------------------------------------------
// Storage upload. The admin signs in through Supabase Auth with the anon key
// plus ADMIN_EMAIL and ADMIN_PASSWORD (password grant), and the resulting
// access token authorizes two POSTs with x-upsert into the public bucket
// game-day, one per file. The bucket's insert and update policies re-check
// is_admin() on that token, the same gate every admin_* RPC uses (migration
// 22). Neither the password nor the token is ever printed.
//
// The object name is the game's date and number, so a re-render replaces the
// file under the same URL. Cache-Control is therefore no-cache: a browser or
// intermediary revalidates each time instead of serving a stale grid for an
// hour after a replacement. The URL in the email never changes.

async function adminAccessToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    fail("--upload needs ADMIN_PASSWORD (the admin's Supabase Auth password) in the environment", 4);
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password }),
  });
  if (!res.ok) fail(`admin sign-in failed (HTTP ${res.status})`, 4);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) fail("admin sign-in returned no access token", 4);
  return json.access_token;
}

async function uploadPublic(
  token: string,
  objectName: string,
  path: string,
  mimeType: string,
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${objectName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
      "Cache-Control": "no-cache",
      "x-upsert": "true",
    },
    body: new Uint8Array(readFileSync(path)),
  });
  if (!res.ok) {
    throw new Error(`upload of ${objectName} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const url = publicObjectUrl(SUPABASE_URL, objectName);
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) throw new Error(`${url} is not publicly readable (HTTP ${head.status})`);
  return url;
}

const UPLOAD_ATTEMPTS = 3;

/** One file, retried: a transient failure must not leave the pair half replaced. */
async function uploadWithRetry(
  token: string,
  objectName: string,
  path: string,
  mimeType: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await uploadPublic(token, objectName, path, mimeType);
    } catch (e) {
      lastError = e;
      if (attempt < UPLOAD_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Both files, under their stable names. The URLs are fixed by design (the
 * game's date and number) so a link in an email that already went out keeps
 * working after a re-render, which rules out a versioned prefix. The pair
 * is therefore replaced one file after the other: the PDF first, then the
 * PNG, each with retries. If the second still fails after the first was
 * replaced, the published pair is out of step and the command says so with
 * exit 4; the rerun with --upload restores it. Nothing is deleted from the
 * bucket, by policy.
 */
async function uploadGrid(filenameBase: string, pngPath: string, pdfPath: string): Promise<GridDelivery> {
  const names = gridObjectNames(filenameBase);
  const token = await adminAccessToken();
  let pdfUrl: string;
  try {
    pdfUrl = await uploadWithRetry(token, names.pdf, pdfPath, "application/pdf");
  } catch (e) {
    fail(`${e instanceof Error ? e.message : String(e)}; nothing was replaced in ${STORAGE_BUCKET}`, 4);
  }
  try {
    const pngUrl = await uploadWithRetry(token, names.png, pngPath, "image/png");
    return { mode: "links", pngUrl, pdfUrl };
  } catch (e) {
    fail(
      `${e instanceof Error ? e.message : String(e)}; ${names.pdf} was replaced but ${names.png} was not, ` +
        `so the published pair is out of step. Rerun with --upload to restore it.`,
      4,
    );
  }
}

function kb(path: string): string {
  return `${Math.round(statSync(path).size / 1024)} KB`;
}

function readContext(path: string, eventKey: string): EmailContext {
  const ctx = JSON.parse(readFileSync(path, "utf8")) as EmailContext;
  if (ctx.event_key !== eventKey) fail(`the context is for ${ctx.event_key}, not ${eventKey}`);
  return ctx;
}

function renderPack(ctx: EmailContext, grid: GridDelivery) {
  const r = renderEvent(ctx, {
    grid: grid.mode,
    ...(grid.mode === "links" ? { png_url: grid.pngUrl, pdf_url: grid.pdfUrl } : {}),
  });
  if (r.problems.length) fail(`lint refused the pack: ${r.problems.join("; ")}`);
  return r;
}

async function main() {
  const gameNo = Number(arg("game"));
  if (!Number.isInteger(gameNo) || gameNo < 1) fail("--game N is required");
  const participantsPath = arg("participants");
  if (!participantsPath) fail("--participants FILE is required");
  const contextPath = arg("context");
  if (!contextPath) fail("--context FILE is required (admin_email_context for game_day_g<NN>)");
  const base = arg("base") ?? DEFAULT_BASE;
  const outDir = resolve(arg("out") ?? "out/game-day");
  const scale = Number(arg("scale") ?? 2);
  if (flag("upload") && flag("link-only")) fail("--upload and --link-only exclude each other");

  const eventKey = `game_day_g${String(gameNo).padStart(2, "0")}`;
  const ctx = readContext(resolve(contextPath), eventKey);
  const game = await fetchGame(gameNo);
  const participants = readParticipants(resolve(participantsPath));
  const draft = buildGameDayPack(game, participants, base);

  if (!draft.digitsLive && !flag("allow-undrawn")) {
    fail(
      `${draft.gameCode} digits are not live in the public projection; the grid would render as "?". ` +
        `Publish them first, or pass --allow-undrawn.`,
      2,
    );
  }

  // The subject does not depend on how the grid is delivered, so the file
  // names can be fixed from it before the grid is rendered.
  const filenameBase = attachmentBase(renderPack(ctx, { mode: "live-only" }).email.subject);

  mkdirSync(outDir, { recursive: true });
  const pngPath = resolve(outDir, `${filenameBase}.png`);
  const pdfPath = resolve(outDir, `${filenameBase}.pdf`);
  const manifestPath = resolve(outDir, `${filenameBase}.manifest.json`);

  await render(draft.gridUrl, pngPath, pdfPath, scale);

  // A placeholder grid (digits not live) is never published to the bucket.
  let grid: GridDelivery = { mode: "attached" };
  if (flag("link-only")) grid = { mode: "live-only" };
  else if (flag("upload")) {
    if (!draft.digitsLive) fail(`${draft.gameCode} digits are not live; refusing to upload a placeholder grid`, 2);
    grid = await uploadGrid(filenameBase, pngPath, pdfPath);
  }
  const pack = buildGameDayPack(game, participants, base, { grid });
  const rendered = renderPack(ctx, grid);

  const files = [
    { path: pngPath, filename: `${filenameBase}.png`, mimeType: "image/png" },
    { path: pdfPath, filename: `${filenameBase}.pdf`, mimeType: "application/pdf" },
  ];
  const attachments = draftAttachments(pack.grid, files.map((f) => ({
    filename: f.filename,
    mimeType: f.mimeType,
    content: new Uint8Array(readFileSync(f.path)),
  })));

  const to = ownerRecipients(process.env.TNF_OWNER_EMAILS, ADMIN_EMAIL);
  const bcc = dropFromBcc(pack.recipients.bcc, to);
  // distinct is the Bcc actually written; an owner who also holds a block is
  // counted on the To line, not twice.
  const counts = {
    ...pack.recipients.counts,
    distinct: bcc.length,
    movedToTo: pack.recipients.bcc.length - bcc.length,
  };

  const manifest = {
    game: {
      game_no: game.game_no,
      code: pack.gameCode,
      week: game.week,
      away_team: game.away_team,
      home_team: game.home_team,
      kickoff_at: game.kickoff_at,
      network: game.network,
      holiday_label: game.holiday_label,
      game_type: game.game_type ?? null,
    },
    event_key: eventKey,
    digitsLive: pack.digitsLive,
    gridUrl: pack.gridUrl,
    grid: pack.grid,
    links: pack.grid.mode === "links" ? { png: pack.grid.pngUrl, pdf: pack.grid.pdfUrl } : null,
    subject: rendered.email.subject,
    text: rendered.email.text,
    rendered_sha: rendered.sha,
    to,
    bcc,
    noEmail: pack.recipients.noEmail,
    counts,
    files,
    attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType })),
    renderedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const from = `Anthony DellaPia <${ADMIN_EMAIL}>`;
  const mime = buildMime({ from, to, bcc, email: rendered.email, attachments, headers: { "X-TNF-Event": eventKey } });
  const emlPath = resolve(outDir, `${filenameBase}.eml`);
  writeFileSync(emlPath, mime);
  const draftResult = flag("draft")
    ? await (await Gmail.connect(gmailEnvFromProcess(ADMIN_EMAIL))).createDraft(mime)
    : null;

  const c = counts;
  console.log(rendered.email.subject);
  console.log(`digits live: ${pack.digitsLive ? "yes" : "NO"}`);
  console.log(
    `holders ${c.holders}, blocks ${c.blocksHeld}, with email ${c.withEmail}, ` +
      `without ${c.withoutEmail}, cc addresses ${c.ccAddresses}, shared ${c.shared}, ` +
      `distinct in bcc ${c.distinct}${c.movedToTo ? ` (${c.movedToTo} moved to To)` : ""}`,
  );
  console.log(
    `to: ${to.length} (admin + owners from TNF_OWNER_EMAILS${to.length === 1 ? ", variable not set" : ""}), bcc: ${bcc.length}`,
  );
  if (pack.recipients.noEmail.length > 0) {
    console.log(
      "no email: " +
        pack.recipients.noEmail
          .map((p) => `${p.name} (${p.blocks.join(", ")})`)
          .join("; "),
    );
  }
  console.log(`png: ${pngPath} (${kb(pngPath)})`);
  console.log(`pdf: ${pdfPath} (${kb(pdfPath)})`);
  if (pack.grid.mode === "links") {
    console.log(`png link: ${pack.grid.pngUrl}`);
    console.log(`pdf link: ${pack.grid.pdfUrl}`);
  } else {
    console.log(
      pack.grid.mode === "attached"
        ? "grid delivery: attached to the message (pass --upload for links)"
        : "grid delivery: live grid link only (--link-only)",
    );
  }
  console.log(`manifest: ${manifestPath}`);
  console.log(`eml: ${emlPath} (${kb(emlPath)})`);
  console.log(
    draftResult
      ? `gmail draft: written (draft ${draftResult.draftId})`
      : "gmail draft: not written (pass --draft)",
  );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
