import type { Metadata } from "next";
import {
  getAdminBlocks,
  getParticipantsWithFinance,
  getPayments,
} from "@/lib/data/admin";
import { ParticipantsClient } from "@/components/admin/participants/participants-client";

export const metadata: Metadata = { title: "Participants" };
export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  const [participants, blocks, payments] = await Promise.all([
    getParticipantsWithFinance(),
    getAdminBlocks(),
    getPayments(),
  ]);
  return (
    <ParticipantsClient
      participants={participants}
      blocks={blocks}
      payments={payments}
    />
  );
}
