import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AdminBlock,
  AdminGame,
  Participant,
  ParticipantFinance,
  Payment,
  Payout,
} from "@/lib/types";

// Admin reads. These run as the signed-in admin session — RLS admin
// policies unlock the rows; a non-admin session gets nothing.

export interface ParticipantWithFinance extends Participant {
  finance: ParticipantFinance;
}

export async function getParticipantsWithFinance(): Promise<
  ParticipantWithFinance[]
> {
  const supabase = await createSupabaseServerClient();
  const [{ data: people, error: e1 }, { data: fin, error: e2 }] =
    await Promise.all([
      supabase.from("participants").select("*").order("full_name"),
      supabase.from("v_participant_finance").select("*"),
    ]);
  if (e1) throw new Error(`participants: ${e1.message}`);
  if (e2) throw new Error(`finance: ${e2.message}`);
  const byId = new Map(
    ((fin ?? []) as ParticipantFinance[]).map((f) => [f.participant_id, f]),
  );
  return ((people ?? []) as Participant[]).map((p) => ({
    ...p,
    finance:
      byId.get(p.id) ??
      ({
        participant_id: p.id,
        blocks_held: 0,
        blocks_assigned: 0,
        amount_due_cents: 0,
        amount_paid_cents: 0,
      } satisfies ParticipantFinance),
  }));
}

export async function getAdminBlocks(): Promise<AdminBlock[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .order("block_number");
  if (error) throw new Error(`blocks: ${error.message}`);
  return (data ?? []) as AdminBlock[];
}

export async function getPayments(): Promise<Payment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`payments: ${error.message}`);
  return (data ?? []) as Payment[];
}

export async function getAdminGames(): Promise<AdminGame[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .order("game_no");
  if (error) throw new Error(`games: ${error.message}`);
  return (data ?? []) as AdminGame[];
}

export async function getPayouts(): Promise<Payout[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payouts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`payouts: ${error.message}`);
  const list = (data ?? []) as (Payout & { display_name?: string })[];
  if (list.length === 0) return [];
  const { data: people } = await supabase
    .from("participants")
    .select("id, display_alias, full_name");
  const names = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      (p.display_alias ?? p.full_name) as string,
    ]),
  );
  return list.map((po) => ({
    ...po,
    display_name: po.participant_id
      ? (names.get(po.participant_id) ?? null)
      : null,
  }));
}

export {
  buildAlerts,
  type AdminAlert,
} from "@/lib/alerts";
