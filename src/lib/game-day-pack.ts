// The game-day pack: one game, one grid render, one draft for Anthony.
//
// Pure logic, unit-tested. Deliberately import-free so that
// `node scripts/game-day-pack.mts` can load it straight through Node's own
// type stripping, with no bundler and no build step.
//
// What it decides: the storage object names and public URLs, and the Bcc
// list. What it never does: write a subject, a body or a message. Since
// 2026-10-07 the words, the layout and the MIME live in src/lib/email (event
// game_day_g<NN>), and the draft is written through src/lib/email/transport.ts;
// the file names come from that subject (attachmentBase), so the two match.
// Emails are admin-only data (CLAUDE.md, Public surfaces); the participant
// rows come from an admin export handed to the command at runtime and are
// never committed.

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

export interface PackOptions {
  grid?: GridDelivery;
}

export interface GameDayPack {
  gameCode: string;
  gridUrl: string;
  grid: GridDelivery;
  digitsLive: boolean;
  recipients: PackRecipients;
}

export const STORAGE_BUCKET = "game-day";

export function gameCode(gameNo: number): string {
  return `G${String(gameNo).padStart(2, "0")}`;
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
    gridUrl: gridUrl(baseUrl, game.game_no),
    grid,
    digitsLive: digitsLive(game),
    recipients: packRecipients(participants),
  };
}

// ---------------------------------------------------------------------------
// Who is on the To line. Every email to the pool where the holders ride in
// Bcc carries Anthony and the owners in To, Anthony first (Anthony's rule,
// 2026-09-09). The owner addresses live outside the repo, in the routine's
// TNF_OWNER_EMAILS environment variable, never in source: the repo is public.

/**
 * Anthony plus the owners, from a comma, semicolon or whitespace separated
 * list. Trimmed, deduped case-insensitively keeping the first casing, the
 * admin address always first. An empty or missing list yields the admin
 * alone, so a blast never goes out with an empty To; a blank admin address
 * (ADMIN_EMAIL set to nothing) is refused rather than skipped, for the same
 * reason.
 */
export function ownerRecipients(list: string | null | undefined, adminEmail: string): string[] {
  const admin = adminEmail.trim();
  if (!admin) throw new Error("ownerRecipients: the admin address is blank; To would not carry Anthony");
  const seen = new Map<string, string>();
  for (const raw of [admin, ...(list ?? "").split(/[,;\s]+/)]) {
    const a = raw.trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

/** The Bcc list without anyone already on the To line, case-insensitive. */
export function dropFromBcc(bcc: string[], to: string[]): string[] {
  const onTo = new Set(to.map((a) => a.toLowerCase()));
  return bcc.filter((a) => !onTo.has(a.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Which files ride on the draft. The message itself is built and written by
// src/lib/email (buildMime, Gmail.createDraft).

export interface DraftAttachment {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

/** The files ride on the message only when the body does not link to them. */
export function draftAttachments(grid: GridDelivery, files: DraftAttachment[]): DraftAttachment[] {
  return grid.mode === "attached" ? files : [];
}
