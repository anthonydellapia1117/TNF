// Admin command: the game-day email pack for one game.
//
//   npm run game-day -- --game 1 --participants /path/to/participants.json
//
// Renders /grid?g=N as a PNG and a one-page PDF, computes the BCC list from
// an admin participant export, and writes a manifest with everything the
// Gmail draft needs: subject, body, BCC, attachments. Creating the draft is
// the caller's step (the Gmail connector); this command never sends mail,
// never talks to Gmail, and never writes to the database.
//
// Inputs
//   --game N              game number, 1 to 23 (required)
//   --participants FILE   JSON array of { full_name, display_alias, email,
//                         cc_email, blocks:number[] } for every participant
//                         holding a block. Admin-only data: keep it out of
//                         the repo. The SQL that produces it is in
//                         docs/ROUTINES.md under TNF Game Day Pack.
//   --base URL            the app (default https://ad-26-tnf.vercel.app)
//   --out DIR             output directory (default out/game-day, gitignored)
//   --scale N             device scale factor for the PNG (default 2)
//   --allow-undrawn       render even if the digits are not live yet
//   --draft               also write the draft into Gmail Drafts over IMAP,
//                         attachments included, using GMAIL_USER and
//                         GMAIL_APP_PASSWORD (a Google app password, which
//                         needs 2-Step Verification on the account). This is
//                         a draft: nothing is sent, ever.
//
// Without --draft the command still writes <name>.eml next to the manifest,
// the same message, for anyone who wants to inspect or import it.
//
// Needs Node 22.18 or newer (type stripping is on by default) and a Chromium:
// TNF_CHROMIUM=/path/to/chrome, else /opt/pw-browsers/chromium, else the
// installed Google Chrome.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { chromium, type LaunchOptions } from "playwright-core";
import { ADMIN_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL } from "../src/lib/env.ts";
import {
  buildDraftMime,
  buildGameDayPack,
  type PackGame,
  type PackParticipant,
} from "../src/lib/game-day-pack.ts";

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
    "game_no,week,kickoff_at,away_team,home_team,network,holiday_label,row_digits,col_digits";
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
// Gmail Drafts over IMAP. Four commands: LOGIN, APPEND to [Gmail]/Drafts,
// LOGOUT. No library, no OAuth client, no send capability of any kind.

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const DRAFTS = "[Gmail]/Drafts";

class Imap {
  private buf = "";
  private waiters: ((line: string) => void)[] = [];
  private sock: TLSSocket;
  // No parameter properties: Node's type stripping does not erase them.
  private constructor(sock: TLSSocket) {
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf("\r\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        this.waiters.shift()?.(line);
      }
    });
  }

  static async open(): Promise<Imap> {
    const sock = await new Promise<TLSSocket>((ok, err) => {
      const s = tlsConnect({ host: IMAP_HOST, port: IMAP_PORT, servername: IMAP_HOST }, () => ok(s));
      s.once("error", err);
    });
    const imap = new Imap(sock);
    const greeting = await imap.line();
    if (!greeting.startsWith("* OK")) fail(`imap greeting: ${greeting}`);
    return imap;
  }

  private line(): Promise<string> {
    return new Promise((ok) => this.waiters.push(ok));
  }

  /**
   * One tagged command. With a literal, wait for the server's "+" first,
   * send the bytes, then wait for the tagged reply, so an APPEND that the
   * server refuses is an error here and not a silent nothing in Drafts.
   */
  private async cmd(tag: string, text: string, literal?: Buffer): Promise<string> {
    const verb = text.split(" ")[0];
    this.sock.write(`${tag} ${text}\r\n`);
    if (literal) {
      for (;;) {
        const l = await this.line();
        if (l.startsWith("+")) break;
        if (l.startsWith(`${tag} `)) fail(`imap ${verb}: ${l}`);
      }
      this.sock.write(literal);
      this.sock.write("\r\n");
    }
    for (;;) {
      const l = await this.line();
      if (l.startsWith(`${tag} `)) {
        if (!l.startsWith(`${tag} OK`)) fail(`imap ${verb}: ${l}`);
        return l;
      }
    }
  }

  async login(user: string, password: string) {
    const q = (s: string) => `"${s.replace(/(["\\])/g, "\\$1")}"`;
    await this.cmd("a1", `LOGIN ${q(user)} ${q(password)}`);
  }

  async appendDraft(message: Buffer): Promise<string> {
    const reply = await this.cmd(
      "a2",
      `APPEND "${DRAFTS}" (\\Draft) {${message.length}}`,
      message,
    );
    return reply.replace(/^a2 OK\s*/, "") || "appended";
  }

  async close() {
    try {
      this.sock.write("a4 LOGOUT\r\n");
    } finally {
      this.sock.end();
    }
  }
}

async function writeGmailDraft(message: Buffer): Promise<string> {
  const user = process.env.GMAIL_USER ?? ADMIN_EMAIL;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!password) {
    fail("--draft needs GMAIL_APP_PASSWORD (a Google app password) and optionally GMAIL_USER", 3);
  }
  const imap = await Imap.open();
  try {
    await imap.login(user, password);
    return await imap.appendDraft(message);
  } finally {
    await imap.close();
  }
}

function kb(path: string): string {
  return `${Math.round(statSync(path).size / 1024)} KB`;
}

async function main() {
  const gameNo = Number(arg("game"));
  if (!Number.isInteger(gameNo) || gameNo < 1) fail("--game N is required");
  const participantsPath = arg("participants");
  if (!participantsPath) fail("--participants FILE is required");
  const base = arg("base") ?? DEFAULT_BASE;
  const outDir = resolve(arg("out") ?? "out/game-day");
  const scale = Number(arg("scale") ?? 2);

  const game = await fetchGame(gameNo);
  const participants = readParticipants(resolve(participantsPath));
  const pack = buildGameDayPack(game, participants, base);

  if (!pack.digitsLive && !flag("allow-undrawn")) {
    fail(
      `${pack.gameCode} digits are not live in the public projection; the grid would render as "?". ` +
        `Publish them first, or pass --allow-undrawn.`,
      2,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const pngPath = resolve(outDir, `${pack.filenameBase}.png`);
  const pdfPath = resolve(outDir, `${pack.filenameBase}.pdf`);
  const manifestPath = resolve(outDir, `${pack.filenameBase}.manifest.json`);

  await render(pack.gridUrl, pngPath, pdfPath, scale);

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
    },
    digitsLive: pack.digitsLive,
    gridUrl: pack.gridUrl,
    subject: pack.subject,
    body: pack.body,
    bcc: pack.recipients.bcc,
    noEmail: pack.recipients.noEmail,
    counts: pack.recipients.counts,
    attachments: [
      { path: pngPath, filename: `${pack.filenameBase}.png`, mimeType: "image/png" },
      { path: pdfPath, filename: `${pack.filenameBase}.pdf`, mimeType: "application/pdf" },
    ],
    renderedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // The message itself: Bcc only, both files attached. Always written next
  // to the manifest; pushed into Gmail Drafts only on --draft.
  const from = process.env.GMAIL_USER ?? ADMIN_EMAIL;
  const mime = buildDraftMime({
    from,
    bcc: pack.recipients.bcc,
    subject: pack.subject,
    body: pack.body,
    attachments: manifest.attachments.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      content: new Uint8Array(readFileSync(a.path)),
    })),
  });
  const emlPath = resolve(outDir, `${pack.filenameBase}.eml`);
  writeFileSync(emlPath, mime);
  const draftResult = flag("draft") ? await writeGmailDraft(mime) : null;

  const c = pack.recipients.counts;
  console.log(pack.subject);
  console.log(`digits live: ${pack.digitsLive ? "yes" : "NO"}`);
  console.log(
    `holders ${c.holders}, blocks ${c.blocksHeld}, with email ${c.withEmail}, ` +
      `without ${c.withoutEmail}, cc addresses ${c.ccAddresses}, shared ${c.shared}, ` +
      `distinct recipients ${c.distinct}`,
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
  console.log(`manifest: ${manifestPath}`);
  console.log(`eml: ${emlPath} (${kb(emlPath)})`);
  console.log(
    draftResult
      ? `gmail draft: written to ${DRAFTS} for ${from} (${draftResult})`
      : "gmail draft: not written (pass --draft with GMAIL_APP_PASSWORD set)",
  );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
