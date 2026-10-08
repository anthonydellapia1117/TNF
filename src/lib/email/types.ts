// The facts an email states, exactly as migration 33 returns them
// (admin_email_context / admin_email_batch). Amounts stay in cents here; the
// renderer formats them. Nothing in this file is a value: values come from the
// database at render time.

export interface GameFact {
  game_no: number;
  week: number;
  kickoff_at: string | null;
  date_confirmed: boolean;
  game_type: string;
  holiday_label: string | null;
  away_team: string;
  home_team: string;
  network: string | null;
}

export interface CommonFacts {
  /** YYYY-MM-DD, the database's own date in the pool's time zone. */
  as_of_et: string;
  timezone: string;
  price_per_block_cents: number;
  blocks_total: number;
  /** YYYY-MM-DD */
  claim_deadline: string | null;
  holiday_halftime_cents: number;
  holiday_final_cents: number;
  regular_halftime_cents: number;
  regular_final_cents: number;
  open_count: number;
  /** Non-void games, in game order. */
  games: GameFact[];
}

export interface HolderPerson {
  full_name: string;
  display_alias: string | null;
  /** How this address reaches the person: their own address, or their cc. */
  via: "primary" | "cc";
  owner_group: string;
}

export interface HolderBlock {
  block_number: number;
  status: "reserved" | "assigned";
  owner_group: string;
  owner_full_name: string | null;
}

export interface HolderFacts {
  people: HolderPerson[];
  blocks: HolderBlock[];
}

export interface QueueRow {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
}

export interface DigestFacts {
  avd_reserved: { block_number: number; name: string }[];
  open_queue: QueueRow[];
  writes_today: { at: string; action: string; target_table: string | null; target_id: string | null }[];
  block_counts: { total: number; available: number; reserved: number; assigned: number; held: number };
  over_committed: { name: string; numbered: number; requested: number }[];
  last_sweep_activity: string | null;
  /** Owners with no address on the owners table (migration 34): every broadcast refuses while any is listed. */
  owners_missing_email: { code: string; full_name: string }[];
}

export interface BlockStatus {
  block_number: number;
  status: string;
}

/** admin_email_context(event_key, recipient) */
export interface EmailContext {
  event_key: string;
  recipient: string;
  common: CommonFacts;
  holder?: HolderFacts;
  digest?: DigestFacts;
  blocks?: BlockStatus[];
  /** game_list and answer: who the address reaches, for the greeting (migration 34). */
  people?: HolderPerson[];
}

/** admin_email_batch(event_key): the common facts once, one item per recipient. */
export interface EmailBatch {
  event_key: string;
  common: CommonFacts;
  items: { recipient: string; holder?: HolderFacts }[];
}

/**
 * What a caller supplies that the database cannot: the block number a
 * participant asked for, the subject they wrote, the lines of a status
 * report. Strings only, from the command line.
 */
export type EventArgs = Record<string, string | undefined>;

export type Row = readonly [label: string, value: string];

/**
 * One email, before layout. Every TNF email is this shape, so the look lives
 * in one place (layout.ts) and an event decides only the words.
 */
export interface EmailSpec {
  subject: string;
  /** First name only, or null. */
  greeting: string | null;
  /** What the email is, in the recipient's terms. Null only for the status report. */
  opening: string | null;
  /** Verbatim prose lines (the sweep's replies), rendered one per line. */
  prose?: string[];
  /** The substance: one row per item, identifier first. */
  rows: Row[];
  /** The one "next" line, with a real date. */
  next: string | null;
  /** Only when something is genuinely owed. */
  deadline: string | null;
  /** "Anthony", or null for the status report. */
  signoff: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}
