import type { Metadata } from "next";
import { PublicList } from "@/components/players/public-list";
import { getPublicBlocks } from "@/lib/data/public";
import { claimedEntries } from "@/lib/pool";

export const metadata: Metadata = {
  title: "List",
  description: "The pool list as plain text — pastes clean into the chat.",
};

export const revalidate = 30;

// Public read-only mirror of the admin list. Built entirely from
// v_public_blocks — one line per claimed block, alias then block number.
export default async function PublicListPage() {
  const blocks = await getPublicBlocks();
  return <PublicList entries={claimedEntries(blocks)} />;
}
