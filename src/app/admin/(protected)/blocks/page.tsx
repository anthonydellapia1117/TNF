import type { Metadata } from "next";
import { getAdminBlocks, getParticipantsWithFinance } from "@/lib/data/admin";
import { BlocksAdmin } from "@/components/admin/blocks/blocks-admin";

export const metadata: Metadata = { title: "Blocks" };
export const dynamic = "force-dynamic";

export default async function AdminBlocksPage() {
  const [blocks, participants] = await Promise.all([
    getAdminBlocks(),
    getParticipantsWithFinance(),
  ]);
  return <BlocksAdmin blocks={blocks} participants={participants} />;
}
