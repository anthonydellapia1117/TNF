import type { Metadata } from "next";
import { getAdminGames } from "@/lib/data/admin";
import { GamesClient } from "@/components/admin/games/games-client";

export const metadata: Metadata = { title: "Games" };
export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const games = await getAdminGames();
  return <GamesClient games={games} />;
}
