import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  PoolConfig,
  Pot,
  PublicBlock,
  PublicGame,
  PublicPayout,
} from "@/lib/types";

// Public reads. Everything flows through the v_public_* projections and
// config — RLS guarantees no contact or per-person money ever leaves the
// database on these paths.

export async function getPublicGames(): Promise<PublicGame[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_public_games")
    .select("*")
    .order("game_no");
  if (error) throw new Error(`games: ${error.message}`);
  return (data ?? []) as PublicGame[];
}

export async function getPublicBlocks(): Promise<PublicBlock[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_public_blocks")
    .select("*")
    .order("block_number");
  if (error) throw new Error(`blocks: ${error.message}`);
  return (data ?? []) as PublicBlock[];
}

export async function getPublicPayouts(): Promise<PublicPayout[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_public_payouts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`payouts: ${error.message}`);
  return (data ?? []) as PublicPayout[];
}

export async function getConfig(): Promise<PoolConfig> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("config")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`config: ${error.message}`);
  return data as PoolConfig;
}

export async function getPot(): Promise<Pot> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("v_pot").select("*").single();
  if (error) throw new Error(`pot: ${error.message}`);
  return data as Pot;
}

/**
 * The week whose game is next up: the earliest non-final game by kickoff
 * (falling back to the last game when the season is over).
 */
export function currentGame(games: PublicGame[]): PublicGame | null {
  if (games.length === 0) return null;
  const live = games.find(
    (g) => g.status === "in_progress" || g.status === "halftime",
  );
  if (live) return live;
  const upcoming = games
    .filter((g) => g.status !== "final" && g.status !== "void")
    .sort((a, b) => (a.kickoff_at ?? "9999").localeCompare(b.kickoff_at ?? "9999"));
  return upcoming[0] ?? games[games.length - 1];
}
