// The game-day email pack: one game, one grid render, one Gmail draft.
//
// Pure logic, unit-tested. Deliberately import-free so that
// `node scripts/game-day-pack.ts` can load it straight through Node's own
// type stripping, with no bundler and no build step.
//
// What it decides: the file name, the subject line, the plain body, and the
// BCC list. What it never does: send mail, read the database, or put an
// email address anywhere but the draft. Emails are admin-only data
// (CLAUDE.md, Public surfaces); the participant rows come from an admin
// export handed to the command at runtime and are never committed.

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

export interface GameDayPack {
  gameCode: string;
  filenameBase: string;
  subject: string;
  body: string;
  gridUrl: string;
  digitsLive: boolean;
  recipients: PackRecipients;
}

const ET = "America/New_York";

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

/** TNF G01: New England Patriots at Seattle Seahawks, Wed 8:20 PM ET */
export function packSubject(game: PackGame): string {
  const when = game.kickoff_at
    ? `${etWeekday(game.kickoff_at)} ${etClock(game.kickoff_at)}`
    : "date TBD";
  return `TNF ${gameCode(game.game_no)}: ${game.away_team} at ${game.home_team}, ${when}`;
}

export function gridUrl(baseUrl: string, gameNo: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/grid?g=${gameNo}`;
}

/**
 * The plain body: the app link, the game, kickoff time and network, and one
 * line saying the grid is attached. Nothing about money, status or anyone's
 * block. That is the whole message by design.
 */
export function packBody(game: PackGame, baseUrl: string): string {
  const code = gameCode(game.game_no);
  const holiday = game.holiday_label ? ` (${game.holiday_label})` : "";
  const when = game.kickoff_at
    ? `${etLongDate(game.kickoff_at)}, ${etClock(game.kickoff_at)}`
    : "Date and time TBD";
  const network = game.network ? ` on ${game.network}` : "";
  return [
    "1622 TNF Block Pool",
    "",
    `${code}: ${game.away_team} at ${game.home_team}${holiday}`,
    `${when}${network}`,
    `Week ${game.week}`,
    "",
    `Live grid: ${gridUrl(baseUrl, game.game_no)}`,
    "",
    "The grid for this game is attached (PNG and PDF).",
    "",
    "Anthony",
  ].join("\n");
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
): GameDayPack {
  return {
    gameCode: gameCode(game.game_no),
    filenameBase: packFilenameBase(game),
    subject: packSubject(game),
    body: packBody(game, baseUrl),
    gridUrl: gridUrl(baseUrl, game.game_no),
    digitsLive: digitsLive(game),
    recipients: packRecipients(participants),
  };
}

// ---------------------------------------------------------------------------
// The draft itself, as an RFC 5322 message: plain body plus the two
// attachments, recipients in Bcc only. Written into Gmail Drafts over IMAP
// by the command, so the attachments never have to travel through a chat
// tool call as base64.

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

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function encodedWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** The message bytes, CRLF line endings, ready for IMAP APPEND. */
export function buildDraftMime(m: DraftMessage): Buffer {
  const boundary = m.boundary ?? `tnf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const date = (m.date ?? new Date()).toUTCString().replace("GMT", "+0000");
  const head = [
    `From: ${m.from}`,
    ...(m.bcc.length ? [`Bcc: ${m.bcc.join(", ")}`] : []),
    `Subject: ${encodedWord(m.subject)}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
  ];
  const parts: string[] = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(Buffer.from(m.body, "utf8")),
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
  const text = [...head, ...parts, `--${boundary}--`, ""].join("\r\n");
  return Buffer.from(text, "utf8");
}
