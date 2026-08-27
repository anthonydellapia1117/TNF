"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

// Every write goes through a database RPC that re-checks is_admin() against
// the caller's JWT — this layer only shapes arguments and revalidates.

async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
  paths: string[],
): Promise<ActionResult<T>> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Not signed in as the admin." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, {
    ...args,
    p_actor: session.actor,
  });
  if (error) return { ok: false, error: error.message };
  for (const p of paths) revalidatePath(p);
  return { ok: true, data: data as T };
}

const EVERYTHING = ["/", "/grid", "/blocks", "/schedule", "/winners", "/admin"];

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export async function upsertParticipant(input: {
  id: string | null;
  full_name: string;
  display_alias: string;
  email: string;
  phone: string;
  owner_group: string;
  shared_group_id: string;
  source: string;
  source_ref: string;
  blocks_requested: number;
  notes: string;
}): Promise<ActionResult<string>> {
  if (!input.full_name.trim()) return { ok: false, error: "Name is required." };
  return rpc(
    "admin_upsert_participant",
    {
      p_id: input.id,
      p_full_name: input.full_name,
      p_display_alias: input.display_alias,
      p_email: input.email,
      p_phone: input.phone,
      p_owner_group: input.owner_group,
      p_shared_group_id: input.shared_group_id,
      p_source: input.source,
      p_source_ref: input.source_ref,
      p_blocks_requested: input.blocks_requested,
      p_notes: input.notes,
    },
    ["/admin/participants", "/admin/payments", "/"],
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export async function reserveBlocks(input: {
  blockNumbers: number[];
  participantId: string;
  method: string;
  ref: string;
}): Promise<ActionResult<number>> {
  if (input.blockNumbers.length === 0)
    return { ok: false, error: "Pick at least one block." };
  return rpc(
    "admin_reserve_blocks",
    {
      p_block_numbers: input.blockNumbers,
      p_participant_id: input.participantId,
      p_method: input.method || "requested",
      p_ref: input.ref,
    },
    EVERYTHING,
  );
}

export async function releaseBlock(n: number): Promise<ActionResult> {
  return rpc("admin_release_block", { p_block_number: n }, EVERYTHING);
}

/**
 * Comp a block: it stays in play and fully winnable, but owes $0. Audited
 * both directions so it is always reversible. Never surfaced publicly.
 */
export async function setComped(
  n: number,
  comped: boolean,
): Promise<ActionResult> {
  return rpc(
    "admin_set_comped",
    { p_block_number: n, p_comped: comped },
    EVERYTHING,
  );
}

export async function holdBlock(
  n: number,
  note: string,
): Promise<ActionResult> {
  return rpc(
    "admin_hold_block",
    { p_block_number: n, p_note: note },
    EVERYTHING,
  );
}

/** H1: Scro confirmed a carried-over number is what his guy actually wants. */
export async function confirmCarryover(n: number): Promise<ActionResult> {
  return rpc("admin_confirm_carryover", { p_block_number: n }, EVERYTHING);
}

export async function promoteParticipant(
  participantId: string,
): Promise<ActionResult<number>> {
  return rpc(
    "admin_promote_if_paid",
    { p_participant_id: participantId },
    EVERYTHING,
  );
}

// ---------------------------------------------------------------------------
// Payments (append-only; corrections are new rows)
// ---------------------------------------------------------------------------

export async function recordPayment(input: {
  participantId: string | null;
  amountCents: number;
  method: string;
  paidOn: string;
  venmoTxnId: string;
  sourceRef: string;
  note: string;
  correctsPaymentId: string | null;
}): Promise<ActionResult<string>> {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0)
    return { ok: false, error: "Amount must be a non-zero whole number of cents." };
  if (!input.paidOn) return { ok: false, error: "Date is required." };
  return rpc(
    "admin_record_payment",
    {
      p_participant_id: input.participantId,
      p_amount_cents: input.amountCents,
      p_method: input.method,
      p_paid_on: input.paidOn,
      p_venmo_txn_id: input.venmoTxnId,
      p_source_ref: input.sourceRef,
      p_note: input.note,
      p_corrects_payment_id: input.correctsPaymentId,
    },
    EVERYTHING,
  );
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export async function updateGame(input: {
  gameId: string;
  week: number;
  kickoffAt: string | null;
  dateConfirmed: boolean;
  gameType: string;
  holidayLabel: string;
  homeTeam: string;
  awayTeam: string;
  network: string;
  notes: string;
}): Promise<ActionResult> {
  if (!input.homeTeam.trim() || !input.awayTeam.trim())
    return { ok: false, error: "Both teams are required." };
  return rpc(
    "admin_update_game",
    {
      p_game_id: input.gameId,
      p_week: input.week,
      p_kickoff_at: input.kickoffAt,
      p_date_confirmed: input.dateConfirmed,
      p_game_type: input.gameType,
      p_holiday_label: input.holidayLabel,
      p_home_team: input.homeTeam,
      p_away_team: input.awayTeam,
      p_network: input.network,
      p_notes: input.notes,
    },
    EVERYTHING,
  );
}

// ---------------------------------------------------------------------------
// Digits: assign, then publish as a separate deliberate step
// ---------------------------------------------------------------------------

export async function assignDigits(gameId: string): Promise<ActionResult> {
  return rpc("admin_assign_digits", { p_game_id: gameId }, ["/admin/digits", "/admin"]);
}

/**
 * Publish immediately (publishAt omitted/null) or schedule the reveal for a
 * future instant. The database stores the timestamp; the public view compares
 * it to now() on every read, so the reveal fires with no further action.
 */
export async function publishDigits(
  gameId: string,
  publishAt?: string | null,
): Promise<ActionResult> {
  if (publishAt) {
    const at = new Date(publishAt);
    if (Number.isNaN(at.getTime()))
      return { ok: false, error: "Invalid reveal time." };
    if (at.getTime() <= Date.now())
      return { ok: false, error: "The reveal time must be in the future — or publish now." };
  }
  return rpc(
    "admin_publish_digits",
    { p_game_id: gameId, p_publish_at: publishAt ?? null },
    EVERYTHING,
  );
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/**
 * Audit a password change. The credential itself is changed by Supabase from
 * the browser; this records that it happened — actor, timestamp, surface —
 * and never sees any password material.
 */
export async function recordPasswordChange(
  surface: string,
): Promise<ActionResult> {
  return rpc("admin_log_password_change", { p_surface: surface }, ["/admin"]);
}

// ---------------------------------------------------------------------------
// Public display settings
// ---------------------------------------------------------------------------

/** Flip the public /players detail level — FULL or LEAN, no deploy. */
export async function setPlayersDetail(
  mode: "full" | "lean",
): Promise<ActionResult> {
  return rpc("admin_set_players_detail", { p_mode: mode }, [
    "/players",
    "/",
    "/admin",
  ]);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreResult {
  block: number;
  amount_cents: number;
  payout_created: boolean;
  review: boolean;
  winner_status: string;
  winner_name: string | null;
}

export async function scoreGame(input: {
  gameId: string;
  type: "halftime" | "final";
  away: number;
  home: number;
}): Promise<ActionResult<ScoreResult>> {
  return rpc(
    "admin_score_game",
    {
      p_game_id: input.gameId,
      p_type: input.type,
      p_away: input.away,
      p_home: input.home,
    },
    EVERYTHING,
  );
}

export async function setLiveScore(input: {
  gameId: string;
  away: number;
  home: number;
}): Promise<ActionResult> {
  return rpc(
    "admin_set_live",
    { p_game_id: input.gameId, p_away: input.away, p_home: input.home },
    EVERYTHING,
  );
}

export async function clearLiveScore(gameId: string): Promise<ActionResult> {
  return rpc("admin_clear_live", { p_game_id: gameId }, EVERYTHING);
}

// ---------------------------------------------------------------------------
// Payouts: owed → paid. The app never moves money.
// ---------------------------------------------------------------------------

export async function settlePayout(input: {
  payoutId: string;
  paidOn: string;
  method: string;
}): Promise<ActionResult> {
  return rpc(
    "admin_settle_payout",
    {
      p_payout_id: input.payoutId,
      p_paid_on: input.paidOn || null,
      p_method: input.method,
    },
    ["/admin/payouts", "/admin", "/winners"],
  );
}

export async function reopenPayout(
  payoutId: string,
  note: string,
): Promise<ActionResult> {
  return rpc(
    "admin_reopen_payout",
    { p_payout_id: payoutId, p_note: note },
    ["/admin/payouts", "/admin", "/winners"],
  );
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
