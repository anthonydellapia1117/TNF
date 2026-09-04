// Row shapes as they come back from the public views and admin tables.

export type BlockStatus = "available" | "reserved" | "assigned" | "held";
export type GameStatus =
  | "scheduled"
  | "digits_assigned"
  | "published"
  | "in_progress"
  | "halftime"
  | "final"
  | "void";
export type GameType = "regular" | "holiday";
export type PayoutType = "halftime" | "final";
export type OwnerGroup =
  | "AVD"
  | "MAP"
  | "RM"
  | "JPOD"
  | "EJD"
  | "NL"
  | "GD"
  | "BG";
export const OWNER_GROUPS: OwnerGroup[] = [
  "AVD",
  "MAP",
  "RM",
  "JPOD",
  "EJD",
  "NL",
  "GD",
  "BG",
];

export interface PublicGame {
  id: string;
  game_no: number;
  week: number;
  kickoff_at: string | null;
  date_confirmed: boolean;
  game_type: GameType;
  holiday_label: string | null;
  home_team: string;
  away_team: string;
  network: string | null;
  row_digits: number[] | null; // null until published
  col_digits: number[] | null; // null until published
  digits_assigned: boolean;
  digits_published_at: string | null;
  /** Announced drop time — public even while the digits themselves are gated. */
  digits_reveal_at?: string | null;
  live_home: number | null;
  live_away: number | null;
  live_updated_at: string | null;
  halftime_home: number | null;
  halftime_away: number | null;
  halftime_block: number | null;
  halftime_scored_at: string | null;
  final_home: number | null;
  final_away: number | null;
  final_block: number | null;
  final_scored_at: string | null;
  status: GameStatus;
}

export interface PublicBlock {
  block_number: number;
  status: BlockStatus;
  display_name: string | null;
  owner_group: OwnerGroup | null;
  participant_id: string | null;
  assignment_method: "requested" | "carryover" | "random" | "admin" | null;
}

export interface PublicPayout {
  id: string;
  game_id: string;
  payout_type: PayoutType;
  block_number: number;
  participant_id: string | null;
  display_name: string | null;
  amount_cents: number;
  created_at: string;
}

export interface PoolConfig {
  id: number;
  price_per_block_cents: number;
  blocks_total: number;
  regular_halftime_cents: number;
  regular_final_cents: number;
  holiday_halftime_cents: number;
  holiday_final_cents: number;
  claim_deadline: string;
  timezone: string;
  season_status: string;
  /** Public /players detail level — flipped from admin, no deploy needed. */
  players_detail: "full" | "lean";
  /**
   * When true the public side reads as a season in progress, not a pool
   * being sold. Admin-toggled, defaults false. See src/lib/season-mode.ts.
   */
  season_mode: boolean;
}

export interface Pot {
  available: number;
  reserved: number;
  assigned: number;
  held: number;
  // v_pot withholds money from a non-admin caller: amounts owed always,
  // collected once season mode is on. NULL means "not yours to see", not
  // zero — read these with ?? 0 on admin surfaces only.
  collected_cents: number | null;
  due_cents: number | null;
  paid_out_cents: number;
  owed_out_cents: number | null;
  /** A real COUNT of committed blocks, never money divided by price. */
  committed_blocks: number;
}

// Admin-only shapes (RLS keeps these away from the public).

export interface Participant {
  id: string;
  full_name: string;
  display_alias: string | null;
  email: string | null;
  phone: string | null;
  owner_group: OwnerGroup;
  shared_group_id: string | null;
  source: "email" | "text" | "in_person" | "import";
  source_ref: string | null;
  blocks_requested: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParticipantFinance {
  participant_id: string;
  blocks_held: number;
  blocks_assigned: number;
  amount_due_cents: number;
  amount_paid_cents: number;
  blocks_comped: number;
}

export interface AdminBlock {
  block_number: number;
  participant_id: string | null;
  status: BlockStatus;
  assignment_method: "requested" | "carryover" | "random" | "admin" | null;
  requested_ref: string | null;
  assigned_at: string | null;
  notes: string | null;
  /** Comped: in play and winnable, but owes nothing. Admin-only. */
  comped: boolean;
  /** This block's own name, if it has one. Falls back to the owner's alias. */
  display_name: string | null;
}

export interface Payment {
  id: string;
  participant_id: string | null;
  amount_cents: number;
  method: "venmo" | "cash" | "check" | "correction" | "comp";
  paid_on: string;
  venmo_txn_id: string | null;
  source_ref: string | null;
  note: string | null;
  corrects_payment_id: string | null;
  created_at: string;
}

export interface AdminGame extends Omit<PublicGame, "digits_assigned"> {
  digit_seed: string | null;
  digits_assigned_at: string | null;
  notes: string | null;
}

export interface Payout extends PublicPayout {
  status: "owed" | "paid" | "void";
  paid_on: string | null;
  method: string | null;
  note: string | null;
}
