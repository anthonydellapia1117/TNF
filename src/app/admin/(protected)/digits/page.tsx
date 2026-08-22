import type { Metadata } from "next";
import { getConfig, getPublicBlocks } from "@/lib/data/public";
import { getAdminGames } from "@/lib/data/admin";
import { DigitsClient } from "@/components/admin/digits/digits-client";

export const metadata: Metadata = { title: "Digits" };
export const dynamic = "force-dynamic";

export default async function DigitsPage() {
  const [games, blocks, config] = await Promise.all([
    getAdminGames(),
    getPublicBlocks(),
    getConfig(),
  ]);
  return <DigitsClient games={games} blocks={blocks} config={config} />;
}
