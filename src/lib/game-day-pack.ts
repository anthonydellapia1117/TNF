// The game-day email pack: one game, one grid render, one Gmail draft.
//
// Pure logic, unit-tested. Deliberately import-free so that
// `node scripts/game-day-pack.mts` can load it straight through Node's own
// type stripping, with no bundler and no build step.
//
// What it decides: the file name, the subject line, the plain body, the
// storage object names and public URLs, and the BCC list. What it never
// does: send mail, read the database, or put an email address anywhere but
// the draft. Emails are admin-only data (CLAUDE.md, Public surfaces); the
// participant rows come from an admin export handed to the command at
// runtime and are never committed.
//
// Subject and body follow the design-kit email template, copied into this
// repo at docs/templates/tnf-game-day-email.html (read-only source:
// nfl-pool-design-kit/tnf/email-templates/tnf-weekly-email-template.html,
// brief in nfl-pool-design-kit/docs/templates/2026-09-04_tnf-game-day-email.md).
// Fields: live_grid_url, away_team, home_team, game_date, kickoff_time,
// network. Module order: game hero, board, game notes, Lock, payouts, footer.
// Copy rule: no em dashes, anywhere, whatever the data carries.

export interface PackGame {
  game_no: number;
  week: number;
  kickoff_at: string | null;
  away_team: string;
  home_team: string;
  network: string | null;
  holiday_label: string | null;
  row_digits: number[] | null;
  col_digits: number[] | null;
  /** "regular" or "holiday"; selects the payout row. Optional for callers that do not need it. */
  game_type?: string | null;
}

export interface PackParticipant {
  full_name: string;
  display_alias: string | null;
  email: string | null;
  cc_email: string | null;
  blocks: number[];
}

export interface PackRecipients {
  /** Distinct addresses, first-seen casing kept, ordered case-insensitively. */
  bcc: string[];
  /** Holders with neither an email nor a cc_email. Names and blocks only. */
  noEmail: { name: string; blocks: number[] }[];
  counts: {
    holders: number;
    blocksHeld: number;
    withEmail: number;
    withoutEmail: number;
    ccAddresses: number;
    /** Addresses that repeated another one and were sent once. */
    shared: number;
    distinct: number;
  };
}

/**
 * How the grid reaches the reader. `links`: both files are in the public
 * storage bucket and the body links to them, the message carries no
 * attachment. `attached`: the files ride on the message. `live-only`: no
 * files at all, the live grid link is the grid.
 */
export type GridDelivery =
  | { mode: "links"; pngUrl: string; pdfUrl: string }
  | { mode: "attached" }
  | { mode: "live-only" };

/** Payout amounts for this game, in cents, from config. Money OUT is public. */
export interface PackPayouts {
  halftimeCents: number;
  finalCents: number;
}

/** The template's GAME NOTES module. Supplied by a person; never generated. */
export interface PackNotes {
  headline: string;
  paragraphs: string[];
}

/** The template's THE LOCK module. Supplied by a person; never generated. */
export interface PackLock {
  pick: string;
  odds: string;
  book: string;
  statusLine: string;
}

export interface PackOptions {
  grid?: GridDelivery;
  payouts?: PackPayouts | null;
  notes?: PackNotes | null;
  lock?: PackLock | null;
}

/** The design-kit template's placeholders, filled from the public game row. */
export interface TemplateFields {
  live_grid_url: string;
  away_team: string;
  home_team: string;
  game_date: string;
  kickoff_time: string;
  network: string;
  week_number: string;
  broadcast_line: string;
  grid_image_url: string | null;
}

export interface GameDayPack {
  gameCode: string;
  filenameBase: string;
  subject: string;
  body: string;
  gridUrl: string;
  grid: GridDelivery;
  fields: TemplateFields;
  digitsLive: boolean;
  recipients: PackRecipients;
}

const ET = "America/New_York";
export const STORAGE_BUCKET = "game-day";
const SIGNATURE = "Anthony DellaPia";

/** The copy rule: an em dash or an en dash becomes a hyphen. */
export function hyphenate(s: string): string {
  return s.replace(/[\u2013\u2014]/g, "-");
}

export function gameCode(gameNo: number): string {
  return `G${String(gameNo).padStart(2, "0")}`;
}

/** YYYY-MM-DD of an instant, in America/New_York. */
export function etDateStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Wed" */
export function etWeekday(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" }).format(
    new Date(iso),
  );
}

/** "Wednesday, September 9" */
export function etLongDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/** "8:20 PM ET" */
export function etClock(iso: string): string {
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${t} ET`;
}

/** 2026-09-09_TNF_G01_grid: the game's own date in ET, never the run date. */
export function packFilenameBase(game: Pick<PackGame, "game_no" | "kickoff_at">): string {
  const stamp = game.kickoff_at ? etDateStamp(game.kickoff_at) : "0000-00-00";
  return `${stamp}_TNF_${gameCode(game.game_no)}_grid`;
}

/** The two storage object names for a game, from its file name base. */
export function gridObjectNames(filenameBase: string): { png: string; pdf: string } {
  return { png: `${filenameBase}.png`, pdf: `${filenameBase}.pdf` };
}

/** The public URL of an object in the game-day bucket. */
export function publicObjectUrl(supabaseUrl: string, objectName: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${objectName}`;
}

export function gridUrl(baseUrl: string, gameNo: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/grid?g=${gameNo}`;
}

/** The template's <title>: TNF | Week 1 | New England Patriots at Seattle Seahawks */
export function packSubject(game: PackGame): string {
  return hyphenate(`TNF | Week ${game.week} | ${game.away_team} at ${game.home_team}`);
}

/** Every placeholder the template carries, or TBD; nothing is invented. */
export function packTemplateFields(
  game: PackGame,
  baseUrl: string,
  grid: GridDelivery = { mode: "attached" },
): TemplateFields {
  const code = gameCode(game.game_no);
  const network = game.network ? hyphenate(game.network) : null;
  const holiday = game.holiday_label ? hyphenate(game.holiday_label) : null;
  return {
    live_grid_url: gridUrl(baseUrl, game.game_no),
    away_team: hyphenate(game.away_team),
    home_team: hyphenate(game.home_team),
    game_date: game.kickoff_at ? etLongDate(game.kickoff_at) : "Date TBD",
    kickoff_time: game.kickoff_at ? etClock(game.kickoff_at) : "Time TBD",
    network: network ?? "TBD",
    week_number: String(game.week),
    broadcast_line: [code, network, holiday].filter((s): s is string => !!s).join(" | "),
    grid_image_url: grid.mode === "links" ? grid.pngUrl : null,
  };
}

/** "$750", "$1,000", "$1,500": whole dollars from cents, for the payout module only. */
function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * The plain body, in the template's module order: game hero, board, game
 * notes, Lock, payouts, footer. Notes and Lock render only when a person
 * supplied them; payouts only when the caller passed the config amounts.
 * Nothing about money owed, collection status or anyone's block: names and
 * block numbers are on the live grid, and that link is the board.
 */
export function packBody(game: PackGame, baseUrl: string, opts: PackOptions = {}): string {
  const grid = opts.grid ?? { mode: "attached" };
  const f = packTemplateFields(game, baseUrl, grid);

  const hero = [
    f.broadcast_line,
    `${f.away_team} at ${f.home_team}`,
    `Date: ${f.game_date}`,
    `Kickoff: ${f.kickoff_time}`,
    `Network: ${f.network}`,
    `Week: ${f.week_number}`,
  ];

  const board = [
    "THE BOARD",
    "HOME digits run across the top, AWAY digits run down the left.",
    `Live grid: ${f.live_grid_url}`,
  ];
  if (grid.mode === "links") {
    board.push(`Grid PNG: ${grid.pngUrl}`, `Grid PDF: ${grid.pdfUrl}`);
  } else if (grid.mode === "attached") {
    board.push("The grid for this game is attached (PNG and PDF).");
  }
  board.push("Open the live grid for current owner names.");

  const modules: string[][] = [
    [`TNF | 2026 NFL Pool | Week ${f.week_number}`],
    hero,
    board,
  ];
  if (opts.notes) {
    modules.push(["GAME NOTES", opts.notes.headline, ...opts.notes.paragraphs]);
  }
  if (opts.lock) {
    modules.push([
      "THE LOCK",
      `${opts.lock.pick} | ${opts.lock.odds} | ${opts.lock.book}`,
      opts.lock.statusLine,
    ]);
  }
  if (opts.payouts) {
    modules.push([
      "PAYOUTS THIS GAME",
      `Halftime: ${usd(opts.payouts.halftimeCents)}`,
      `Final: ${usd(opts.payouts.finalCents)}`,
    ]);
  }
  modules.push([SIGNATURE]);

  return hyphenate(modules.map((m) => m.join("\n")).join("\n\n"));
}

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/**
 * Every holder's email plus their cc_email, each address once. A shared
 * address (two participants, one inbox) goes in once, not once per person,
 * the same rule /admin/emails applies to its BCC list.
 */
export function packRecipients(participants: PackParticipant[]): PackRecipients {
  const seen = new Map<string, string>();
  const noEmail: PackRecipients["noEmail"] = [];
  let withEmail = 0;
  let ccAddresses = 0;
  let shared = 0;
  let blocksHeld = 0;

  for (const p of participants) {
    blocksHeld += p.blocks.length;
    const email = clean(p.email);
    const cc = clean(p.cc_email);
    if (email) withEmail++;
    if (cc) ccAddresses++;
    if (!email && !cc) {
      noEmail.push({ name: p.display_alias ?? p.full_name, blocks: [...p.blocks] });
    }
    for (const a of [email, cc]) {
      if (!a) continue;
      const key = a.toLowerCase();
      if (seen.has(key)) shared++;
      else seen.set(key, a);
    }
  }

  const bcc = [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, original]) => original);

  return {
    bcc,
    noEmail,
    counts: {
      holders: participants.length,
      blocksHeld,
      withEmail,
      withoutEmail: participants.length - withEmail,
      ccAddresses,
      shared,
      distinct: bcc.length,
    },
  };
}

export function digitsLive(game: Pick<PackGame, "row_digits" | "col_digits">): boolean {
  const ok = (d: number[] | null) => Array.isArray(d) && d.length === 10;
  return ok(game.row_digits) && ok(game.col_digits);
}

export function buildGameDayPack(
  game: PackGame,
  participants: PackParticipant[],
  baseUrl: string,
  opts: PackOptions = {},
): GameDayPack {
  const grid = opts.grid ?? { mode: "attached" };
  return {
    gameCode: gameCode(game.game_no),
    filenameBase: packFilenameBase(game),
    subject: packSubject(game),
    body: packBody(game, baseUrl, { ...opts, grid }),
    gridUrl: gridUrl(baseUrl, game.game_no),
    grid,
    fields: packTemplateFields(game, baseUrl, grid),
    digitsLive: digitsLive(game),
    recipients: packRecipients(participants),
  };
}

// ---------------------------------------------------------------------------
// The draft itself, as an RFC 5322 message: plain body, recipients in Bcc
// only, and the two files attached only when the grid is not linked. Written
// into Gmail Drafts over IMAP by the command, or handed to the Gmail
// connector as subject, body and bcc.

export interface DraftAttachment {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

export interface DraftMessage {
  from: string;
  bcc: string[];
  subject: string;
  body: string;
  attachments: DraftAttachment[];
  /** Deterministic in tests; defaults to a random boundary and now. */
  boundary?: string;
  date?: Date;
}

/** The files ride on the message only when the body does not link to them. */
export function draftAttachments(grid: GridDelivery, files: DraftAttachment[]): DraftAttachment[] {
  return grid.mode === "attached" ? files : [];
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function encodedWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** The message bytes, CRLF line endings, ready for IMAP APPEND. */
export function buildDraftMime(m: DraftMessage): Buffer {
  const date = (m.date ?? new Date()).toUTCString().replace("GMT", "+0000");
  const head = [
    `From: ${m.from}`,
    ...(m.bcc.length ? [`Bcc: ${m.bcc.join(", ")}`] : []),
    `Subject: ${encodedWord(m.subject)}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
  ];
  const bodyB64 = b64(Buffer.from(m.body, "utf8"));

  // No files: a single-part text message, nothing to open.
  if (m.attachments.length === 0) {
    const text = [
      ...head,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      bodyB64,
      "",
    ].join("\r\n");
    return Buffer.from(text, "utf8");
  }

  const boundary = m.boundary ?? `tnf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      bodyB64,
    ].join("\r\n"),
  ];
  for (const a of m.attachments) {
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        b64(a.content),
      ].join("\r\n"),
    );
  }
  const text = [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    ...parts,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(text, "utf8");
}
