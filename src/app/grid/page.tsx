import type { Metadata } from "next";
import { GridExplorer } from "@/components/grid/grid-explorer";
import { getConfig, getPublicBlocks, getPublicGames } from "@/lib/data/public";
import { defaultGridGame } from "@/lib/grid-search";

// The one link every pool email and reply carries (Part Q), so its preview in
// iMessage is the grid's own: a page metadata openGraph replaces the root one
// whole, so the image and site name are restated here.
const GRID_TITLE = "1622 TNF Grid";
const GRID_DESCRIPTION =
  "Find your blocks: type your name in the search box. Every holiday game's numbers and winners.";

export const metadata: Metadata = {
  title: "Grid",
  description: GRID_DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/grid",
    siteName: "1622 TNF Block Pool",
    title: GRID_TITLE,
    description: GRID_DESCRIPTION,
    images: [{ url: "/api/og", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: GRID_TITLE,
    description: GRID_DESCRIPTION,
    images: ["/api/og"],
  },
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

  // ?g=N still opens game N, so the links already sent keep working. Without
  // it, the grid opens on today's game or the next one to be played.
  const requested = Number(g);
  const fallback =
    defaultGridGame(games, new Date().toISOString())?.game_no ?? 1;
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
