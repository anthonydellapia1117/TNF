import type { Metadata } from "next";
import { GridExplorer } from "@/components/grid/grid-explorer";
import {
  currentGame,
  getConfig,
  getPublicBlocks,
  getPublicGames,
} from "@/lib/data/public";

export const metadata: Metadata = {
  title: "Grid",
  description: "The 10x10 block grid — live winners, digits, and owners.",
};

export const revalidate = 15;

export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const [{ g }, games, blocks, config] = await Promise.all([
    searchParams,
    getPublicGames(),
    getPublicBlocks(),
    getConfig(),
  ]);

  const requested = Number(g);
  const fallback = currentGame(games)?.game_no ?? 1;
  const initial = games.some((x) => x.game_no === requested)
    ? requested
    : fallback;

  return (
    <GridExplorer
      games={games}
      blocks={blocks}
      config={config}
      initialGameNo={initial}
    />
  );
}
