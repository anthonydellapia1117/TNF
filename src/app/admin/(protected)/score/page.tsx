import type { Metadata } from "next";
import { getConfig, getPublicBlocks } from "@/lib/data/public";
import { getAdminGames } from "@/lib/data/admin";
import { ScoreClient } from "@/components/admin/score/score-client";

export const metadata: Metadata = { title: "Score" };
export const dynamic = "force-dynamic";

export default async function ScorePage() {
  const [games, blocks, config] = await Promise.all([
    getAdminGames(),
    getPublicBlocks(),
    getConfig(),
  ]);
  return <ScoreClient games={games} blocks={blocks} config={config} />;
}
