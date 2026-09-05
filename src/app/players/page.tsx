import type { Metadata } from "next";
import { PlayersClient } from "@/components/players/players-client";
import { getConfig, getPublicBlocks } from "@/lib/data/public";

export const metadata: Metadata = {
  title: "Players",
  description: "Who's in the pool and which blocks they hold.",
};

export const revalidate = 30;

// Public read-only mirror of the participant roster - one row per claimed
// block, built entirely from v_public_blocks + config. No admin data path.
// FULL vs LEAN detail is an admin-flipped config setting, not a deploy.
export default async function PlayersPage() {
  const [blocks, config] = await Promise.all([getPublicBlocks(), getConfig()]);
  const claimed = blocks.filter(
    (b) => b.status === "reserved" || b.status === "assigned",
  );
  return (
    <PlayersClient blocks={claimed} mode={config.players_detail ?? "full"} />
  );
}
