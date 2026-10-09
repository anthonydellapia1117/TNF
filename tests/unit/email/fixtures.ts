// Contexts shaped exactly as migration 33 returns them. The games are the live
// 2026 slate (public on /schedule); people and addresses are invented and use
// the reserved tnf.test domain only.

import type { CommonFacts, EmailContext, HolderFacts } from "@/lib/email/types";

const g = (game_no: number, week: number, kickoff_at: string, holiday_label: string,
  away_team: string, home_team: string, network: string) =>
  ({ game_no, week, kickoff_at, date_confirmed: true, game_type: "holiday", holiday_label, away_team, home_team, network });

export const COMMON: CommonFacts = {
  as_of_et: "2026-10-07",
  timezone: "America/New_York",
  price_per_block_cents: 50000,
  blocks_total: 100,
  claim_deadline: "2026-11-24",
  holiday_halftime_cents: 150000,
  holiday_final_cents: 300000,
  regular_halftime_cents: 150000,
  regular_final_cents: 300000,
  open_count: 42,
  games: [
    g(1, 12, "2026-11-26T01:00:00+00:00", "Thanksgiving Eve", "Green Bay Packers", "Los Angeles Rams", "Netflix"),
    g(2, 12, "2026-11-26T18:00:00+00:00", "Thanksgiving", "Chicago Bears", "Detroit Lions", "CBS"),
    g(3, 12, "2026-11-26T21:30:00+00:00", "Thanksgiving", "Philadelphia Eagles", "Dallas Cowboys", "FOX"),
    g(4, 12, "2026-11-27T01:20:00+00:00", "Thanksgiving", "Kansas City Chiefs", "Buffalo Bills", "NBC"),
    g(5, 12, "2026-11-27T20:00:00+00:00", "Black Friday", "Denver Broncos", "Pittsburgh Steelers", "Prime Video"),
    g(6, 16, "2026-12-25T01:15:00+00:00", "Christmas Eve", "Houston Texans", "Philadelphia Eagles", "Prime Video"),
    g(7, 16, "2026-12-25T18:00:00+00:00", "Christmas", "Green Bay Packers", "Chicago Bears", "Netflix"),
    g(8, 16, "2026-12-25T21:30:00+00:00", "Christmas", "Buffalo Bills", "Denver Broncos", "Netflix"),
    g(9, 16, "2026-12-26T01:15:00+00:00", "Christmas", "Los Angeles Rams", "Seattle Seahawks", "Prime Video"),
    g(10, 17, "2027-01-01T01:15:00+00:00", "New Year's Eve", "Baltimore Ravens", "Cincinnati Bengals", "Prime Video"),
  ],
};

/** Anthony as a holder of blocks 5 (reserved, AVD) and 3 (assigned): the sample. */
export const SAMPLE_HOLDER: HolderFacts = {
  people: [{ full_name: "Anthony DellaPia", display_alias: "AD", via: "primary", owner_group: "AVD" }],
  blocks: [
    { block_number: 5, status: "reserved", owner_group: "AVD", owner_full_name: "Anthony DellaPia", ledger_paid: false },
    { block_number: 3, status: "assigned", owner_group: "AVD", owner_full_name: "Anthony DellaPia", ledger_paid: true },
  ],
};

export function ctx(event_key: string, extra: Partial<EmailContext> = {}): EmailContext {
  return { event_key, recipient: "holder@tnf.test", common: COMMON, ...extra };
}

export const ALL_BLOCKS = Array.from({ length: 100 }, (_, i) => ({
  block_number: i + 1,
  status: i + 1 === 7 ? "available" : "assigned",
}));

export const DIGEST = {
  avd_reserved: [{ block_number: 5, name: "Anthony DellaPia" }],
  open_queue: [
    { id: "q1", kind: "unclassified_mail", payload: { subject: "question about $500", sender: "x@tnf.test", note: "paid $500 to who@tnf.test?" } },
    { id: "q2", kind: "payment", payload: { participant_name: "Jane Holder", amount_cents: 50000 } },
  ],
  writes_today: [{ at: "2026-10-07T23:43:00Z", action: "stage_pending", target_table: "pending_actions", target_id: "q2" }],
  block_counts: { total: 100, available: 42, reserved: 13, assigned: 45, held: 0 },
  over_committed: [],
  last_sweep_activity: "2026-10-07T23:43:00Z",
  owners_missing_email: [{ code: "DN", full_name: "Dom Novelli" }],
};

/** An assigned block the ledger does not back: renders the not-found line (Part E4). */
export const UNBACKED_HOLDER: HolderFacts = {
  people: [{ full_name: "Jane Holder", display_alias: "JH", via: "primary", owner_group: "RM" }],
  blocks: [{ block_number: 50, status: "assigned", owner_group: "RM", owner_full_name: "Ronnie Malandro", ledger_paid: false }],
};

/** A participant asking a question from his own address. */
export const ASKER = [{ full_name: "Dan Asker", display_alias: "DA", via: "primary" as const, owner_group: "MAP" }];

/** One context and argument set per event family: what the render-lint test renders. */
export const ALL_EVENTS: [EmailContext, Record<string, string>][] = [
  [ctx("holder_checkin_2026-10-07", { holder: SAMPLE_HOLDER }), {}],
  [ctx("holder_checkin_2026-10-07", { holder: UNBACKED_HOLDER }), {}],
  [ctx("recruit_2026-10-07"), {}],
  [ctx("reply_t1_abc123", { blocks: ALL_BLOCKS }), { subject: "TNF", block: "7" }],
  [ctx("reply_t2_abc123", { blocks: ALL_BLOCKS }), { subject: "TNF", block: "8" }],
  [ctx("reply_t3_abc123"), { subject: "sent it" }],
  [ctx("reply_t4_abc123"), { subject: "out" }],
  [ctx("reply_t5_abc123"), { subject: "schedule" }],
  [ctx("reply_t6_abc123"), { subject: "pay" }],
  [ctx("digest_2026-10-07", { digest: DIGEST }), {}],
  [ctx("status_2026-10-07"), { lines: "SESSION: x\nRAN: y" }],
  [ctx("game_day_g01"), { grid: "attached" }],
  [ctx("game_day_g10"), { grid: "links", png_url: "https://x.test/a.png", pdf_url: "https://x.test/a.pdf" }],
  [ctx("game_list_1a116ebc30d629eb", { people: ASKER }), { subject: "Re: TNF Holiday Pool 2026 | Your blocks | as of Oct 7", thanks: "yes" }],
  [ctx("answer_1a116ebc30d629eb", { people: ASKER }), { subject: "question", lines: "Block 30 is yours. Paid in full." }],
];
