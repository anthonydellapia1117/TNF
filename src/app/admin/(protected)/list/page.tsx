import type { Metadata } from "next";
import { getAdminBlocks, getParticipantsWithFinance } from "@/lib/data/admin";
import { ListExport } from "@/components/admin/list/list-export";

export const metadata: Metadata = { title: "List" };
export const dynamic = "force-dynamic";

export default async function ListPage() {
  const [participants, blocks] = await Promise.all([
    getParticipantsWithFinance(),
    getAdminBlocks(),
  ]);
  return <ListExport participants={participants} blocks={blocks} />;
}
